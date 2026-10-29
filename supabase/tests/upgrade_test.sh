#!/usr/bin/env bash
# LOCAL TESTING ONLY: tests supabase/UPDATE_RUN_ONCE.sql (0008 to 0011) and supabase/UPDATE_0011_RUN_ONCE.sql on the possible live states:
#   (b) 0001 to 0007 plus an existing owner and data, then UPDATE_RUN_ONCE.sql twice (safe to run twice)
#   (c) 0001 to 0008 plus an existing owner and data, then UPDATE_RUN_ONCE.sql once
#   (d) 0001 to 0009 (as first released: every stage task a commitment) plus an owner and data, then UPDATE_RUN_ONCE.sql twice
#   (e) 0001 to 0010 plus an owner and data, then UPDATE_0011_RUN_ONCE.sql twice (the reference file still works)
#   (f) 0001 to 0010 (the live database on 2026-10-26) plus an owner and data, then UPDATE_0011_0012_RUN_ONCE.sql twice
#   (g) 0001 to 0011 plus an owner and data (UPDATE_0011 was run first), then UPDATE_0011_0012_RUN_ONCE.sql twice
#   (h) 0001 to 0011, then UPDATE_0012_RUN_ONCE.sql twice
#   (i) 0001 to 0012 (the live database on 2026-10-26, evening) plus an owner and data, then UPDATE_0013_RUN_ONCE.sql twice
#   (j) 0001 to 0012 plus an owner and data, then UPDATE_0013_0014_RUN_ONCE.sql twice
#   (k) 0001 to 0013 plus an owner and data, then UPDATE_0013_0014_RUN_ONCE.sql twice
#   (l) 0001 to 0013, then UPDATE_0014_RUN_ONCE.sql twice
#   (m) 0001 to 0014 (the live database on 2026-10-28) plus an owner and data, then UPDATE_0015_RUN_ONCE.sql twice
#   (n) 0001 to 0015 (the live database on 2026-10-28, evening) plus an owner and data, then UPDATE_0016_RUN_ONCE.sql twice
# Paths b, c, d (UPDATE_RUN_ONCE.sql) and j, k, l also check 0014: tables, policies, functions, sample removal, and reset.
# Every UPDATE_RUN_ONCE.sql path also checks 0012 and 0013.
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
-- 0009 as first released made every stage task a commitment (only for a database without 0010).
do $$ begin
  if to_regclass('public.stage_tasks') is not null and not exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'times_moved') then
    execute 'update public.stage_tasks set is_commitment = true';
  end if;
end $$;
insert into public.pipeline_items (owner_id, pipeline_id, stage_id, name)
select p.owner_id, p.id, s.id, 'Existing deal' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id
where p.name = 'Acquisitions' and s.name = 'Screened';
-- Tasks from recurring templates with commitments (the 0007 defaults): the monthly export (now a regular task,
-- missed, with a pending reason, an alert, and a "Resolve missed commitment" task) and the daily close (still a commitment).
insert into public.tasks (owner_id, title, due_date, source, source_key, template_id)
select owner_id, title, current_date - 2, 'template', 'template:' || id || ':old', id from public.task_templates
where title in ('Download the full data export (Settings, Export)', 'Complete the daily close');
insert into public.commitments (owner_id, title, record_type, record_id, due_date, original_due_date, status, miss_count)
select owner_id, title, 'tasks', id, due_date, due_date, case when title like 'Download%' then 'missed' else 'open' end,
       case when title like 'Download%' then 1 else 0 end
