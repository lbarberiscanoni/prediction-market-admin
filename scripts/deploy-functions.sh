#!/usr/bin/env bash
# Deploy edge functions to the Prophet Supabase project.
#
#   scripts/deploy-functions.sh get-fred-data [other-fn ...]
#
# Uses SUPABASE_PROPHET_TOKEN from .env.local so it works regardless of which
# Supabase account the CLI is globally logged into (it's usually Cassandra).
# Create the token at https://supabase.com/dashboard/account/tokens while signed
# in to the account that owns project asxaibpmkcorlcpycgqc.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF=asxaibpmkcorlcpycgqc

if [ $# -eq 0 ]; then
  echo "usage: $0 <function-name> [...]" >&2
  exit 1
fi

TOKEN="$(grep -E '^SUPABASE_PROPHET_TOKEN=' .env.local 2>/dev/null | cut -d= -f2- || true)"
if [ -z "$TOKEN" ]; then
  echo "SUPABASE_PROPHET_TOKEN missing from .env.local — add it once (see header)." >&2
  exit 1
fi

for fn in "$@"; do
  SUPABASE_ACCESS_TOKEN="$TOKEN" supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done
