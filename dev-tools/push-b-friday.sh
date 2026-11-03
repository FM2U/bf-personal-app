#!/usr/bin/env bash
# LOCAL TESTING ONLY: runs the push B click-through checks with the app and the Google stand-in on a Friday clock
# (AT="2026-11-06 17:20", New York time), so both sample partners are due on End of day. Postgres stays on the real
# clock. Needs: apt-get install faketime; a built app; the local database (dev-tools/setup-local-db.sh).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AT=${AT:-"2026-11-06 17:20"}
LIB=$(ls /usr/lib/*/faketime/libfaketime.so.1 2>/dev/null | head -1)
[ -n "$LIB" ] || { echo "libfaketime not found: apt-get install faketime"; exit 1; }
OFFSET=$(( $(TZ=America/New_York date -d "$AT" +%s) - $(date +%s) ))
FAKE="LD_PRELOAD=$LIB FAKETIME=+${OFFSET} FAKETIME_DONT_FAKE_MONOTONIC=1"
LOGS=${LOG_DIR:-/tmp}
cd "$ROOT"
ps aux | grep -E "dev-tools/mock-supabase|next start|next-server" | grep -v grep | awk '{print $2}' | xargs -r kill || true
sleep 1
set -a; . dev-tools/local.env; set +a
export DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/bf_dev}
env $FAKE MOCK_DEBUG=1 nohup node dev-tools/mock-supabase.mjs > "$LOGS/mock.log" 2>&1 &
env $FAKE nohup npx next start -p 3000 > "$LOGS/next.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done
env $FAKE node -e "console.log('App clock (New York): ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))"
env $FAKE FAKE_ISODOW=$(TZ=America/New_York date -d "$AT" +%u) NODE_PATH=$(npm root -g) node dev-tools/check-push-b.cjs