from public.tasks where source = 'template';
insert into public.missed_commitments (owner_id, commitment_id, missed_on)
select owner_id, id, due_date from public.commitments where title like 'Download%';
insert into public.alerts (owner_id, kind, message, related_type, related_id, dedupe_key)
select owner_id, 'missed_commitment', 'Missed commitment: ' || title, 'commitments', id, 'miss:' || id || ':' || due_date from public.commitments where title like 'Download%';
insert into public.tasks (owner_id, title, due_date, source, source_key, related_type, related_id, priority)
select owner_id, 'Resolve missed commitment: ' || title, current_date, 'missed_commitment', 'miss:' || id || ':' || due_date, 'commitments', id, 1
from public.commitments where title like 'Download%';
-- A regular task the owner marked as a commitment by hand stays one.
insert into public.tasks (owner_id, title, due_date) values ('00000000-0000-0000-0000-000000000001', 'Hand-marked task', current_date + 1);
insert into public.commitments (owner_id, title, record_type, record_id, due_date, original_due_date)
select owner_id, title, 'tasks', id, due_date, due_date from public.tasks where title = 'Hand-marked task';
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
  assert (select count(*) from public.targets) = 6, 'six targets (0008, 0009, 0016), no duplicates';
  assert (select count(*) from public.targets where name in ('Listings screened', 'CIMs reviewed', 'Broker or owner calls')) = 3, '0016 targets seeded once';
  assert (select count(*) from public.targets where name = 'Deals sourced' and count_source = 'deals_sourced' and minimum_count = 5) = 1, 'Deals sourced seeded once';
  assert (select count(*) from public.targets where name = 'Deals advanced' and count_source = 'deals_advanced' and minimum_count = 1) = 1, 'Deals advanced seeded once';
  assert (select start_date from public.targets where name = 'Deals advanced') = (now() at time zone 'America/New_York')::date, 'counting starts today (New York)';
  assert (select count(*) from public.stage_tasks) = 60, 'stage tasks seeded once (46 plus 14 consulting)';
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
do $$ begin
  -- 0010
  assert exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'times_moved'), 'tasks.times_moved';
  assert (select count(*) from public.inputs where key = 'task_moved_review_threshold' and value_number = 5) = 1, 'moved threshold input once';
  assert (select count(*) from public.task_templates where is_commitment) = 4, 'only review templates are commitments';
  assert (select count(*) from public.task_templates where is_commitment and not public.is_review_template_title(title)) = 0, 'no other template is a commitment';
  assert (select count(*) from public.stage_tasks where is_commitment <> is_next_action_default) = 0, 'only next-action stage tasks are commitments';
  assert (select count(*) from public.stage_tasks) = 60, 'stage tasks not duplicated';
  assert (select status from public.commitments where title like 'Download%') = 'released', 'export commitment released';
  assert (select resolution from public.missed_commitments m join public.commitments c on c.id = m.commitment_id where c.title like 'Download%') = 'released', 'pending miss released';
  assert (select count(*) from public.alerts a join public.commitments c on c.id = a.related_id where c.title like 'Download%' and a.status = 'open') = 0, 'miss alert dismissed';
  assert (select status from public.tasks where title like 'Resolve missed commitment: Download%') = 'skipped', 'resolve task skipped';
  assert (select status from public.commitments where title = 'Complete the daily close') = 'open', 'daily close commitment kept';
  assert (select status from public.commitments where title = 'Hand-marked task') = 'open', 'hand-marked commitment kept';
  assert (select count(*) from public.commitments c where c.title like 'Existing deal: %' and c.status not in ('open', 'released')) = 0, 'no deal commitment missed';
  assert (select count(*) from public.commitments where title = 'Existing deal: Request CIM and financials' and status = 'open') = 1, 'next-action commitment for NDA signed';
  assert (select count(*) from public.commitments c join public.tasks t on t.id = c.record_id join public.stage_tasks st on st.id::text = split_part(t.source_key, ':', 3)
          where t.title like 'Existing deal: %' and c.status = 'open' and not st.is_next_action_default) = 0, 'no open commitment on a task that is not the next action';
  assert (select count(*) from public.commitments where title = 'Existing deal: Request CIM' and status = 'open') = 0, 'non next-action stage task is not an open commitment';
  assert (select commitment_rule_applied_at is not null from public.owner_profile), 'rule applied once';
  assert (select count(*) from pg_constraint where conname in ('commitments_status_check', 'missed_commitments_resolution_check')) = 2, 'one of each status check';
end $$;
select 'upgrade checks passed' as result;
SQL
}

