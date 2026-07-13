// Shared test DB helper. Connects to the Postgres in DATABASE_URL, trusting the
// Supabase pooler's private CA via a PEM file in PGCA (never committed).
// withRollback runs its body in a transaction that is ALWAYS rolled back, so
// integration tests leave prod byte-identical.

import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const DATABASE_URL = Deno.env.get("DATABASE_URL");
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required (point it at the local or prod Postgres).");
}

const caFile = Deno.env.get("PGCA");
const caCertificates = caFile
  ? Deno.readTextFileSync(caFile)
    .split(/(?<=-----END CERTIFICATE-----)/)
    .map((c) => c.trim())
    .filter((c) => c.includes("BEGIN CERTIFICATE"))
  : undefined;

function clientConfig() {
  const u = new URL(DATABASE_URL!);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    hostname: u.hostname,
    port: Number(u.port || "5432"),
    database: u.pathname.replace(/^\//, "") || "postgres",
    tls: caCertificates ? { enabled: true, enforce: true, caCertificates } : undefined,
  };
}

export async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client(clientConfig());
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function withRollback(fn: (c: Client) => Promise<void>): Promise<void> {
  await withClient(async (c) => {
    await c.queryArray("begin");
    try {
      await fn(c);
    } finally {
      await c.queryArray("rollback");
    }
  });
}
