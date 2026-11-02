-- BF Personal App: database update 0028 (AI instructions and Findings: strengths, risks, and the Buy box settings).
-- For a database that has 0001 to 0027 (the live database with 0001 to 0028 uses UPDATE_0029_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.
-- Expected result: "Success. No rows returned". Safe to run more than once: nothing is duplicated, nothing is deleted, no existing row changes.
-- What it adds:
--   pipeline_items.strengths and pipeline_items.risks (the Findings card's two lists, up to 3 lines each, read by every later AI
--   action on the deal), the Buy box settings rows (owner-operator yes, financing and growth goals empty) for each owner. schema_has_0028().
-- Generated from supabase/migrations/0028_ai_instructions_findings.sql by supabase/build_combined.py.

-- 0028: AI instructions and Findings (approved 2026-11-02). Depends on 0020 (pipeline item facts) and 0002 (inputs).
-- Safe to run more than once. Nothing is deleted and no existing row changes: two empty columns and three settings
-- rows are added.
--   1. pipeline_items.strengths and pipeline_items.risks: the Findings card's two short lists (jsonb arrays of text,
--      up to 3 lines each), filled by the Key finding star or typed, and read by every later AI action on the deal.
--   2. The Buy box settings (Settings, Buy box; inputs, category "Buy box") for every owner: owner-operator (yes),
--      financing (empty), growth goals (empty). The AI instructions read them on every click. A future owner gets the
--      rows on the first Save of the Buy box page (the app reads a missing row as its default).
--   3. schema_has_0028().

-- 1. The columns
alter table public.pipeline_items add column if not exists strengths jsonb;
alter table public.pipeline_items add column if not exists risks jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_strengths_check') then
    alter table public.pipeline_items add constraint pipeline_items_strengths_check check (strengths is null or (jsonb_typeof(strengths) = 'array' and jsonb_array_length(strengths) <= 3));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_risks_check') then
    alter table public.pipeline_items add constraint pipeline_items_risks_check check (risks is null or (jsonb_typeof(risks) = 'array' and jsonb_array_length(risks) <= 3));
  end if;
end $$;

-- 2. The Buy box settings, for every existing owner (a row that is there already is left as it is).
do $$
declare o record;
begin
  for o in select owner_id from public.owner_profile loop
    insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
      (o.owner_id, 'buy_box_owner_operator', 'Owner-operator (1 yes, 0 no)', 'Buy box', 'boolean', 1, null,
       'Whether the buyer runs the business himself. Read by the AI instructions on every deal and listing. Edited in Settings, Buy box.', 95),
      (o.owner_id, 'buy_box_financing', 'Financing', 'Buy box', 'text', null, null,
       'Optional, for example cash, SBA loan, seller note. Read by the AI instructions. Edited in Settings, Buy box.', 96),
      (o.owner_id, 'buy_box_growth_goals', 'Growth goals', 'Buy box', 'text', null, null,
       'Optional, one line. Read by the AI instructions. Edited in Settings, Buy box.', 97)
    on conflict (owner_id, key) do nothing;
  end loop;
end $$;

-- 3. Check function
create or replace function public.schema_has_0028()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0028() from public, anon;
grant execute on function public.schema_has_0028() to authenticated, service_role;