check11() { # $1 = database: 0011 seeded once, existing data kept
  su postgres -c "$PSQL -d $1" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert (select count(*) from public.pipelines where name = 'Consulting' and kind = 'consulting') = 1, 'one Consulting pipeline';
  assert (select count(*) from public.initiatives where name = 'Consulting') = 1, 'one Consulting initiative';
  assert (select count(*) from public.pipelines) = 6, 'six pipelines';
  assert (select count(*) from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting') = 9, 'nine consulting stages';
  assert (select count(*) from public.stage_tasks st join public.pipeline_stages s on s.id = st.pipeline_stage_id join public.pipelines p on p.id = s.pipeline_id where p.name = 'Consulting') = 14, 'consulting stage tasks once';
  assert (select count(*) from public.stage_tasks) = 60, 'all stage tasks once';
  assert (select count(*) from public.inputs where key in ('runway_include_signed_consulting', 'consulting_monthly_income', 'consulting_months')) = 3, 'consulting inputs once';
  assert (select count(*) from public.pipeline_stages where counts_as_signed) = 2, 'two signed-work stages';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'consulting_details' and policyname = 'owner_only') = 1, 'consulting policy';
  assert (select count(*) from pg_trigger where tgname = 'log_change' and tgrelid = 'public.consulting_details'::regclass) = 1, 'consulting change log';
  assert (select relrowsecurity from pg_class where oid = 'public.consulting_details'::regclass), 'consulting RLS';
  assert (select count(*) from pg_constraint where conname in ('pipelines_kind_check', 'communications_purpose_check', 'pipeline_stages_probability_check')) = 3, 'one of each 0011 check';
  assert (select introduced_by_contact_id from public.pipeline_items where name = 'Existing deal') is null, 'existing items keep an empty introduced by';
  assert (select is_consulting_lead from public.contacts where name = 'Existing contact') = false, 'existing contacts are not consulting leads';
  assert (select purpose from public.communications where subject = 'Existing call') = 'general', 'existing communication purpose kept';
  assert (select count(*) from public.targets where name not in ('Listings screened', 'CIMs reviewed', 'Broker or owner calls')) = 3, 'no consulting target';
end $$;
-- A new consulting item gets its stage tasks.
insert into public.pipeline_items (owner_id, pipeline_id, stage_id, name)
select p.owner_id, p.id, s.id, 'Upgrade consulting item' from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id
where p.name = 'Consulting' and s.name = 'Identified';
do $$ begin
  assert (select count(*) from public.tasks where title like 'Upgrade consulting item: %') = 2, 'consulting stage tasks on create';
  assert (select next_action from public.pipeline_items where name = 'Upgrade consulting item') = 'Research the client and their need', 'consulting next action';
end $$;
delete from public.pipeline_items where name = 'Upgrade consulting item';
select '0011 checks passed' as result;
SQL
}

check12() { # $1 = database: 0012 applied once, existing data kept
  su postgres -c "$PSQL -d $1" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert (select count(*) from pg_constraint where conname = 'contacts_relationship_group_check') = 1, 'one relationship group check';
  assert to_regprocedure('public.schema_has_0012()') is not null, 'check function';
  assert (select count(*) from public.inputs where key = 'runway_include_signed_consulting') = 1, 'runway setting once';
  assert (select description like '%until the item''s first payment is received%' from public.inputs where key = 'runway_include_signed_consulting'), 'runway setting text updated';
  assert (select relationship_group from public.contacts where name = 'Existing contact') is null, 'existing contact group kept';
end $$;
insert into public.contacts (owner_id, name, relationship_group) values ('00000000-0000-0000-0000-000000000001', 'Upgrade friend', 'friend'), ('00000000-0000-0000-0000-000000000001', 'Upgrade other', 'other');
delete from public.contacts where name in ('Upgrade friend', 'Upgrade other');
select '0012 checks passed' as result;
SQL
}

check13() { # $1 = database: 0013 applied, existing rows kept with empty Gmail ids
  su postgres -c "$PSQL -d $1" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert to_regprocedure('public.schema_has_0013()') is not null, '0013 check function';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'communications' and column_name in ('gmail_message_id', 'gmail_thread_id')) = 2, 'communications Gmail ids';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name in ('sent_at', 'gmail_message_id')) = 2, 'partner report sent columns';
  assert (select gmail_message_id from public.communications where subject = 'Existing call') is null, 'existing communication has no Gmail id';
  assert (select count(*) from pg_indexes where indexname = 'communications_gmail_message_idx') = 1, 'one Gmail id index';
end $$;
select '0013 checks passed' as result;
SQL
}

