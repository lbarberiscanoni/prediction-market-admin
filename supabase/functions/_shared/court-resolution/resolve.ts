// supabase/functions/_shared/court-resolution/resolve.ts
//
// The settlement primitive is now DOMAIN-AGNOSTIC and lives in
// ../resolution/settle.ts. This file re-exports it so court-resolution code
// (templates.ts, draft.ts, tests) keeps importing from "./resolve.ts", and to
// document that court settlement is just the generic resolver applied to court
// verdicts. New domains (FRED, custom) import ../resolution/settle.ts directly.

export * from "../resolution/settle.ts";
