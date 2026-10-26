#!/usr/bin/env bash
# LOCAL TESTING ONLY: tests the upgrade path for 0008 on a database that already has 0001 to 0007 and an owner,
# then runs 0008 twice to confirm it is safe to run more than once. Usage: bash supabase/tests/upgrade_test.sh
set -euo pipefail
DB=${DB:-bf_upgrade}
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"
su postgres -c "dropdb --if-exists $DB && createdb $DB"
su postgres -c "$PSQL -d $DB -f $DIR/tests/local_supabase_stub.sql"
for f in "$DIR"/migrations/000[1-7]_*.sql; do
  echo "Applying $(basename "$f")"
  su postgres -c "$PSQL -d $DB -f $f"
done
su postgres -c "$PSQL -d $DB -c \"insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'owner@example.com')\""
su postgres -c "$PSQL -d $DB -c \"insert into public.communications (owner_id, method, subject) values ('00000000-0000-0000-0000-000000000001', 'call', 'Existing call')\""
for run in 1 2; do
  echo "Applying UPDATE_0008_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d $DB -f $DIR/UPDATE_0008_RUN_ONCE.sql"
done
su postgres -c "$PSQL -d $DB" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert (select count(*) from public.targets) = 1, 'existing owner gets exactly one target';
  assert (select initiative_id is not null from public.targets where name = 'Network outreach'), 'target linked to Acquisition Search';
  assert (select is_outreach from public.communications where subject = 'Existing call') = false, 'existing communications default to not outreach';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename in ('targets', 'target_entries', 'target_misses') and policyname = 'owner_only') = 3, 'one policy per new table';
  assert (select count(*) from pg_trigger where tgname = 'log_change' and tgrelid in ('public.targets'::regclass, 'public.target_entries'::regclass, 'public.target_misses'::regclass)) = 3, 'one change log trigger per new table';
  assert (select count(*) from pg_constraint where conname = 'communications_outcome_check') = 1, 'one outcome check';
end $$;
select 'upgrade test passed' as result;
SQL
echo "Upgrade path passed (0008 applied twice)."