check14() { # $1 = database: 0014 applied once, existing data kept, reset and sample removal work as the owner
  su postgres -c "$PSQL -d $1" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert to_regprocedure('public.schema_has_0014()') is not null, '0014 check function';
  assert to_regprocedure('public.reset_all_data(text)') is not null, 'reset function';
  assert to_regprocedure('public.remove_sample_data()') is not null, 'sample removal function';
  assert to_regprocedure('public.insert_record_batch(jsonb,text,uuid)') is not null, 'batch function';
  assert (select count(*) from pg_policies where schemaname = 'public' and policyname = 'owner_only'
          and tablename in ('plan_documents', 'checklists', 'checklist_items', 'savings_ideas', 'initiative_drafts', 'sample_records')) = 6, 'one policy per 0014 table';
  assert (select count(*) from pg_trigger where tgname = 'log_change' and tgrelid in (
          'public.plan_documents'::regclass, 'public.checklists'::regclass, 'public.checklist_items'::regclass,
          'public.savings_ideas'::regclass, 'public.initiative_drafts'::regclass)) = 5, 'one change log trigger per 0014 table (none on sample_records)';
  assert (select count(*) from pg_trigger where tgname = 'log_change' and tgrelid = 'public.sample_records'::regclass) = 0, 'sample_records not logged';
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.checklists'::regclass, 'public.sample_records'::regclass, 'public.savings_ideas'::regclass)), '0014 RLS';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'initiatives' and column_name = 'parent_initiative_id') or (table_name = 'goals' and column_name = 'metric_params'))) = 2, '0014 columns';
  assert exists (select 1 from public.contacts where name = 'Existing contact'), 'existing data kept';
  assert (select count(*) from public.initiatives) = 6, 'initiatives unchanged';
end $$;
-- The existing owner can load and remove sample rows, then reset.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.aal', 'aal2', false);
do $$
declare v jsonb;
begin
  perform public.insert_record_batch('[{"table":"contacts","rows":[{"name":"Sample Friend A"}]}]'::jsonb, 'owner', gen_random_uuid());
  v := public.remove_sample_data();
  assert (v ->> 'total')::int = 1, 'one sample row removed';
  assert exists (select 1 from public.contacts where name = 'Existing contact'), 'real contact kept by sample removal';
  v := public.reset_all_data('RESET');
  assert not exists (select 1 from public.contacts), 'reset deleted contacts';
  assert (select count(*) from public.pipelines) = 6 and (select count(*) from public.task_templates) > 0, 'reset kept setup';
end $$;
reset role;
select '0014 checks passed' as result;
SQL
}

# Existing owner edited the runway setting text: 0012 keeps the edit.
edited_text() { # $1 = database
  su postgres -c "$PSQL -d $1 -c \"update public.inputs set description = 'My own note' where key = 'runway_include_signed_consulting'\""
}

# (b) Live state today: 0001 to 0007 applied.
setup bf_upgrade_b 0007
for run in 1 2; do
  echo "[bf_upgrade_b] Applying UPDATE_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_b -f $DIR/UPDATE_RUN_ONCE.sql"
done
check bf_upgrade_b
check11 bf_upgrade_b

# (c) 0001 to 0008 applied (the 0008 update was pasted first).
setup bf_upgrade_c 0008
echo "[bf_upgrade_c] Applying UPDATE_RUN_ONCE.sql"
su postgres -c "$PSQL -d bf_upgrade_c -f $DIR/UPDATE_RUN_ONCE.sql"
check bf_upgrade_c
check11 bf_upgrade_c

# (d) 0001 to 0009 applied (as first released), then the update twice.
setup bf_upgrade_d 0009
for run in 1 2; do
  echo "[bf_upgrade_d] Applying UPDATE_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_d -f $DIR/UPDATE_RUN_ONCE.sql"
done
check bf_upgrade_d
check11 bf_upgrade_d

# (e) Live state on 2026-10-26: 0001 to 0010 applied, then UPDATE_0011_RUN_ONCE.sql twice.
setup bf_upgrade_e 0010
for run in 1 2; do
  echo "[bf_upgrade_e] Applying UPDATE_0011_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_e -f $DIR/UPDATE_0011_RUN_ONCE.sql"
done
check11 bf_upgrade_e

# (f) Live state on 2026-10-26: 0001 to 0010 applied, then UPDATE_0011_0012_RUN_ONCE.sql twice.
setup bf_upgrade_f 0010
for run in 1 2; do
  echo "[bf_upgrade_f] Applying UPDATE_0011_0012_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_f -f $DIR/UPDATE_0011_0012_RUN_ONCE.sql"
done
check11 bf_upgrade_f
check12 bf_upgrade_f

