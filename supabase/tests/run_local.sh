#!/usr/bin/env bash
# LOCAL TESTING ONLY: applies all migrations to a scratch database on a local Postgres server,
# then runs supabase/tests/smoke_test.sql. Usage: bash supabase/tests/run_local.sh
set -euo pipefail
DB=${DB:-bf_scratch}
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"
su postgres -c "dropdb --if-exists $DB && createdb $DB"
su postgres -c "$PSQL -d $DB -f $DIR/tests/local_supabase_stub.sql"
for f in "$DIR"/migrations/*.sql; do
  echo "Applying $(basename "$f")"
  su postgres -c "$PSQL -d $DB -f $f"
done
su postgres -c "$PSQL -d $DB -f $DIR/tests/smoke_test.sql"
echo "All migrations applied and smoke test passed."
