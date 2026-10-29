#!/usr/bin/env bash
# LOCAL TESTING ONLY: runs the page and click-through checks with every clock set to 11:05 pm New York time
# (the hours when the UTC date is already tomorrow). Postgres, the mock API, the app, the morning job, and the checks
# (with their browser) all run under libfaketime with the same offset, so they agree on the time. App code is unchanged.
# Needs: apt-get install faketime; a built app (npm run build); Postgres 16 installed as the local "main" cluster.
# Usage: bash dev-tools/late-evening.sh            (AT="2026-10-29 23:05" sets another New York time; FLOWS and PAGES work as usual;
#        SKIP_PAGES=1 or SKIP_FLOWS=1 runs one of the two; SHOTS=1 saves page screenshots)
# Afterwards Postgres is restarted on the real clock (service postgresql start).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AT=${AT:-"$(TZ=America/New_York date -d tomorrow +%Y-%m-%d) 23:05"}
LIB=$(ls /usr/lib/*/faketime/libfaketime.so.1 2>/dev/null | head -1)
[ -n "$LIB" ] || { echo "libfaketime not found: apt-get install faketime"; exit 1; }
TARGET=$(TZ=America/New_York date -d "$AT" +%s)
OFFSET=$((TARGET - $(date +%s)))
FAKE="LD_PRELOAD=$LIB FAKETIME=+${OFFSET} FAKETIME_DONT_FAKE_MONOTONIC=1"
LOGS=${LOG_DIR:-/tmp}
echo "Fake time: $(TZ=America/New_York date -d "@$TARGET") (offset ${OFFSET}s)"

PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/var/lib/postgresql/16/main
PGCONF=/etc/postgresql/16/main/postgresql.conf
stop_all() {
  pkill -f "next-server|next start" 2>/dev/null || true
  pkill -f "node dev-tools/mock-supabase" 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -m fast stop" >/dev/null 2>&1 || service postgresql stop >/dev/null 2>&1 || true
}
restore() {
  stop_all
  service postgresql start >/dev/null
  echo "Postgres is back on the real clock."
}
trap restore EXIT
stop_all
service postgresql stop >/dev/null 2>&1 || true
su postgres -c "env $FAKE $PGBIN/pg_ctl -D $PGDATA -o '-c config_file=$PGCONF' -l /tmp/pg-fake.log -w start" >/dev/null
su postgres -c "psql -Atc \"select 'Postgres now (New York): ' || (now() at time zone 'America/New_York')\""

cd "$ROOT"
bash dev-tools/setup-local-db.sh | tail -1
set -a; . dev-tools/local.env; set +a
export DATABASE_URL=${DATABASE_URL:-postgres://postgres:postgres@127.0.0.1:5432/bf_dev}
env $FAKE MOCK_DEBUG=1 nohup node dev-tools/mock-supabase.mjs > "$LOGS/mock.log" 2>&1 &
env $FAKE nohup npx next start -p 3000 > "$LOGS/next.log" 2>&1 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3000/login && break; sleep 1; done
env $FAKE node -e "console.log('Node now (New York): ' + new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }))"
curl -s -H "Authorization: Bearer test-cron-secret" http://localhost:3000/api/cron/morning | head -c 120; echo
status=0
# Pages first, on the fresh demo data (the click-through checks end with Reset all data).
if [ "${SKIP_PAGES:-0}" != "1" ]; then env $FAKE NODE_PATH=$(npm root -g) SHOTS=${SHOTS:-0} node dev-tools/check-pages.cjs || status=1; fi
if [ "${SKIP_FLOWS:-0}" != "1" ]; then env $FAKE NODE_PATH=$(npm root -g) node dev-tools/check-flows.cjs || status=1; fi
exit $status
