#!/usr/bin/env bash
# LOCAL TESTING ONLY: starts the mock Supabase API and the built app in the background.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a; . dev-tools/local.env; set +a
DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/bf_dev} MOCK_DEBUG=1 nohup node dev-tools/mock-supabase.mjs > "${LOG_DIR:-/tmp}/mock.log" 2>&1 &
nohup npx next start -p 3000 > "${LOG_DIR:-/tmp}/next.log" 2>&1 &
sleep 5
echo "Mock Supabase on :54321, app on :3000"
