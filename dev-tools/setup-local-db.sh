#!/usr/bin/env bash
# LOCAL TESTING ONLY: creates a local database with all migrations, one owner account, and the demo seed data.
# Usage: bash dev-tools/setup-local-db.sh   (needs a local Postgres server and the postgres OS user)
# UP_TO=0007 applies migrations only up to 0007 (the live database before supabase/UPDATE_RUN_ONCE.sql).
set -euo pipefail
DB=${DB:-bf_dev}
OWNER_ID=${OWNER_ID:-00000000-0000-0000-0000-000000000001}
OWNER_EMAIL=${OWNER_EMAIL:-owner@example.com}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"
su postgres -c "dropdb --if-exists $DB && createdb $DB"
su postgres -c "$PSQL -d $DB -f $ROOT/supabase/tests/local_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-4)
  if [ -n "${UP_TO:-}" ] && [ "$n" \> "$UP_TO" ]; then continue; fi
  su postgres -c "$PSQL -d $DB -f $f"
done
su postgres -c "$PSQL -d $DB -c \"insert into auth.users (id, email) values ('$OWNER_ID', '$OWNER_EMAIL')\""
# The demo data uses current_date for "today". The app's today is the New York date, so the seed runs with the
# New York time zone (PGTZ): late in the evening the UTC date is already tomorrow. The database itself stays on UTC
# (as Supabase is), so everything the app saves behaves as in production.
if [ "${NO_DEMO:-0}" != "1" ]; then su postgres -c "PGTZ=America/New_York $PSQL -d $DB -f $ROOT/supabase/seed/demo_seed.sql"; fi
echo "Local database $DB is ready (owner $OWNER_EMAIL)."
