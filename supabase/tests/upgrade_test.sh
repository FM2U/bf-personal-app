#!/usr/bin/env bash
# LOCAL TESTING ONLY: tests supabase/UPDATE_RUN_ONCE.sql (0008 + 0009) on the two possible live states:
#   (b) 0001 to 0007 plus an existing owner and data, then UPDATE_RUN_ONCE.sql twice (safe to run twice)
#   (c) 0001 to 0008 plus an existing owner and data, then UPDATE_RUN_ONCE.sql once
# Usage: bash supabase/tests/upgrade_test.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"

setup() { # $1 = database, $2 = last migration number to apply before the owner exists
  su postgres -c "dropdb --if-exists $1 && createdb $1"
  su postgres -c "$PSQL -d $1 -f $DIR/tests/local_supabase_stub.sql"
  for f in "$DIR"/migrations/*.sql; do
    n=$(basename "$f" | cut -c1-4)
    if [ "$n" \> "$2" ]; then continue; fi
    echo "[$1] Applying $(basename "$f")"
    su postgres -c "$PSQL -d $1 -f $f"
  done
  su postgres -c "$PSQL -d $1 -c \"insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'owner@example.com')\""
  su postgres -c "$PSQL -d $1 -c \"insert into public.communications (owner_id, method, subject) values ('00000000-0000-0000-0000-000000000001', 'call', 'Existing call')\""
  su postgres -c "$PSQL -d $1" <<'SQL'
\set ON_ERROR_STOP 1
insert into public.contacts (owner_id, name) values ('00000000-0000-0000-0000-000000000001', 'Existing contact');
insert into public.pipeline_items (owner_id, pipeline_id, stage_id, name)
select p.owner_id, p.id, s.id, 'Existing deal' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id
where p.name = 'Acquisitions' and s.name = 'Screened';
SQL
}

check() { # $1 = database
  su postgres -c "$PSQL -d $1" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  -- 0008
  assert (select count(*) from public.targets where name = 'Network outreach') = 1, 'exactly one Network outreach target';
  assert (select initiative_id is not null from public.targets where name = 'Network outreach'), 'target linked to Acquisition Search';
  assert (select is_outreach from public.communications where subject = 'Existing call') = false, 'existing communications default to not outreach';
  assert (select count(*) from pg_constraint where conname = 'communications_outcome_check') = 1, 'one outcome check';
  -- 0009
  assert (select count(*) from public.targets) = 3, 'three targets, no duplicates';
  assert (select count(*) from public.targets where name = 'Deals sourced' and count_source = 'deals_sourced' and minimum_count = 5) = 1, 'Deals sourced seeded once';
  assert (select count(*) from public.targets where name = 'Deals advanced' and count_source = 'deals_advanced' and minimum_count = 1) = 1, 'Deals advanced seeded once';
  assert (select start_date from public.targets where name = 'Deals advanced') = (now() at time zone 'America/New_York')::date, 'counting starts today (New York)';
  assert (select count(*) from public.stage_tasks) = 46, 'stage tasks seeded once';
  assert (select count(*) from public.inputs where key in ('pipeline_stall_days', 'stage_extension_days')) = 2, 'inputs seeded once';
  assert (select max_days_in_stage from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'Diligence') = 60, 'Diligence limit';
  assert (select purpose from public.communications where subject = 'Existing call') = 'general', 'existing communications get purpose general';
  assert (select is_deal_source from public.contacts where name = 'Existing contact') = false, 'existing contacts are not deal sources';
  assert (select deal_source_type from public.pipeline_items where name = 'Existing deal') is null, 'existing items keep an empty deal source';
  assert (select count(*) from pg_policies where schemaname = 'public' and policyname = 'owner_only'
          and tablename in ('targets', 'target_entries', 'target_misses', 'stage_tasks', 'pipeline_item_stage_extensions')) = 5, 'one policy per new table';
  assert (select count(*) from pg_trigger where tgname = 'log_change' and tgrelid in (
          'public.targets'::regclass, 'public.target_entries'::regclass, 'public.target_misses'::regclass,
          'public.stage_tasks'::regclass, 'public.pipeline_item_stage_extensions'::regclass)) = 5, 'one change log trigger per new table';
  assert (select count(*) from pg_trigger where tgname in ('pipeline_items_stage_tasks', 'pipeline_items_stage_defaults', 'communications_default_purpose')) = 3, 'one of each new trigger';
  assert (select count(*) from pg_constraint where conname in ('targets_count_source_check', 'decisions_source_check', 'communications_purpose_check', 'pipeline_items_deal_source_type_check', 'pipeline_stages_max_days_check')) = 5, 'one of each check';
end $$;
-- The existing item gets stage tasks when it moves to the next stage.
update public.pipeline_items set stage_id = (
  select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Acquisitions' and s.name = 'NDA signed'
) where name = 'Existing deal';
do $$ begin
  assert (select count(*) from public.tasks where title = 'Existing deal: Request CIM and financials') = 1, 'stage task created on move';
  assert (select next_action from public.pipeline_items where name = 'Existing deal') = 'Request CIM and financials', 'next action set on move';
end $$;
select 'upgrade checks passed' as result;
SQL
}

# (b) Live state today: 0001 to 0007 applied.
setup bf_upgrade_b 0007
for run in 1 2; do
  echo "[bf_upgrade_b] Applying UPDATE_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_b -f $DIR/UPDATE_RUN_ONCE.sql"
done
check bf_upgrade_b

# (c) 0001 to 0008 applied (the 0008 update was pasted first).
setup bf_upgrade_c 0008
echo "[bf_upgrade_c] Applying UPDATE_RUN_ONCE.sql"
su postgres -c "$PSQL -d bf_upgrade_c -f $DIR/UPDATE_RUN_ONCE.sql"
check bf_upgrade_c

echo "Upgrade paths passed: 0001-0007 + update twice, and 0001-0008 + update."