# (g) 0001 to 0011 applied (the owner ran the old UPDATE_0011 text first), then UPDATE_0011_0012_RUN_ONCE.sql twice.
setup bf_upgrade_g 0010
echo "[bf_upgrade_g] Applying the 0011 update as first released (original runway setting text)"
sed "s/ until the item''s first payment is received. After that, its payments are already in average monthly income.', 45)/.', 45)/" "$DIR/UPDATE_0011_RUN_ONCE.sql" > /tmp/bf_old_0011.sql
grep -qF "is added to average monthly income in the runway formula.', 45)" /tmp/bf_old_0011.sql
su postgres -c "$PSQL -d bf_upgrade_g -f /tmp/bf_old_0011.sql"
for run in 1 2; do
  echo "[bf_upgrade_g] Applying UPDATE_0011_0012_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_g -f $DIR/UPDATE_0011_0012_RUN_ONCE.sql"
done
check11 bf_upgrade_g
check12 bf_upgrade_g

# (h) 0001 to 0011 with an edited runway setting text, then UPDATE_0012_RUN_ONCE.sql twice: the edit is kept.
setup bf_upgrade_h 0011
edited_text bf_upgrade_h
for run in 1 2; do
  echo "[bf_upgrade_h] Applying UPDATE_0012_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_h -f $DIR/UPDATE_0012_RUN_ONCE.sql"
done
su postgres -c "$PSQL -d bf_upgrade_h" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert (select description from public.inputs where key = 'runway_include_signed_consulting') = 'My own note', 'edited text kept';
end $$;
SQL

for db in bf_upgrade_b bf_upgrade_c bf_upgrade_d; do check12 $db; check13 $db; check14 $db; done

# (i) Live state: 0001 to 0012 applied, then UPDATE_0013_RUN_ONCE.sql twice.
setup bf_upgrade_i 0012
for run in 1 2; do
  echo "[bf_upgrade_i] Applying UPDATE_0013_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_i -f $DIR/UPDATE_0013_RUN_ONCE.sql"
done
check11 bf_upgrade_i
check12 bf_upgrade_i
check13 bf_upgrade_i

# (j) Live state on 2026-10-27: 0001 to 0012 applied, then UPDATE_0013_0014_RUN_ONCE.sql twice.
setup bf_upgrade_j 0012
for run in 1 2; do
  echo "[bf_upgrade_j] Applying UPDATE_0013_0014_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_j -f $DIR/UPDATE_0013_0014_RUN_ONCE.sql"
done
check11 bf_upgrade_j
check12 bf_upgrade_j
check13 bf_upgrade_j
check14 bf_upgrade_j

# (k) 0001 to 0013 applied (the owner ran UPDATE_0013_RUN_ONCE.sql first), then UPDATE_0013_0014_RUN_ONCE.sql twice.
setup bf_upgrade_k 0013
for run in 1 2; do
  echo "[bf_upgrade_k] Applying UPDATE_0013_0014_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_k -f $DIR/UPDATE_0013_0014_RUN_ONCE.sql"
done
check13 bf_upgrade_k
check14 bf_upgrade_k

# (l) 0001 to 0013, then UPDATE_0014_RUN_ONCE.sql twice.
setup bf_upgrade_l 0013
for run in 1 2; do
  echo "[bf_upgrade_l] Applying UPDATE_0014_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_l -f $DIR/UPDATE_0014_RUN_ONCE.sql"
done
check14 bf_upgrade_l

# (m) Live state on 2026-10-28: 0001 to 0014 applied, then UPDATE_0015_RUN_ONCE.sql twice. The owner profile is kept.
setup bf_upgrade_m 0014
su postgres -c "$PSQL -d bf_upgrade_m -c \"update public.owner_profile set display_name = 'Kept name'\""
for run in 1 2; do
  echo "[bf_upgrade_m] Applying UPDATE_0015_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_m -f $DIR/UPDATE_0015_RUN_ONCE.sql"
done
su postgres -c "$PSQL -d bf_upgrade_m" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'owner_profile'
          and column_name in ('email_signature_html', 'email_signature_text', 'email_signature_enabled', 'email_signature_updated_at')) = 4, '0015 columns';
  assert to_regprocedure('public.schema_has_0015()') is not null, '0015 check function';
  assert (select display_name from public.owner_profile limit 1) = 'Kept name', 'owner profile kept';
  assert (select email_signature_html is null and email_signature_enabled is null from public.owner_profile limit 1), '0015 columns start empty';
