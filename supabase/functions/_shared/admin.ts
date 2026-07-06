const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export async function requireAdmin(
  req: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Supabase environment is not configured' }, 500);
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: authHeader,
    },
  });

  if (!userRes.ok) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const user = await userRes.json();
  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=is_admin&user_id=eq.${user.id}&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!profileRes.ok) {
    return json({ error: 'Failed to verify admin access' }, 500);
  }

  const [profile] = (await profileRes.json()) as Array<{ is_admin?: boolean }>;
  if (profile?.is_admin !== true) {
    return json({ error: 'Forbidden' }, 403);
  }

  return { userId: user.id as string };
}
