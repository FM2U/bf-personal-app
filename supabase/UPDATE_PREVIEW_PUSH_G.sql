-- BF Personal App: update for the speed plan of 2026-11-07 (push G). For the NEW database (bf-personal-app-final) that
-- already has SETUP_NEW_DATABASE.sql and the updates B, C, D, E, E2 and F run. SQL Editor, New query, paste this whole
-- file, Run. Safe to run twice.
--
-- What it changes:
--   Adds one read-only database function, read_batch, that answers all of a page's reads in one trip (speed plan,
--   claude/2026-11-07-speed-plan.md). No table, column or row changes. Until this runs, the app reads the old way.
--
-- The last statement is a check. Expected result: one row, push_g_ready = true.

do $$
begin
  -- Stops here, changing nothing, on the old database, on an empty one, or before the push F update.
  if to_regclass('public.contacts') is null then
    raise exception 'This database does not have the app''s tables yet. Run SETUP_NEW_DATABASE.sql first. Nothing was changed.';
  end if;
  if to_regclass('public.tasks') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_reports' and column_name = 'partner_id') then
    raise exception 'This is the old database. Run this file only in the new project (bf-personal-app-final). Nothing was changed.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'end_of_day' and column_name = 'skipped_partners') then
    raise exception 'Run UPDATE_PREVIEW_PUSH_F.sql first (and the updates before it), then this file. Nothing was changed.';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- One trip per page (speed plan, Bram 2026-11-07; claude/2026-11-07-speed-plan.md).
-- read_batch runs a list of reads in one trip and returns one answer per read, in order. Each read is a table, its
-- columns, a condition, an order, a limit and whether a count is wanted, the same things a page asks for one at a
-- time today. It only reads: no read can change data. It runs as the signed-in user (security invoker), so the same
-- "only your own rows" rules apply as to every other read. Columns and tables are checked by name; values are passed
-- as quoted values; only the listed comparisons are allowed. A read that fails returns its error and the others go on.
-- The app (src/lib/supabase/batch.ts) builds the reads; a page with this function missing reads the old way.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.read_batch_name(n text) returns text
language plpgsql immutable set search_path = public as $$
begin
  if n is null or n !~ '^[a-z_][a-z0-9_]{0,62}$' then
    raise exception 'read_batch: not a plain name: %', coalesce(n, 'null') using errcode = '22023';
  end if;
  return quote_ident(n);
end $$;

create or replace function public.read_batch_cond(c jsonb) returns text
language plpgsql immutable set search_path = public as $$
declare
  s text;
  col text;
  op text := c->>'o';
  vals text[];
begin
  if c ? 'and' then
    select string_agg(public.read_batch_cond(e), ' and ') into s from jsonb_array_elements(c->'and') e;
    return '(' || coalesce(s, 'true') || ')';
  elsif c ? 'or' then
    select string_agg(public.read_batch_cond(e), ' or ') into s from jsonb_array_elements(c->'or') e;
    return '(' || coalesce(s, 'false') || ')';
  end if;
  col := public.read_batch_name(c->>'c');
  case op
    when 'eq' then s := format('%s = %L', col, c->>'v');
    when 'neq' then s := format('%s <> %L', col, c->>'v');
    when 'gt' then s := format('%s > %L', col, c->>'v');
    when 'gte' then s := format('%s >= %L', col, c->>'v');
    when 'lt' then s := format('%s < %L', col, c->>'v');
    when 'lte' then s := format('%s <= %L', col, c->>'v');
    when 'like' then s := format('%s::text like %L', col, replace(c->>'v', '*', '%'));
    when 'ilike' then s := format('%s::text ilike %L', col, replace(c->>'v', '*', '%'));
    when 'cs' then s := format('%s @> %L', col, c->>'v');
    when 'is' then
      if c->>'v' not in ('null', 'true', 'false') then
        raise exception 'read_batch: is.% not supported', c->>'v' using errcode = '22023';
      end if;
      s := format('%s is %s', col, c->>'v');
    when 'in' then
      select array_agg(e) into vals from jsonb_array_elements_text(c->'v') e;
      s := case when coalesce(cardinality(vals), 0) = 0 then 'false' else format('%s::text = any(%L::text[])', col, vals) end;
    else
      raise exception 'read_batch: comparison % not supported', coalesce(op, 'null') using errcode = '22023';
  end case;
  if coalesce((c->>'n')::boolean, false) then
    s := 'not (' || s || ')';
  end if;
  return s;
end $$;

create or replace function public.read_batch(p_reads jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  r jsonb;
  results jsonb := '[]'::jsonb;
  tbl text;
  cols text;
  cond text;
  ord text;
  lim text;
  off text;
  got jsonb;
  total bigint;
begin
  if jsonb_typeof(p_reads) is distinct from 'array' or jsonb_array_length(p_reads) > 300 then
    raise exception 'read_batch: expects a list of at most 300 reads' using errcode = '22023';
  end if;
  for r in select value from jsonb_array_elements(p_reads) loop
    begin
      tbl := public.read_batch_name(r->>'t');
      if r->'s' is null or r->'s' = '["*"]'::jsonb then
        cols := '*';
      else
        select string_agg(public.read_batch_name(e), ', ') into cols from jsonb_array_elements_text(r->'s') e;
      end if;
      cond := case when r ? 'w' then public.read_batch_cond(r->'w') else 'true' end;
      select string_agg(public.read_batch_name(e->>'c') || case when coalesce((e->>'d')::boolean, false) then ' desc' else ' asc' end
               || case when e->>'nf' = 'true' then ' nulls first' when e->>'nf' = 'false' then ' nulls last' else '' end, ', ')
        into ord from jsonb_array_elements(coalesce(r->'o', '[]'::jsonb)) e;
      lim := case when r ? 'l' then ' limit ' || (r->>'l')::int else '' end;
      off := case when r ? 'f' then ' offset ' || (r->>'f')::int else '' end;
      got := null;
      total := null;
      if not coalesce((r->>'h')::boolean, false) then
        execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select %s from %s where %s%s%s%s) t',
                       cols, tbl, cond, case when ord is null then '' else ' order by ' || ord end, lim, off)
          into got;
      end if;
      if coalesce((r->>'n')::boolean, false) then
        execute format('select count(*) from %s where %s', tbl, cond) into total;
      end if;
      results := results || jsonb_build_array(jsonb_build_object('d', got, 'n', total));
    exception when others then
      results := results || jsonb_build_array(jsonb_build_object('e', jsonb_build_object('code', sqlstate, 'message', sqlerrm)));
    end;
  end loop;
  return results;
end $$;

revoke all on function public.read_batch(jsonb) from public, anon;
revoke all on function public.read_batch_cond(jsonb) from public, anon;
revoke all on function public.read_batch_name(text) from public, anon;
grant execute on function public.read_batch(jsonb) to authenticated;
grant execute on function public.read_batch_cond(jsonb) to authenticated;
grant execute on function public.read_batch_name(text) to authenticated;

select to_regprocedure('public.read_batch(jsonb)') is not null as push_g_ready;