end $$;
select '0015 checks passed' as result;
SQL
for f in UPDATE_RUN_ONCE ALL_MIGRATIONS_RUN_ONCE; do grep -q "email_signature_html" "$DIR/$f.sql" || { echo "$f.sql is missing 0015"; exit 1; }; done

# (n) Live state on 2026-10-28 (evening): 0001 to 0015 applied, an owner with an edited target and a manual count,
# then UPDATE_0016_RUN_ONCE.sql twice. Three targets and five inputs are added once; nothing existing changes.
setup bf_upgrade_n 0015
su postgres -c "$PSQL -d bf_upgrade_n" <<'SQL'
\set ON_ERROR_STOP 1
update public.targets set minimum_count = 4 where name = 'Network outreach';
insert into public.targets (owner_id, name, count_source) values ('00000000-0000-0000-0000-000000000001', 'Own manual target', 'manual');
insert into public.target_entries (owner_id, target_id, count) select owner_id, id, 3 from public.targets where name = 'Own manual target';
SQL
for run in 1 2; do
  echo "[bf_upgrade_n] Applying UPDATE_0016_RUN_ONCE.sql (run $run)"
  su postgres -c "$PSQL -d bf_upgrade_n -f $DIR/UPDATE_0016_RUN_ONCE.sql"
done
su postgres -c "$PSQL -d bf_upgrade_n" <<'SQL'
\set ON_ERROR_STOP 1
do $$ begin
  assert (select count(*) from public.targets) = 7, 'three 0016 targets added once (3 from 0008 and 0009, 1 own, 3 new)';
  assert (select count(*) from public.targets where name = 'Listings screened' and count_source = 'manual' and minimum_count = 20 and period = 'day') = 1, 'Listings screened';
  assert (select count(*) from public.targets where name = 'CIMs reviewed' and count_source = 'cims_reviewed' and minimum_count = 1) = 1, 'CIMs reviewed';
  assert (select count(*) from public.targets where name = 'Broker or owner calls' and count_source = 'deal_calls' and period = 'week' and minimum_count = 2) = 1, 'Broker or owner calls';
  assert (select bool_and(is_commitment and start_date = (now() at time zone 'America/New_York')::date) from public.targets
          where name in ('Listings screened', 'CIMs reviewed', 'Broker or owner calls')), 'commitments counting from today (New York)';
  assert (select minimum_count from public.targets where name = 'Network outreach') = 4, 'edited target kept';
  assert (select sum(count) from public.target_entries) = 3, 'manual counts kept';
  assert (select count(*) from public.inputs where key in ('search_hours_per_day', 'minutes_per_listing_screen', 'minutes_per_cim_review', 'minutes_per_nda_reply', 'minutes_per_call')) = 5, 'five inputs once';
  assert to_regprocedure('public.schema_has_0016()') is not null, '0016 check function';
  assert (select prosrc from pg_proc where proname = 'handle_new_owner') like '%seed_owner_deal_funnel%', 'owner setup seeds 0016';
end $$;
-- A second owner (future owners) gets the targets from the owner setup function.
delete from auth.users where id = '00000000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002', 'next@example.com');
do $$ begin
  assert (select count(*) from public.targets where owner_id = '00000000-0000-0000-0000-000000000002'
          and name in ('Listings screened', 'CIMs reviewed', 'Broker or owner calls')) = 3, 'future owner gets the 0016 targets';
end $$;
select '0016 checks passed' as result;
SQL
for f in UPDATE_RUN_ONCE ALL_MIGRATIONS_RUN_ONCE; do grep -q "seed_owner_deal_funnel" "$DIR/$f.sql" || { echo "$f.sql is missing 0016"; exit 1; }; done

echo "Upgrade paths passed: 0001-0007 + update twice, 0001-0008 + update, 0001-0009 + update twice, 0001-0010 + 0011 update twice,"
echo "0001-0010 + 0011_0012 update twice, 0001-0011 + 0011_0012 update twice, 0001-0011 + 0012 update twice (edited text kept),"
echo "0001-0012 + 0013 update twice, 0001-0012 + 0013_0014 update twice, 0001-0013 + 0013_0014 update twice, 0001-0013 + 0014 update twice,"
echo "0001-0014 + 0015 update twice, 0001-0015 + 0016 update twice (future owner too)."
