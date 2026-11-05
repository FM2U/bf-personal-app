#!/usr/bin/env bash
# LOCAL TESTING ONLY: runs the push D click-through checks (dev-tools/check-push-d.cjs) twice, each on a fresh local
# database, with the app and the stand-ins on a fake clock: a Monday (AT_MONDAY, default 2026-11-09 17:20 New York) and
# a Friday (AT_FRIDAY, default 2026-11-06 17:20), the way dev-tools/push-b-friday.sh fakes Friday. Postgres stays on
# the real clock. Needs: apt-get install faketime; a built app (npm run build); Postgres running.
# Usage: bash dev-tools/push-d-days.sh        (SHOTS_DIR=<folder> saves the Friday run's screenshots; DAYS="friday" runs one)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIB=$(ls /usr/lib/*/faketime/libfaketime.so.1 2>/dev/null | head -1)
[ -n "$LIB" ] || { echo "libfaketime not found: apt-get install faketime"; exit 1; }
LOGS=${LOG_DIR:-/tmp}
cd "$ROOT"
set -a; . dev-tools/local.env; set +a
export DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/bf_dev}
status=0
for day in ${DAYS:-monday friday}; do
  if [ "$day" = "monday" ]; then AT=${AT_MONDAY:-"2026-11-09 17:20"}; else AT=${AT_FRIDAY:-"2026-11-06 17:20"}; fi
  echo "== $day ($AT, New York)"
  ps aux | grep -E "dev-tools/mock-supabase|next start|next-server" | grep -v grep | awk '{print $2}' | xargs -r kill || true
  sleep 1
  bash dev-tools/setup-local-db.sh | tail -1
  OFFSET=$(( $(TZ=America/New_York date -d "$AT" +%s) - $(date +%s) ))
  FAKE="LD_PRELOAD=$LIB FAKETIME=+${OFFSET} FAKETIME_DONT_FAKE_MONOTONIC=1"
  env $FAKE MOCK_DEBUG=1 nohup node dev-tools/mock-supabase.mjs > "$LOGS/mock-$day.log" 2>&1 &
  env $FAKE nohup npx next start -p 3000 > "$LOGS/next-$day.log" 2>&1 &
  for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done
  env $FAKE node -e "console.log('App clock (New York): ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))"
  if [ "$day" = "friday" ]; then SHOTS="${SHOTS_DIR:-}"; else SHOTS=""; fi
  env $FAKE SHOTS_DIR="$SHOTS" NODE_PATH=$(npm root -g) node dev-tools/check-push-d.cjs || status=1
done
ps aux | grep -E "dev-tools/mock-supabase|next start|next-server" | grep -v grep | awk '{print $2}' | xargs -r kill || true
exit $status
