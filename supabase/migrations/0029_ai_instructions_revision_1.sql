-- 0029: AI instructions revision 1 (approved 2026-11-02). Depends on 0028 (strengths, risks, the Buy box rows) and 0002
-- (inputs). Safe to run more than once.
--   1. pipeline_items.growth_paths: the Findings card's Growth paths (a jsonb array of text, up to 3 lines, the first is
--      the main one), filled by the Key finding star or typed, and read by every later AI action on the deal. Starts empty.
--   2. pipeline_items.financing: Facts, Financing: 'equity' (all equity, the default every row gets) or
--      'equity_plus_debt'. The AI is told about it only at Model, IOI or LOI, and Diligence.
--   3. The Buy box settings (Settings, Buy box; inputs, category "Buy box") for every owner, with the values the app
--      used before they were editable: core range $1M to $2.5M, stretch range $0.75M to $3.5M, industries "B2B
--      services", excluded types retail, direct to consumer, and franchises, regions Southeast and East Coast. A row that
--      is there already is left as it is. A future owner gets the rows on the first Save of the Buy box page (the app
--      reads a missing row as its default).
--   4. The one delete: the two settings revision 1 replaced, financing and growth goals (inputs rows with the keys
--      buy_box_financing and buy_box_growth_goals), are removed when they exist (their change history goes with them).
--      Nothing else is deleted.
--   5. schema_has_0029().

-- 1 and 2. The columns
alter table public.pipeline_items add column if not exists growth_paths jsonb;
alter table public.pipeline_items add column if not exists financing text not null default 'equity';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_growth_paths_check') then
    alter table public.pipeline_items add constraint pipeline_items_growth_paths_check check (growth_paths is null or (jsonb_typeof(growth_paths) = 'array' and jsonb_array_length(growth_paths) <= 3));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pipeline_items_financing_check') then
    alter table public.pipeline_items add constraint pipeline_items_financing_check check (financing in ('equity', 'equity_plus_debt'));
  end if;
end $$;

-- 3. The Buy box settings, for every existing owner (a row that is there already is left as it is).
do $$
declare o record;
begin
  for o in select owner_id from public.owner_profile loop
    insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
      (o.owner_id, 'buy_box_core_min', 'Core range from (EBITDA or SDE)', 'Buy box', 'usd', 1000000, null,
       'The low end of the core range. Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 90),
      (o.owner_id, 'buy_box_core_max', 'Core range to (EBITDA or SDE)', 'Buy box', 'usd', 2500000, null,
       'The high end of the core range. Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 91),
      (o.owner_id, 'buy_box_stretch_min', 'Stretch range from (EBITDA or SDE)', 'Buy box', 'usd', 750000, null,
       'The low end of the stretch range (a near fit). Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 92),
      (o.owner_id, 'buy_box_stretch_max', 'Stretch range to (EBITDA or SDE)', 'Buy box', 'usd', 3500000, null,
       'The high end of the stretch range (a near fit). Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 93),
      (o.owner_id, 'buy_box_industries', 'Industries included', 'Buy box', 'text', null, 'B2B services',
       'For example B2B services. Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 94),
      (o.owner_id, 'buy_box_excluded', 'Excluded types', 'Buy box', 'text', null, 'retail,direct_to_consumer,franchises',
       'Ticked types (retail, direct_to_consumer, franchises). Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 96),
      (o.owner_id, 'buy_box_excluded_other', 'Excluded types, other', 'Buy box', 'text', null, null,
       'Typed types, separated by commas. Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 97),
      (o.owner_id, 'buy_box_regions', 'Regions', 'Buy box', 'text', null, 'southeast,east_coast',
       'Ticked US regions (southeast, east_coast, midwest, southwest, west). Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 98),
      (o.owner_id, 'buy_box_regions_other', 'Regions, other', 'Buy box', 'text', null, null,
       'Typed regions or places, separated by commas. Read by the Fits check on Screen listings and by the AI instructions. Edited in Settings, Buy box.', 99)
    on conflict (owner_id, key) do nothing;
  end loop;
end $$;

-- 4. The two settings revision 1 replaced (financing and growth paths are per deal now). The only delete in this update.
delete from public.inputs where key in ('buy_box_financing', 'buy_box_growth_goals');

-- 5. Check function
create or replace function public.schema_has_0029()
returns boolean
language sql
stable
as $$ select true $$;

revoke execute on function public.schema_has_0029() from public, anon;
grant execute on function public.schema_has_0029() to authenticated, service_role;
