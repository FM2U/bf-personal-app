#!/usr/bin/env bash
# LOCAL TESTING ONLY: creates a local database from supabase/SETUP_NEW_DATABASE.sql and one owner account (which gets
# the default pipelines, stages and settings). Load sample data from the app: Settings, Sample data.
# Usage: bash dev-tools/setup-local-db.sh   (needs a local Postgres server and the postgres OS user)
set -euo pipefail
DB=${DB:-bf_dev}
OWNER_ID=${OWNER_ID:-00000000-0000-0000-0000-000000000001}
OWNER_EMAIL=${OWNER_EMAIL:-owner@example.com}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"
su postgres -c "dropdb --if-exists $DB && createdb $DB"
su postgres -c "$PSQL -d $DB -f $ROOT/supabase/tests/local_supabase_stub.sql"
su postgres -c "$PSQL -d $DB -f $ROOT/supabase/SETUP_NEW_DATABASE.sql" > /dev/null
su postgres -c "$PSQL -d $DB -c \"insert into auth.users (id, email) values ('$OWNER_ID', '$OWNER_EMAIL')\""
echo "Local database $DB is ready (owner $OWNER_EMAIL). Load sample data in the app: Settings, Sample data."
