-- BF Personal App: the final app's database, in one file (2026-11-02).
--
-- Run once, in a NEW and EMPTY Supabase project: SQL Editor, New query, paste this whole file, Run.
-- Then create the owner account in the app (the first sign-up); that account gets the default pipelines, stages,
-- stage next actions and settings. Only one account can ever exist.
--
-- The old database (the first Supabase project) is not touched by this file.
-- Built from the 29 old updates with the old modules cut out (see docs in the project: 2026-11-02 build plan).
-- Push B (2026-11-03) is included: People and Organizations, partner report days and sections, Gmail replies.

-- Stops here, changing nothing, if this database already has the app's tables (for example the old project).
do $$
begin
  if to_regclass('public.pipeline_items') is not null or to_regclass('public.contacts') is not null then
    raise exception 'This database already has the app''s tables. Run this file only in the new, empty project (bf-personal-app-final). Nothing was changed.';
  end if;
end $$;

--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: before_pipeline_item(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.before_pipeline_item() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_outcome text;
begin
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    new.stage_entered_at = now();
    select outcome into v_outcome from public.pipeline_stages where id = new.stage_id;
    if v_outcome is not null then
      new.status = v_outcome;
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: communication_default_purpose(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.communication_default_purpose() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.purpose is null then
    new.purpose := case
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_consulting_lead) then 'consulting'
      when exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_deal_source) then 'deal_sourcing'
      else 'general'
    end;
  end if;
  return new;
end;
$$;


--
-- Name: communications_touch_contact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.communications_touch_contact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.contact_id is not null then
    perform public.refresh_contact_last_contact(new.contact_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.contact_id is not null and (tg_op = 'DELETE' or old.contact_id is distinct from new.contact_id) then
    perform public.refresh_contact_last_contact(old.contact_id);
  end if;
  return null;
end;
$$;


--
-- Name: current_actor(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_actor() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select coalesce(
    nullif(current_setting('app.actor', true), ''),
    case when auth.role() = 'service_role' then 'system' else 'owner' end
  )
$$;


--
-- Name: deal_todos_before(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deal_todos_before() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.record_id is null and new.deal_id is not null then
    new.record_type := 'pipeline_items';
    new.record_id := new.deal_id;
  end if;
  if new.record_type = 'pipeline_items' and new.deal_id is null then
    new.deal_id := new.record_id;
  end if;
  if new.record_id is null then
    raise exception 'A task needs a record';
  end if;
  return new;
end;
$$;


--
-- Name: delete_record_tasks(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_record_tasks() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.deal_todos where record_type = tg_table_name and record_id = old.id;
  return old;
end;
$$;


--
-- Name: enforce_single_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_single_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
begin
  if exists (select 1 from auth.users where id <> new.id) then
    raise exception 'This app allows one owner account only.';
  end if;
  return new;
end;
$$;


--
-- Name: insert_record_batch(jsonb, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_record_batch(p_batches jsonb, p_actor text DEFAULT 'owner'::text, p_sample_batch uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_owner uuid := auth.uid();
  b jsonb;
  r jsonb;
  v_table text;
  v_op text;
  v_row jsonb;
  v_cols text;
  v_id uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
  allowed text[] := array[
    'targets', 'record_links', 'notes', 'todos', 'projects', 'deal_todos', 'organizations', 'contacts',
    'communications', 'pipeline_items', 'deal_financials', 'consulting_details', 'work_events', 'end_of_day', 'partner_reports'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can save these records';
  end if;
  if jsonb_typeof(p_batches) <> 'array' then
    raise exception 'p_batches must be a list';
  end if;
  if p_actor in ('ai', 'owner') then
    perform set_config('app.actor', p_actor, true);
  end if;
  if p_sample_batch is not null then
    perform set_config('app.skip_change_log', 'on', true);
  end if;

  for b in select * from jsonb_array_elements(p_batches) loop
    v_table := b ->> 'table';
    v_op := coalesce(b ->> 'op', 'insert');
    if not (v_table = any (allowed)) then
      raise exception 'Records of type % cannot be saved this way', v_table;
    end if;
    v_n := 0;
    for r in select * from jsonb_array_elements(coalesce(b -> 'rows', '[]'::jsonb)) loop
      if v_op = 'update' then
        v_row := r - 'owner_id' - 'created_at' - 'updated_at';
        select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = v_table and v_row ? c.column_name and c.column_name <> 'id';
        if v_cols is null then continue; end if;
        execute format(
          'update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2 and owner_id = $3 returning id',
          v_table, v_cols, v_cols, v_table
        ) into v_id using v_row, (r ->> 'id')::uuid, v_owner;
        if v_id is null then
          raise exception 'A % record to update was not found', v_table;
        end if;
      else
        v_row := (r - 'created_at' - 'updated_at') || jsonb_build_object('owner_id', v_owner);
        if not (v_row ? 'id') then
          v_row := v_row || jsonb_build_object('id', gen_random_uuid());
        end if;
        select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = v_table and v_row ? c.column_name;
        execute format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
          v_table, v_cols, v_cols, v_table
        ) into v_id using v_row;
        if p_sample_batch is not null then
          insert into public.sample_records (owner_id, table_name, record_id, batch_id)
          values (v_owner, v_table, v_id, p_sample_batch)
          on conflict (owner_id, table_name, record_id) do nothing;
        end if;
      end if;
      v_n := v_n + 1;
    end loop;
    v_counts := v_counts || jsonb_build_object(v_table, coalesce((v_counts ->> v_table)::int, 0) + v_n);
  end loop;

  if p_sample_batch is not null then
    perform set_config('app.skip_change_log', '', true);
    insert into public.change_log (owner_id, table_name, record_id, action, field, new_value, actor)
    values (v_owner, 'sample_records', p_sample_batch, 'insert', 'sample_data_loaded', v_counts, 'owner');
  end if;
  perform set_config('app.actor', '', true);
  return v_counts;
end;
$_$;


--
-- Name: is_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner(row_owner uuid) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select row_owner is not null
     and row_owner = auth.uid()
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;


--
-- Name: log_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_old jsonb;
  v_new jsonb;
  k text;
  v_actor text := public.current_actor();
  secret_fields text[] := array['refresh_token_enc', 'access_token_enc', 'token_hash', 'token_encrypted', 'sync_cursor'];
begin
  if coalesce(current_setting('app.skip_change_log', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new) - secret_fields;
    insert into public.change_log (owner_id, table_name, record_id, action, new_value, actor)
    values (new.owner_id, tg_table_name, (v_new ->> 'id')::uuid, 'insert', v_new, v_actor);
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - secret_fields;
    v_new := to_jsonb(new) - secret_fields;
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'created_at') and (v_old -> k) is distinct from (v_new -> k) then
        insert into public.change_log (owner_id, table_name, record_id, action, field, old_value, new_value, actor)
        values (new.owner_id, tg_table_name, (v_new ->> 'id')::uuid, 'update', k, v_old -> k, v_new -> k, v_actor);
      end if;
    end loop;
    return new;
  else
    -- Skip when the owner account itself is being deleted.
    if public.owner_exists(old.owner_id) then
      v_old := to_jsonb(old) - secret_fields;
      insert into public.change_log (owner_id, table_name, record_id, action, old_value, actor)
      values (old.owner_id, tg_table_name, (v_old ->> 'id')::uuid, 'delete', v_old, v_actor);
    end if;
    return old;
  end if;
end;
$$;


--
-- Name: owner_exists(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_exists(p_owner uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
  select exists (select 1 from auth.users where id = p_owner)
$$;


--
-- Name: owner_local_date(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_local_date(p_owner uuid) RETURNS date
    LANGUAGE sql STABLE
    AS $$
  select (now() at time zone coalesce((select timezone from public.owner_profile where owner_id = p_owner), 'America/New_York'))::date
$$;


--
-- Name: pipeline_item_stage_defaults(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pipeline_item_stage_defaults() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_title text;
  v_due int;
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return new;
  end if;
  if new.stage_id is null then
    return new;
  end if;
  select st.title, st.due_in_days into v_title, v_due
  from public.stage_tasks st
  where st.pipeline_stage_id = new.stage_id and st.is_next_action_default
  order by st.sort_order, st.title
  limit 1;
  if v_title is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.next_action is null or btrim(new.next_action) = '' then
      new.next_action := v_title;
      new.next_action_due := coalesce(new.next_action_due, public.owner_local_date(new.owner_id) + v_due);
    end if;
  elsif new.next_action is not distinct from old.next_action
        and (old.next_action is null
             or exists (select 1 from public.stage_tasks st where st.pipeline_stage_id = old.stage_id and st.title = old.next_action)) then
    new.next_action := v_title;
    new.next_action_due := public.owner_local_date(new.owner_id) + v_due;
  end if;
  return new;
end;
$$;


--
-- Name: protect_finalized_report(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_finalized_report() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' and coalesce(current_setting('app.bulk_delete', true), '') <> 'on' then
      raise exception 'A finalized partner report cannot be deleted';
    end if;
    return old;
  end if;
  if old.status = 'finalized' then
    if new.snapshot is distinct from old.snapshot
       or new.summary is distinct from old.summary
       or new.status is distinct from old.status
       or new.contact_id is distinct from old.contact_id
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.finalized_at is distinct from old.finalized_at then
      raise exception 'A finalized partner report cannot be changed';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: refresh_contact_last_contact(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_contact_last_contact(p_contact uuid) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  update public.contacts c
     set last_contact_at = l.occurred_at,
         last_contact_kind = l.method
    from (select m.occurred_at, m.method
            from public.communications m
           where m.contact_id = p_contact and not m.awaiting_log and m.method in ('email', 'call', 'meeting', 'video', 'text')
           order by m.occurred_at desc limit 1) l
   where c.id = p_contact
     and (c.last_contact_at is distinct from l.occurred_at or c.last_contact_kind is distinct from l.method);
  update public.contacts c
     set last_contact_at = null, last_contact_kind = null
   where c.id = p_contact and (c.last_contact_at is not null or c.last_contact_kind is not null)
     and not exists (select 1 from public.communications m where m.contact_id = p_contact and not m.awaiting_log and m.method in ('email', 'call', 'meeting', 'video', 'text'));
$$;


--
-- Name: remove_sample_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.remove_sample_data() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_owner uuid := auth.uid();
  v_ids uuid[];
  v_counts jsonb := '{}'::jsonb;
  v_paths jsonb;
  v_n int;
  t text;
  delete_order text[] := array[
    'end_of_day', 'work_events', 'partner_reports', 'todos', 'deal_todos', 'projects', 'notes', 'record_links',
    'communications', 'consulting_details', 'deal_financials', 'pipeline_items', 'contacts', 'organizations'];
begin
  if v_owner is null or not public.is_owner(v_owner) or not exists (select 1 from public.owner_profile where owner_id = v_owner) then
    raise exception 'Only the signed-in owner can remove sample data';
  end if;
  perform set_config('app.skip_change_log', 'on', true);
  perform set_config('app.bulk_delete', 'on', true);

  select array_agg(record_id) into v_ids from sample_records where owner_id = v_owner;
  if v_ids is null then
    perform set_config('app.skip_change_log', '', true);
    perform set_config('app.bulk_delete', '', true);
    return jsonb_build_object('deleted', '{}'::jsonb, 'storage_paths', '[]'::jsonb, 'total', 0);
  end if;

  delete from record_links where owner_id = v_owner and (from_id = any (v_ids) or to_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('record_links', v_n);
  delete from notes where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('notes', v_n);
  select coalesce(jsonb_agg(storage_path), '[]'::jsonb) into v_paths from documents where owner_id = v_owner and record_id = any (v_ids);
  delete from documents where owner_id = v_owner and record_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);
  delete from communications where owner_id = v_owner and (contact_id = any (v_ids) or organization_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('communications', v_n);
  delete from partner_reports where owner_id = v_owner and contact_id = any (v_ids);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('partner_reports', v_n);
  delete from stage_history where owner_id = v_owner and item_id = any (v_ids);
  delete from deal_todos where owner_id = v_owner and (record_id = any (v_ids) or deal_id = any (v_ids));
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('deal_todos', v_n);

  foreach t in array delete_order loop
    execute format('delete from public.%I where owner_id = $1 and id in (select record_id from public.sample_records where owner_id = $1 and table_name = %L)', t, t)
      using v_owner;
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, coalesce((v_counts ->> t)::int, 0) + v_n);
  end loop;

  delete from sample_records where owner_id = v_owner;

  perform set_config('app.skip_change_log', '', true);
  perform set_config('app.bulk_delete', '', true);
  insert into change_log (owner_id, table_name, record_id, action, field, new_value, actor)
  values (v_owner, 'sample_records', null, 'delete', 'sample_data_removed', v_counts, 'owner');
  return jsonb_build_object('deleted', v_counts, 'storage_paths', v_paths,
    'total', (select coalesce(sum(value::int), 0) from jsonb_each_text(v_counts)));
end;
$_$;


--
-- Name: seed_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_owner(p_owner uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_pipe uuid;
  v_stage uuid;
begin
  insert into public.owner_profile (owner_id) values (p_owner) on conflict do nothing;
  if exists (select 1 from public.pipelines where owner_id = p_owner) then
    return;
  end if;
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Acquisitions', 'acquisition', 1, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Interested', 1, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Sign the NDA and ask the broker for a call', 1, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'NDA signed', 2, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask the broker for the CIM', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'CIM review', 3, 'open', 10, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write the key finding, research the market if interested, request 3 years of financials and unit economics', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Broker call', 4, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for the seller call', 2, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Seller call', 5, 'open', 10, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for tax returns and start the model', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Model', 6, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Book the partner meeting', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Partner presentation', 7, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Submit the IOI or LOI', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'IOI or LOI', 8, 'open', 14, array['revenue','ebitda','asking_price']::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Wait for the broker, follow up in 7 days', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Diligence', 9, 'open', 60, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Data room, quality of earnings, lawyer review', 14, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Closed', 10, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Upload the signed closing documents', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Passed', 11, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason for passing', 1, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lost', 12, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Job search', 'job', 2, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Contact', 1, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for an introduction or a first conversation', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Conversation', 2, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Send a thank-you note and ask about the next step', 2, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Interview', 3, 'open', 21, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Prepare for the interview', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Offer', 4, 'open', 7, array['salary']::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Compare the offer with the acquisition path and decide', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Accepted', 5, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Confirm the start date and paperwork', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Declined', 6, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason for declining', 1, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Not chosen', 7, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Consulting', 'consulting', 6, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lead', 1, 'open', 7, '{}'::text[], 10, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Find out what they need and who decides', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Proposal', 2, 'open', 14, array['rate_type','rate']::text[], 50, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Send the scope and fee', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Engagement', 3, 'open', 7, array['rate_type','rate','start_date']::text[], 100, true) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Do the work and send the invoice on schedule', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Paid', 4, 'open', null, '{}'::text[], 100, true) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for a referral or the next project', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Done', 5, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for a referral or a testimonial', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lost', 6, 'lost', null, '{}'::text[], 0, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason', 1, 1, false, false);
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'waiting_threshold_days', 'Days waiting on someone before it is marked amber', 'Acquisition', 'number', 5, null, 'On Work on now and Deals, a deal waiting on someone this many days shows an amber count; at double it shows red. Follow up resets the count.', 80) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'outreach_weekly_target', 'Network outreach per week', 'Outreach', 'number', 10, null, 'The weekly counter on Outreach and Home: emails sent and calls logged to people on Outreach, Monday to Friday, out of this number.', 90) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'rosara_weekly_focus', 'Rosara weekly focus', 'Rosara', 'text', null, null, 'The one thing Rosara gets this week. Edited at the top of the Rosara page and shown on Home.', 91) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'ai_monthly_cap_usd', 'AI monthly spending cap', 'AI', 'usd', 25, null, 'AI requests stop once this amount is spent in the month. The AI_MONTHLY_CAP_USD setting on the server is the upper limit.', 260) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'anthropic_key_expiry_date', 'Anthropic API key expiry date', 'AI', 'date', null, null, 'Date the Anthropic API key stops working (shown in the Anthropic Console). The app adds a to-do 14 days before.', 265)
  on conflict (owner_id, key) do nothing;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: track_stage_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_stage_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_outcome text;
begin
  if tg_op = 'INSERT' then
    insert into public.stage_history (owner_id, item_id, stage_id, entered_at)
    values (new.owner_id, new.id, new.stage_id, now());
    return new;
  end if;
  if new.stage_id is distinct from old.stage_id then
    update public.stage_history set exited_at = now()
      where item_id = new.id and exited_at is null;
    insert into public.stage_history (owner_id, item_id, stage_id, entered_at)
    values (new.owner_id, new.id, new.stage_id, now());
  end if;
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ai_order_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_order_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    for_date date NOT NULL,
    ordered_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    reasons jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    purpose text NOT NULL,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: change_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.change_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    table_name text NOT NULL,
    record_id uuid,
    action text NOT NULL,
    field text,
    old_value jsonb,
    new_value jsonb,
    actor text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT change_log_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))
);


--
-- Name: communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.communications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    method text DEFAULT 'email'::text NOT NULL,
    direction text DEFAULT 'outgoing'::text NOT NULL,
    contact_id uuid,
    organization_id uuid,
    subject text,
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_outreach boolean DEFAULT false NOT NULL,
    outcome text,
    purpose text DEFAULT 'general'::text NOT NULL,
    pipeline_item_id uuid,
    gmail_message_id text,
    gmail_thread_id text,
    call_minutes integer,
    call_outcome text,
    awaiting_log boolean DEFAULT false NOT NULL,
    partner_report_id uuid,
    CONSTRAINT communications_call_minutes_check CHECK (((call_minutes IS NULL) OR ((call_minutes >= 0) AND (call_minutes <= 1440)))),
    CONSTRAINT communications_direction_check CHECK ((direction = ANY (ARRAY['outgoing'::text, 'incoming'::text, 'both'::text]))),
    CONSTRAINT communications_method_check CHECK ((method = ANY (ARRAY['email'::text, 'call'::text, 'letter'::text, 'meeting'::text, 'text'::text, 'video'::text, 'other'::text]))),
    CONSTRAINT communications_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['replied'::text, 'meeting_booked'::text, 'referral'::text, 'no_response'::text])))),
    CONSTRAINT communications_purpose_check CHECK ((purpose = ANY (ARRAY['general'::text, 'deal_sourcing'::text, 'cim_request'::text, 'source_contact'::text, 'consulting'::text])))
);


--
-- Name: consulting_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consulting_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    item_id uuid NOT NULL,
    rate_type text,
    rate numeric(14,2),
    expected_hours_per_month numeric(8,2),
    project_months numeric(6,2),
    start_date date,
    end_date date,
    probability_pct integer,
    scope_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consulting_details_expected_hours_per_month_check CHECK (((expected_hours_per_month IS NULL) OR (expected_hours_per_month >= (0)::numeric))),
    CONSTRAINT consulting_details_probability_pct_check CHECK (((probability_pct IS NULL) OR ((probability_pct >= 0) AND (probability_pct <= 100)))),
    CONSTRAINT consulting_details_project_months_check CHECK (((project_months IS NULL) OR (project_months > (0)::numeric))),
    CONSTRAINT consulting_details_rate_check CHECK (((rate IS NULL) OR (rate >= (0)::numeric))),
    CONSTRAINT consulting_details_rate_type_check CHECK (((rate_type IS NULL) OR (rate_type = ANY (ARRAY['hourly'::text, 'project'::text, 'monthly_retainer'::text]))))
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    is_pseudonym boolean DEFAULT false NOT NULL,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    organization_id uuid,
    title text,
    email text,
    phone text,
    mailing_address text,
    follow_up_date date,
    follow_up_note text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    relationship_group text,
    outreach_every_days integer,
    is_deal_source boolean DEFAULT false NOT NULL,
    is_consulting_lead boolean DEFAULT false NOT NULL,
    outreach_role text,
    purposes text[] DEFAULT '{}'::text[] NOT NULL,
    linkedin_url text,
    last_contact_at timestamp with time zone,
    last_contact_kind text,
    archived_at timestamp with time zone,
    report_days smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    report_sections text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT contacts_outreach_every_days_check CHECK (((outreach_every_days IS NULL) OR ((outreach_every_days >= 1) AND (outreach_every_days <= 3650)))),
    CONSTRAINT contacts_outreach_role_check CHECK (((outreach_role IS NULL) OR (outreach_role = ANY (ARRAY['broker'::text, 'lender'::text, 'personal_network'::text, 'service_provider'::text, 'rosara_customer'::text, 'recruiter'::text, 'cofounder_candidate'::text, 'investor'::text, 'accountability_partner'::text, 'consulting_client'::text, 'other'::text])))),
    CONSTRAINT contacts_purposes_check CHECK ((purposes <@ ARRAY['off_market_deals'::text, 'job_search'::text, 'consulting'::text, 'rosara'::text])),
    CONSTRAINT contacts_relationship_group_check CHECK (((relationship_group IS NULL) OR (relationship_group = ANY (ARRAY['close'::text, 'friend'::text, 'warm'::text, 'professional'::text, 'other'::text]))))
);


--
-- Name: deal_financials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_financials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    item_id uuid NOT NULL,
    asking_price numeric(14,2),
    revenue numeric(14,2),
    ebitda numeric(14,2),
    sde numeric(14,2),
    financing_structure text,
    salary numeric(14,2),
    equity_pct numeric(7,3),
    vesting_terms text,
    earn_out_terms text,
    profit_share_terms text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deal_todos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_todos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    deal_id uuid,
    text text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    done_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    record_type text DEFAULT 'pipeline_items'::text NOT NULL,
    record_id uuid,
    CONSTRAINT deal_todos_record_type_check CHECK ((record_type = ANY (ARRAY['pipeline_items'::text, 'contacts'::text, 'projects'::text, 'organizations'::text])))
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    record_type text,
    record_id uuid,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text,
    size_bytes bigint,
    kind text DEFAULT 'other'::text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT documents_kind_check CHECK ((kind = ANY (ARRAY['signed_agreement'::text, 'statement'::text, 'proof'::text, 'cim'::text, 'nda'::text, 'loi'::text, 'report'::text, 'other'::text])))
);


--
-- Name: end_of_day; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.end_of_day (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    day date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    reasons jsonb DEFAULT '{}'::jsonb NOT NULL,
    tomorrow_line text,
    skip_reason text,
    sent_at timestamp with time zone,
    skipped_at timestamp with time zone,
    report_id uuid,
    report_subject text,
    report_html text,
    report_edited boolean DEFAULT false NOT NULL,
    judged jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    report_edits jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT end_of_day_status_check CHECK ((status = ANY (ARRAY['open'::text, 'sent'::text, 'skipped'::text])))
);


--
-- Name: google_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.google_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    google_email text,
    refresh_token_enc text,
    scopes text,
    status text DEFAULT 'disconnected'::text NOT NULL,
    connected_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    replies_checked_at timestamp with time zone,
    CONSTRAINT google_connections_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'error'::text, 'disconnected'::text])))
);


--
-- Name: inputs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inputs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    key text NOT NULL,
    label text NOT NULL,
    category text DEFAULT 'General'::text NOT NULL,
    unit text DEFAULT 'number'::text NOT NULL,
    value_number numeric,
    value_text text,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inputs_unit_check CHECK ((unit = ANY (ARRAY['usd'::text, 'months'::text, 'percent'::text, 'years'::text, 'number'::text, 'date'::text, 'boolean'::text, 'text'::text])))
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    record_type text NOT NULL,
    record_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kind text DEFAULT 'note'::text NOT NULL,
    source_url text,
    CONSTRAINT notes_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'finding'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    website text,
    phone text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    region text,
    deal_size text,
    next_action text,
    next_action_due date,
    archived_at timestamp with time zone,
    CONSTRAINT organizations_kind_check CHECK ((kind = ANY (ARRAY['broker'::text, 'lender'::text, 'employer'::text, 'investor'::text, 'consulting_client'::text, 'business'::text, 'service_provider'::text, 'nonprofit'::text, 'other'::text])))
);


--
-- Name: owner_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_profile (
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    display_name text,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    morning_hour integer DEFAULT 7 NOT NULL,
    evening_hour integer DEFAULT 20 NOT NULL,
    weekly_review_weekday integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    commitment_rule_applied_at timestamp with time zone,
    email_signature_html text,
    email_signature_text text,
    email_signature_enabled boolean,
    email_signature_updated_at timestamp with time zone,
    CONSTRAINT owner_profile_evening_hour_check CHECK (((evening_hour >= 0) AND (evening_hour <= 23))),
    CONSTRAINT owner_profile_morning_hour_check CHECK (((morning_hour >= 0) AND (morning_hour <= 23))),
    CONSTRAINT owner_profile_weekly_review_weekday_check CHECK (((weekly_review_weekday >= 0) AND (weekly_review_weekday <= 6)))
);


--
-- Name: partner_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary text,
    summary_source text DEFAULT 'template'::text NOT NULL,
    finalized_at timestamp with time zone,
    delivered_via text[] DEFAULT '{}'::text[] NOT NULL,
    gmail_draft_id text,
    reviewed_at timestamp with time zone,
    partner_comment text,
    comment_at timestamp with time zone,
    call_requested_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    gmail_message_id text,
    report_kind text DEFAULT 'regular'::text NOT NULL,
    skipped_at timestamp with time zone,
    contact_id uuid,
    gmail_thread_id text,
    CONSTRAINT partner_reports_report_kind_check CHECK ((report_kind = ANY (ARRAY['regular'::text, 'daily'::text, 'end_of_day'::text]))),
    CONSTRAINT partner_reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'finalized'::text]))),
    CONSTRAINT partner_reports_summary_source_check CHECK ((summary_source = ANY (ARRAY['ai'::text, 'template'::text, 'owner'::text])))
);


--
-- Name: pipeline_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    pipeline_id uuid NOT NULL,
    stage_id uuid,
    name text NOT NULL,
    organization_id uuid,
    primary_contact_id uuid,
    next_action text,
    next_action_due date,
    status text DEFAULT 'open'::text NOT NULL,
    source text,
    stage_entered_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deal_source_type text,
    source_contact_id uuid,
    source_notes text,
    introduced_by_contact_id uuid,
    what_it_does text,
    location text,
    industry text,
    listing_url text,
    broker_name text,
    why_selling text,
    key_finding text,
    open_questions text,
    waiting_on text,
    waiting_since date,
    pass_reason text,
    screened boolean DEFAULT true NOT NULL,
    buy_box_note text,
    next_action_minutes integer,
    company_name text,
    open_questions_json jsonb,
    role_title text,
    contact_name text,
    fee numeric(14,2),
    pay_range text,
    listing_text text,
    year_established integer,
    employees text,
    strengths jsonb,
    risks jsonb,
    growth_paths jsonb,
    financing text DEFAULT 'equity'::text NOT NULL,
    CONSTRAINT pipeline_items_deal_source_type_check CHECK (((deal_source_type IS NULL) OR (deal_source_type = ANY (ARRAY['proprietary'::text, 'brokered'::text])))),
    CONSTRAINT pipeline_items_financing_check CHECK ((financing = ANY (ARRAY['equity'::text, 'equity_plus_debt'::text]))),
    CONSTRAINT pipeline_items_growth_paths_check CHECK (((growth_paths IS NULL) OR ((jsonb_typeof(growth_paths) = 'array'::text) AND (jsonb_array_length(growth_paths) <= 3)))),
    CONSTRAINT pipeline_items_next_action_minutes_check CHECK (((next_action_minutes IS NULL) OR ((next_action_minutes >= 0) AND (next_action_minutes <= 1440)))),
    CONSTRAINT pipeline_items_pass_reason_check CHECK (((pass_reason IS NULL) OR (pass_reason = ANY (ARRAY['franchise'::text, 'too_small'::text, 'too_big'::text, 'location'::text, 'retail_dtc'::text, 'no_growth_path'::text, 'other'::text])))),
    CONSTRAINT pipeline_items_risks_check CHECK (((risks IS NULL) OR ((jsonb_typeof(risks) = 'array'::text) AND (jsonb_array_length(risks) <= 3)))),
    CONSTRAINT pipeline_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text]))),
    CONSTRAINT pipeline_items_strengths_check CHECK (((strengths IS NULL) OR ((jsonb_typeof(strengths) = 'array'::text) AND (jsonb_array_length(strengths) <= 3)))),
    CONSTRAINT pipeline_items_year_established_check CHECK (((year_established IS NULL) OR ((year_established >= 1700) AND (year_established <= 2200))))
);


--
-- Name: pipeline_stages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    pipeline_id uuid NOT NULL,
    name text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    outcome text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    max_days_in_stage integer,
    required_fields text[] DEFAULT '{}'::text[] NOT NULL,
    default_probability_pct integer,
    counts_as_signed boolean DEFAULT false NOT NULL,
    CONSTRAINT pipeline_stages_max_days_check CHECK (((max_days_in_stage IS NULL) OR ((max_days_in_stage >= 1) AND (max_days_in_stage <= 365)))),
    CONSTRAINT pipeline_stages_outcome_check CHECK ((outcome = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text]))),
    CONSTRAINT pipeline_stages_probability_check CHECK (((default_probability_pct IS NULL) OR ((default_probability_pct >= 0) AND (default_probability_pct <= 100))))
);


--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'other'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipelines_kind_check CHECK ((kind = ANY (ARRAY['acquisition'::text, 'job'::text, 'investor'::text, 'cofounder'::text, 'other'::text, 'consulting'::text])))
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    goal text,
    milestone text,
    status text DEFAULT 'open'::text NOT NULL,
    closed_at timestamp with time zone,
    next_action text,
    next_action_due date,
    next_action_minutes integer,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT projects_next_action_minutes_check CHECK (((next_action_minutes IS NULL) OR ((next_action_minutes >= 0) AND (next_action_minutes <= 1440)))),
    CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])))
);


--
-- Name: record_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.record_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    from_type text NOT NULL,
    from_id uuid NOT NULL,
    to_type text NOT NULL,
    to_id uuid NOT NULL,
    relation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sample_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sample_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: stage_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    item_id uuid NOT NULL,
    stage_id uuid,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    exited_at timestamp with time zone
);


--
-- Name: stage_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stage_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    pipeline_stage_id uuid NOT NULL,
    title text NOT NULL,
    due_in_days integer DEFAULT 2 NOT NULL,
    sort_order integer DEFAULT 1 NOT NULL,
    is_next_action_default boolean DEFAULT false NOT NULL,
    is_commitment boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT stage_tasks_due_in_days_check CHECK (((due_in_days >= 0) AND (due_in_days <= 365)))
);


--
-- Name: target_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    target_id uuid NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    count integer DEFAULT 1 NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT target_entries_count_check CHECK (((count >= 1) AND (count <= 1000)))
);


--
-- Name: target_misses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.target_misses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    target_id uuid NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    actual_count integer DEFAULT 0 NOT NULL,
    required_count integer DEFAULT 0 NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    name text NOT NULL,
    period text DEFAULT 'day'::text NOT NULL,
    minimum_count integer DEFAULT 1 NOT NULL,
    active_weekdays integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    count_source text DEFAULT 'manual'::text NOT NULL,
    pipeline_id uuid,
    is_commitment boolean DEFAULT true NOT NULL,
    show_to_partners boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stage_id uuid,
    counts_key text,
    archived_at timestamp with time zone,
    CONSTRAINT targets_active_weekdays_check CHECK ((active_weekdays <@ '{0,1,2,3,4,5,6}'::integer[])),
    CONSTRAINT targets_count_source_check CHECK ((count_source = ANY (ARRAY['communications_outreach'::text, 'pipeline_items_created'::text, 'manual'::text, 'deals_sourced'::text, 'deals_advanced'::text, 'cims_reviewed'::text, 'deal_calls'::text]))),
    CONSTRAINT targets_counts_key_check CHECK (((counts_key IS NULL) OR (counts_key = ANY (ARRAY['listings_screened'::text, 'passes'::text, 'brokers_contacted'::text, 'emails_sent'::text, 'calls_logged'::text, 'outreach_contacts'::text, 'follow_ups_on_time'::text, 'deals_moved'::text, 'next_actions_done'::text, 'rosara_focus_done'::text])))),
    CONSTRAINT targets_minimum_count_check CHECK (((minimum_count >= 1) AND (minimum_count <= 1000))),
    CONSTRAINT targets_period_check CHECK ((period = ANY (ARRAY['day'::text, 'week'::text])))
);


--
-- Name: todos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.todos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    text text NOT NULL,
    due_on date,
    done_at timestamp with time zone,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: work_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid DEFAULT auth.uid() NOT NULL,
    kind text NOT NULL,
    record_type text,
    record_id uuid,
    label text,
    happened_on date DEFAULT CURRENT_DATE NOT NULL,
    happened_at timestamp with time zone DEFAULT now() NOT NULL,
    on_time boolean,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT work_events_kind_check CHECK ((kind = ANY (ARRAY['next_action_done'::text, 'follow_up_done'::text, 'focus_done'::text])))
);


--
-- Name: ai_order_cache ai_order_cache_owner_id_for_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_order_cache
    ADD CONSTRAINT ai_order_cache_owner_id_for_date_key UNIQUE (owner_id, for_date);


--
-- Name: ai_order_cache ai_order_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_order_cache
    ADD CONSTRAINT ai_order_cache_pkey PRIMARY KEY (id);


--
-- Name: ai_usage ai_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_pkey PRIMARY KEY (id);


--
-- Name: change_log change_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log
    ADD CONSTRAINT change_log_pkey PRIMARY KEY (id);


--
-- Name: communications communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_pkey PRIMARY KEY (id);


--
-- Name: consulting_details consulting_details_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consulting_details
    ADD CONSTRAINT consulting_details_item_id_key UNIQUE (item_id);


--
-- Name: consulting_details consulting_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consulting_details
    ADD CONSTRAINT consulting_details_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: deal_financials deal_financials_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_financials
    ADD CONSTRAINT deal_financials_item_id_key UNIQUE (item_id);


--
-- Name: deal_financials deal_financials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_financials
    ADD CONSTRAINT deal_financials_pkey PRIMARY KEY (id);


--
-- Name: deal_todos deal_todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_todos
    ADD CONSTRAINT deal_todos_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: end_of_day end_of_day_owner_id_day_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.end_of_day
    ADD CONSTRAINT end_of_day_owner_id_day_key UNIQUE (owner_id, day);


--
-- Name: end_of_day end_of_day_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.end_of_day
    ADD CONSTRAINT end_of_day_pkey PRIMARY KEY (id);


--
-- Name: google_connections google_connections_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_connections
    ADD CONSTRAINT google_connections_owner_id_key UNIQUE (owner_id);


--
-- Name: google_connections google_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_connections
    ADD CONSTRAINT google_connections_pkey PRIMARY KEY (id);


--
-- Name: inputs inputs_owner_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inputs
    ADD CONSTRAINT inputs_owner_id_key_key UNIQUE (owner_id, key);


--
-- Name: inputs inputs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inputs
    ADD CONSTRAINT inputs_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: owner_profile owner_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_profile
    ADD CONSTRAINT owner_profile_pkey PRIMARY KEY (owner_id);


--
-- Name: partner_reports partner_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_reports
    ADD CONSTRAINT partner_reports_pkey PRIMARY KEY (id);


--
-- Name: pipeline_items pipeline_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_pkey PRIMARY KEY (id);


--
-- Name: pipeline_stages pipeline_stages_pipeline_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_name_key UNIQUE (pipeline_id, name);


--
-- Name: pipeline_stages pipeline_stages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pkey PRIMARY KEY (id);


--
-- Name: pipelines pipelines_owner_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_owner_id_name_key UNIQUE (owner_id, name);


--
-- Name: pipelines pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: record_links record_links_owner_id_from_type_from_id_to_type_to_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_owner_id_from_type_from_id_to_type_to_id_key UNIQUE (owner_id, from_type, from_id, to_type, to_id);


--
-- Name: record_links record_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_pkey PRIMARY KEY (id);


--
-- Name: sample_records sample_records_owner_id_table_name_record_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_records
    ADD CONSTRAINT sample_records_owner_id_table_name_record_id_key UNIQUE (owner_id, table_name, record_id);


--
-- Name: sample_records sample_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_records
    ADD CONSTRAINT sample_records_pkey PRIMARY KEY (id);


--
-- Name: stage_history stage_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_history
    ADD CONSTRAINT stage_history_pkey PRIMARY KEY (id);


--
-- Name: stage_tasks stage_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_tasks
    ADD CONSTRAINT stage_tasks_pkey PRIMARY KEY (id);


--
-- Name: target_entries target_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_entries
    ADD CONSTRAINT target_entries_pkey PRIMARY KEY (id);


--
-- Name: target_misses target_misses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_misses
    ADD CONSTRAINT target_misses_pkey PRIMARY KEY (id);


--
-- Name: target_misses target_misses_target_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_misses
    ADD CONSTRAINT target_misses_target_id_period_start_key UNIQUE (target_id, period_start);


--
-- Name: targets targets_owner_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_owner_id_name_key UNIQUE (owner_id, name);


--
-- Name: targets targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_pkey PRIMARY KEY (id);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: work_events work_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_events
    ADD CONSTRAINT work_events_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_owner_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_owner_id_created_at_idx ON public.ai_usage USING btree (owner_id, created_at DESC);


--
-- Name: change_log_owner_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_log_owner_id_created_at_idx ON public.change_log USING btree (owner_id, created_at DESC);


--
-- Name: change_log_table_name_record_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX change_log_table_name_record_id_created_at_idx ON public.change_log USING btree (table_name, record_id, created_at DESC);


--
-- Name: communications_awaiting_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_awaiting_idx ON public.communications USING btree (owner_id, contact_id) WHERE awaiting_log;


--
-- Name: communications_contact_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_contact_id_occurred_at_idx ON public.communications USING btree (contact_id, occurred_at DESC);


--
-- Name: communications_gmail_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_gmail_message_idx ON public.communications USING btree (gmail_message_id) WHERE (gmail_message_id IS NOT NULL);


--
-- Name: communications_incoming_gmail_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX communications_incoming_gmail_key ON public.communications USING btree (owner_id, gmail_message_id) WHERE ((direction = 'incoming'::text) AND (gmail_message_id IS NOT NULL));


--
-- Name: communications_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_item_idx ON public.communications USING btree (pipeline_item_id, occurred_at);


--
-- Name: communications_outreach_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_outreach_idx ON public.communications USING btree (owner_id, is_outreach, occurred_at DESC);


--
-- Name: communications_partner_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX communications_partner_report_idx ON public.communications USING btree (partner_report_id) WHERE (partner_report_id IS NOT NULL);


--
-- Name: contacts_follow_up_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_follow_up_date_idx ON public.contacts USING btree (follow_up_date);


--
-- Name: contacts_outreach_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_outreach_idx ON public.contacts USING btree (owner_id, follow_up_date) WHERE (archived_at IS NULL);


--
-- Name: deal_todos_deal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deal_todos_deal_idx ON public.deal_todos USING btree (deal_id, "position");


--
-- Name: deal_todos_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deal_todos_record_idx ON public.deal_todos USING btree (record_type, record_id, "position");


--
-- Name: documents_record_type_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_record_type_record_id_idx ON public.documents USING btree (record_type, record_id);


--
-- Name: notes_record_type_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notes_record_type_record_id_idx ON public.notes USING btree (record_type, record_id);


--
-- Name: partner_reports_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_reports_contact_idx ON public.partner_reports USING btree (contact_id, sent_at DESC);


--
-- Name: pipeline_items_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_items_created_idx ON public.pipeline_items USING btree (owner_id, created_at);


--
-- Name: pipeline_items_introduced_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_items_introduced_by_idx ON public.pipeline_items USING btree (introduced_by_contact_id) WHERE (introduced_by_contact_id IS NOT NULL);


--
-- Name: pipeline_items_next_action_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_items_next_action_due_idx ON public.pipeline_items USING btree (next_action_due);


--
-- Name: pipeline_items_pipeline_id_stage_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_items_pipeline_id_stage_id_idx ON public.pipeline_items USING btree (pipeline_id, stage_id);


--
-- Name: pipeline_items_source_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_items_source_contact_idx ON public.pipeline_items USING btree (source_contact_id) WHERE (source_contact_id IS NOT NULL);


--
-- Name: pipeline_items_unscreened_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pipeline_items_unscreened_idx ON public.pipeline_items USING btree (owner_id) WHERE (screened = false);


--
-- Name: projects_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX projects_owner_idx ON public.projects USING btree (owner_id, status, next_action_due);


--
-- Name: record_links_from_type_from_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX record_links_from_type_from_id_idx ON public.record_links USING btree (from_type, from_id);


--
-- Name: record_links_to_type_to_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX record_links_to_type_to_id_idx ON public.record_links USING btree (to_type, to_id);


--
-- Name: sample_records_table_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sample_records_table_idx ON public.sample_records USING btree (owner_id, table_name);


--
-- Name: stage_history_item_id_entered_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stage_history_item_id_entered_at_idx ON public.stage_history USING btree (item_id, entered_at);


--
-- Name: stage_tasks_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stage_tasks_stage_idx ON public.stage_tasks USING btree (pipeline_stage_id, sort_order);


--
-- Name: target_entries_target_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX target_entries_target_date_idx ON public.target_entries USING btree (target_id, entry_date);


--
-- Name: todos_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX todos_owner_idx ON public.todos USING btree (owner_id, due_on, "position");


--
-- Name: work_events_owner_day_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX work_events_owner_day_idx ON public.work_events USING btree (owner_id, happened_on);


--
-- Name: communications communications_default_purpose; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER communications_default_purpose BEFORE INSERT OR UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION public.communication_default_purpose();


--
-- Name: communications communications_touch_contact; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER communications_touch_contact AFTER INSERT OR DELETE OR UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION public.communications_touch_contact();


--
-- Name: contacts contacts_delete_tasks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER contacts_delete_tasks AFTER DELETE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.delete_record_tasks();


--
-- Name: deal_todos deal_todos_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER deal_todos_before BEFORE INSERT OR UPDATE ON public.deal_todos FOR EACH ROW EXECUTE FUNCTION public.deal_todos_before();


--
-- Name: communications log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: consulting_details log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.consulting_details FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: contacts log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: deal_financials log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.deal_financials FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: deal_todos log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.deal_todos FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: documents log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: end_of_day log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.end_of_day FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: google_connections log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.google_connections FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: inputs log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.inputs FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: notes log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: organizations log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: owner_profile log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.owner_profile FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: partner_reports log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.partner_reports FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: pipeline_items log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.pipeline_items FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: pipeline_stages log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: pipelines log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: projects log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: record_links log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.record_links FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: stage_tasks log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.stage_tasks FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: target_entries log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.target_entries FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: target_misses log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.target_misses FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: targets log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.targets FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: todos log_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER log_change AFTER INSERT OR DELETE OR UPDATE ON public.todos FOR EACH ROW EXECUTE FUNCTION public.log_change();


--
-- Name: partner_reports partner_reports_protect; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER partner_reports_protect BEFORE DELETE OR UPDATE ON public.partner_reports FOR EACH ROW EXECUTE FUNCTION public.protect_finalized_report();


--
-- Name: pipeline_items pipeline_items_before; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pipeline_items_before BEFORE INSERT OR UPDATE ON public.pipeline_items FOR EACH ROW EXECUTE FUNCTION public.before_pipeline_item();


--
-- Name: pipeline_items pipeline_items_stage_defaults; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pipeline_items_stage_defaults BEFORE INSERT OR UPDATE ON public.pipeline_items FOR EACH ROW EXECUTE FUNCTION public.pipeline_item_stage_defaults();


--
-- Name: pipeline_items pipeline_items_stage_history; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pipeline_items_stage_history AFTER INSERT OR UPDATE ON public.pipeline_items FOR EACH ROW EXECUTE FUNCTION public.track_stage_history();


--
-- Name: projects projects_delete_tasks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER projects_delete_tasks AFTER DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.delete_record_tasks();


--
-- Name: communications set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.communications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: consulting_details set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.consulting_details FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: contacts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: deal_financials set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.deal_financials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: documents set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: end_of_day set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.end_of_day FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: google_connections set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.google_connections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: inputs set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.inputs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: notes set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: organizations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: owner_profile set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.owner_profile FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: partner_reports set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.partner_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pipeline_items set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pipeline_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pipeline_stages set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: pipelines set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: record_links set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.record_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: stage_tasks set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.stage_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: target_entries set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.target_entries FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: target_misses set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.target_misses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: targets set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.targets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ai_order_cache ai_order_cache_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_order_cache
    ADD CONSTRAINT ai_order_cache_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_usage ai_usage_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage
    ADD CONSTRAINT ai_usage_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: change_log change_log_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.change_log
    ADD CONSTRAINT change_log_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: communications communications_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: communications communications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: communications communications_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: communications communications_partner_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_partner_report_id_fkey FOREIGN KEY (partner_report_id) REFERENCES public.partner_reports(id) ON DELETE SET NULL;


--
-- Name: communications communications_pipeline_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.communications
    ADD CONSTRAINT communications_pipeline_item_id_fkey FOREIGN KEY (pipeline_item_id) REFERENCES public.pipeline_items(id) ON DELETE SET NULL;


--
-- Name: consulting_details consulting_details_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consulting_details
    ADD CONSTRAINT consulting_details_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.pipeline_items(id) ON DELETE CASCADE;


--
-- Name: consulting_details consulting_details_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consulting_details
    ADD CONSTRAINT consulting_details_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: deal_financials deal_financials_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_financials
    ADD CONSTRAINT deal_financials_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.pipeline_items(id) ON DELETE CASCADE;


--
-- Name: deal_financials deal_financials_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_financials
    ADD CONSTRAINT deal_financials_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: deal_todos deal_todos_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_todos
    ADD CONSTRAINT deal_todos_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.pipeline_items(id) ON DELETE CASCADE;


--
-- Name: deal_todos deal_todos_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_todos
    ADD CONSTRAINT deal_todos_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: documents documents_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: end_of_day end_of_day_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.end_of_day
    ADD CONSTRAINT end_of_day_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: end_of_day end_of_day_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.end_of_day
    ADD CONSTRAINT end_of_day_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.partner_reports(id) ON DELETE SET NULL;


--
-- Name: google_connections google_connections_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.google_connections
    ADD CONSTRAINT google_connections_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: inputs inputs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inputs
    ADD CONSTRAINT inputs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notes notes_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: owner_profile owner_profile_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_profile
    ADD CONSTRAINT owner_profile_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: partner_reports partner_reports_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_reports
    ADD CONSTRAINT partner_reports_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: partner_reports partner_reports_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_reports
    ADD CONSTRAINT partner_reports_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pipeline_items pipeline_items_introduced_by_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_introduced_by_contact_id_fkey FOREIGN KEY (introduced_by_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: pipeline_items pipeline_items_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;


--
-- Name: pipeline_items pipeline_items_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pipeline_items pipeline_items_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: pipeline_items pipeline_items_primary_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_primary_contact_id_fkey FOREIGN KEY (primary_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: pipeline_items pipeline_items_source_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_source_contact_id_fkey FOREIGN KEY (source_contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: pipeline_items pipeline_items_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_items
    ADD CONSTRAINT pipeline_items_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: pipeline_stages pipeline_stages_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: pipeline_stages pipeline_stages_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: pipelines pipelines_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: record_links record_links_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.record_links
    ADD CONSTRAINT record_links_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sample_records sample_records_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sample_records
    ADD CONSTRAINT sample_records_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: stage_history stage_history_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_history
    ADD CONSTRAINT stage_history_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.pipeline_items(id) ON DELETE CASCADE;


--
-- Name: stage_history stage_history_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_history
    ADD CONSTRAINT stage_history_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: stage_history stage_history_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_history
    ADD CONSTRAINT stage_history_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: stage_tasks stage_tasks_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_tasks
    ADD CONSTRAINT stage_tasks_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: stage_tasks stage_tasks_pipeline_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stage_tasks
    ADD CONSTRAINT stage_tasks_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES public.pipeline_stages(id) ON DELETE CASCADE;


--
-- Name: target_entries target_entries_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_entries
    ADD CONSTRAINT target_entries_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: target_entries target_entries_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_entries
    ADD CONSTRAINT target_entries_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.targets(id) ON DELETE CASCADE;


--
-- Name: target_misses target_misses_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_misses
    ADD CONSTRAINT target_misses_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: target_misses target_misses_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.target_misses
    ADD CONSTRAINT target_misses_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.targets(id) ON DELETE CASCADE;


--
-- Name: targets targets_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: targets targets_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE SET NULL;


--
-- Name: targets targets_stage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.targets
    ADD CONSTRAINT targets_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;


--
-- Name: todos todos_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: work_events work_events_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_events
    ADD CONSTRAINT work_events_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ai_order_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_order_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: change_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

--
-- Name: communications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

--
-- Name: consulting_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consulting_details ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_financials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_financials ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_todos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_todos ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: end_of_day; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.end_of_day ENABLE ROW LEVEL SECURITY;

--
-- Name: google_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: inputs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inputs ENABLE ROW LEVEL SECURITY;

--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_order_cache owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.ai_order_cache TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: ai_usage owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.ai_usage TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: change_log owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.change_log TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: communications owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.communications TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: consulting_details owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.consulting_details TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: contacts owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.contacts TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: deal_financials owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.deal_financials TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: deal_todos owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.deal_todos TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: documents owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.documents TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: end_of_day owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.end_of_day TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: google_connections owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.google_connections TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: inputs owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.inputs TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: notes owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.notes TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: organizations owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.organizations TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: owner_profile owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.owner_profile TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: partner_reports owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.partner_reports TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: pipeline_items owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.pipeline_items TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: pipeline_stages owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.pipeline_stages TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: pipelines owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.pipelines TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: projects owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.projects TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: record_links owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.record_links TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: sample_records owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.sample_records TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: stage_history owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.stage_history TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: stage_tasks owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.stage_tasks TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: target_entries owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.target_entries TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: target_misses owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.target_misses TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: targets owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.targets TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: todos owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.todos TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: work_events owner_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_only ON public.work_events TO authenticated USING (public.is_owner(owner_id)) WITH CHECK (public.is_owner(owner_id));


--
-- Name: owner_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_items ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_stages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

--
-- Name: pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: record_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.record_links ENABLE ROW LEVEL SECURITY;

--
-- Name: sample_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sample_records ENABLE ROW LEVEL SECURITY;

--
-- Name: stage_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stage_history ENABLE ROW LEVEL SECURITY;

--
-- Name: stage_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stage_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: target_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.target_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: target_misses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.target_misses ENABLE ROW LEVEL SECURITY;

--
-- Name: targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.targets ENABLE ROW LEVEL SECURITY;

--
-- Name: todos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

--
-- Name: work_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_events ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION before_pipeline_item(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.before_pipeline_item() TO authenticated;
GRANT ALL ON FUNCTION public.before_pipeline_item() TO service_role;


--
-- Name: FUNCTION communication_default_purpose(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.communication_default_purpose() TO authenticated;
GRANT ALL ON FUNCTION public.communication_default_purpose() TO service_role;


--
-- Name: FUNCTION communications_touch_contact(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.communications_touch_contact() TO authenticated;
GRANT ALL ON FUNCTION public.communications_touch_contact() TO service_role;


--
-- Name: FUNCTION current_actor(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_actor() TO authenticated;
GRANT ALL ON FUNCTION public.current_actor() TO service_role;


--
-- Name: FUNCTION deal_todos_before(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.deal_todos_before() TO authenticated;
GRANT ALL ON FUNCTION public.deal_todos_before() TO service_role;


--
-- Name: FUNCTION delete_record_tasks(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_record_tasks() TO authenticated;
GRANT ALL ON FUNCTION public.delete_record_tasks() TO service_role;


--
-- Name: FUNCTION enforce_single_owner(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_single_owner() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_single_owner() TO service_role;


--
-- Name: FUNCTION insert_record_batch(p_batches jsonb, p_actor text, p_sample_batch uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.insert_record_batch(p_batches jsonb, p_actor text, p_sample_batch uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.insert_record_batch(p_batches jsonb, p_actor text, p_sample_batch uuid) TO authenticated;
GRANT ALL ON FUNCTION public.insert_record_batch(p_batches jsonb, p_actor text, p_sample_batch uuid) TO service_role;


--
-- Name: FUNCTION is_owner(row_owner uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_owner(row_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_owner(row_owner uuid) TO service_role;


--
-- Name: FUNCTION log_change(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.log_change() TO authenticated;
GRANT ALL ON FUNCTION public.log_change() TO service_role;


--
-- Name: FUNCTION owner_exists(p_owner uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.owner_exists(p_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.owner_exists(p_owner uuid) TO service_role;


--
-- Name: FUNCTION owner_local_date(p_owner uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.owner_local_date(p_owner uuid) TO authenticated;
GRANT ALL ON FUNCTION public.owner_local_date(p_owner uuid) TO service_role;


--
-- Name: FUNCTION pipeline_item_stage_defaults(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.pipeline_item_stage_defaults() TO authenticated;
GRANT ALL ON FUNCTION public.pipeline_item_stage_defaults() TO service_role;


--
-- Name: FUNCTION protect_finalized_report(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_finalized_report() TO authenticated;
GRANT ALL ON FUNCTION public.protect_finalized_report() TO service_role;


--
-- Name: FUNCTION refresh_contact_last_contact(p_contact uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.refresh_contact_last_contact(p_contact uuid) TO authenticated;
GRANT ALL ON FUNCTION public.refresh_contact_last_contact(p_contact uuid) TO service_role;


--
-- Name: FUNCTION remove_sample_data(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.remove_sample_data() FROM PUBLIC;
GRANT ALL ON FUNCTION public.remove_sample_data() TO authenticated;
GRANT ALL ON FUNCTION public.remove_sample_data() TO service_role;


--
-- Name: FUNCTION seed_owner(p_owner uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.seed_owner(p_owner uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.seed_owner(p_owner uuid) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION track_stage_history(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.track_stage_history() TO authenticated;
GRANT ALL ON FUNCTION public.track_stage_history() TO service_role;


--
-- Name: TABLE ai_order_cache; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_order_cache TO authenticated;
GRANT ALL ON TABLE public.ai_order_cache TO service_role;


--
-- Name: TABLE ai_usage; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_usage TO authenticated;
GRANT ALL ON TABLE public.ai_usage TO service_role;


--
-- Name: TABLE change_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.change_log TO authenticated;
GRANT ALL ON TABLE public.change_log TO service_role;


--
-- Name: TABLE communications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.communications TO authenticated;
GRANT ALL ON TABLE public.communications TO service_role;


--
-- Name: TABLE consulting_details; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consulting_details TO authenticated;
GRANT ALL ON TABLE public.consulting_details TO service_role;


--
-- Name: TABLE contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.contacts TO authenticated;
GRANT ALL ON TABLE public.contacts TO service_role;


--
-- Name: TABLE deal_financials; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deal_financials TO authenticated;
GRANT ALL ON TABLE public.deal_financials TO service_role;


--
-- Name: TABLE deal_todos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deal_todos TO authenticated;
GRANT ALL ON TABLE public.deal_todos TO service_role;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;


--
-- Name: TABLE end_of_day; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.end_of_day TO authenticated;
GRANT ALL ON TABLE public.end_of_day TO service_role;


--
-- Name: TABLE google_connections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.google_connections TO authenticated;
GRANT ALL ON TABLE public.google_connections TO service_role;


--
-- Name: TABLE inputs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inputs TO authenticated;
GRANT ALL ON TABLE public.inputs TO service_role;


--
-- Name: TABLE notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notes TO authenticated;
GRANT ALL ON TABLE public.notes TO service_role;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;


--
-- Name: TABLE owner_profile; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.owner_profile TO authenticated;
GRANT ALL ON TABLE public.owner_profile TO service_role;


--
-- Name: TABLE partner_reports; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_reports TO authenticated;
GRANT ALL ON TABLE public.partner_reports TO service_role;


--
-- Name: TABLE pipeline_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipeline_items TO authenticated;
GRANT ALL ON TABLE public.pipeline_items TO service_role;


--
-- Name: TABLE pipeline_stages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipeline_stages TO authenticated;
GRANT ALL ON TABLE public.pipeline_stages TO service_role;


--
-- Name: TABLE pipelines; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pipelines TO authenticated;
GRANT ALL ON TABLE public.pipelines TO service_role;


--
-- Name: TABLE projects; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.projects TO authenticated;
GRANT ALL ON TABLE public.projects TO service_role;


--
-- Name: TABLE record_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.record_links TO authenticated;
GRANT ALL ON TABLE public.record_links TO service_role;


--
-- Name: TABLE sample_records; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sample_records TO authenticated;
GRANT ALL ON TABLE public.sample_records TO service_role;


--
-- Name: TABLE stage_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stage_history TO authenticated;
GRANT ALL ON TABLE public.stage_history TO service_role;


--
-- Name: TABLE stage_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stage_tasks TO authenticated;
GRANT ALL ON TABLE public.stage_tasks TO service_role;


--
-- Name: TABLE target_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.target_entries TO authenticated;
GRANT ALL ON TABLE public.target_entries TO service_role;


--
-- Name: TABLE target_misses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.target_misses TO authenticated;
GRANT ALL ON TABLE public.target_misses TO service_role;


--
-- Name: TABLE targets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.targets TO authenticated;
GRANT ALL ON TABLE public.targets TO service_role;


--
-- Name: TABLE todos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.todos TO authenticated;
GRANT ALL ON TABLE public.todos TO service_role;


--
-- Name: TABLE work_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.work_events TO authenticated;
GRANT ALL ON TABLE public.work_events TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--



-- ---------------------------------------------------------------------------------------------------------------
-- The owner account: only one account can exist, and the first one gets the defaults.
-- ---------------------------------------------------------------------------------------------------------------
-- Defaults for a new owner: the three pipelines (Acquisitions, Job search, Consulting) with their stages and each
-- stage's default next action, and the settings the app reads. Targets are created by the app on the first open of
-- Targets. Runs once, from the trigger on the owner's account.
create or replace function public.seed_owner(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pipe uuid;
  v_stage uuid;
begin
  insert into public.owner_profile (owner_id) values (p_owner) on conflict do nothing;
  if exists (select 1 from public.pipelines where owner_id = p_owner) then
    return;
  end if;
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Acquisitions', 'acquisition', 1, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Interested', 1, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Sign the NDA and ask the broker for a call', 1, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'NDA signed', 2, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask the broker for the CIM', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'CIM review', 3, 'open', 10, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write the key finding, research the market if interested, request 3 years of financials and unit economics', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Broker call', 4, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for the seller call', 2, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Seller call', 5, 'open', 10, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for tax returns and start the model', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Model', 6, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Book the partner meeting', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Partner presentation', 7, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Submit the IOI or LOI', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'IOI or LOI', 8, 'open', 14, array['revenue','ebitda','asking_price']::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Wait for the broker, follow up in 7 days', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Diligence', 9, 'open', 60, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Data room, quality of earnings, lawyer review', 14, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Closed', 10, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Upload the signed closing documents', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Passed', 11, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason for passing', 1, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lost', 12, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Job search', 'job', 2, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Contact', 1, 'open', 7, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for an introduction or a first conversation', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Conversation', 2, 'open', 14, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Send a thank-you note and ask about the next step', 2, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Interview', 3, 'open', 21, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Prepare for the interview', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Offer', 4, 'open', 7, array['salary']::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Compare the offer with the acquisition path and decide', 5, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Accepted', 5, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Confirm the start date and paperwork', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Declined', 6, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason for declining', 1, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Not chosen', 7, 'lost', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down what happened', 1, 1, false, false);
  insert into public.pipelines (owner_id, name, kind, sort_order, is_active) values (p_owner, 'Consulting', 'consulting', 6, true) returning id into v_pipe;
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lead', 1, 'open', 7, '{}'::text[], 10, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Find out what they need and who decides', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Proposal', 2, 'open', 14, array['rate_type','rate']::text[], 50, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Send the scope and fee', 3, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Engagement', 3, 'open', 7, array['rate_type','rate','start_date']::text[], 100, true) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Do the work and send the invoice on schedule', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Paid', 4, 'open', null, '{}'::text[], 100, true) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for a referral or the next project', 7, 1, true, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Done', 5, 'won', null, '{}'::text[], null, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Ask for a referral or a testimonial', 3, 1, false, false);
  insert into public.pipeline_stages (owner_id, pipeline_id, name, position, outcome, max_days_in_stage, required_fields, default_probability_pct, counts_as_signed) values (p_owner, v_pipe, 'Lost', 6, 'lost', null, '{}'::text[], 0, false) returning id into v_stage;
  insert into public.stage_tasks (owner_id, pipeline_stage_id, title, due_in_days, sort_order, is_next_action_default, is_commitment) values (p_owner, v_stage, 'Write down the reason', 1, 1, false, false);
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'waiting_threshold_days', 'Days waiting on someone before it is marked amber', 'Acquisition', 'number', 5, null, 'On Work on now and Deals, a deal waiting on someone this many days shows an amber count; at double it shows red. Follow up resets the count.', 80) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'outreach_weekly_target', 'Network outreach per week', 'Outreach', 'number', 10, null, 'The weekly counter on Outreach and Home: emails sent and calls logged to people on Outreach, Monday to Friday, out of this number.', 90) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'rosara_weekly_focus', 'Rosara weekly focus', 'Rosara', 'text', null, null, 'The one thing Rosara gets this week. Edited at the top of the Rosara page and shown on Home.', 91) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values (p_owner, 'ai_monthly_cap_usd', 'AI monthly spending cap', 'AI', 'usd', 25, null, 'AI requests stop once this amount is spent in the month. The AI_MONTHLY_CAP_USD setting on the server is the upper limit.', 260) on conflict (owner_id, key) do nothing;
  insert into public.inputs (owner_id, key, label, category, unit, value_number, value_text, description, sort_order) values
    (p_owner, 'anthropic_key_expiry_date', 'Anthropic API key expiry date', 'AI', 'date', null, null, 'Date the Anthropic API key stops working (shown in the Anthropic Console). The app adds a to-do 14 days before.', 265)
  on conflict (owner_id, key) do nothing;
end;
$$;

revoke execute on function public.seed_owner(uuid) from public, anon, authenticated;

create or replace function public.enforce_single_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if exists (select 1 from auth.users where id <> new.id) then
    raise exception 'This app allows one owner account only.';
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  perform public.seed_owner(new.id);
  return new;
end;
$$;

drop trigger if exists enforce_single_owner on auth.users;
create trigger enforce_single_owner before insert on auth.users
  for each row execute function public.enforce_single_owner();
drop trigger if exists on_owner_created on auth.users;
create trigger on_owner_created after insert on auth.users
  for each row execute function public.handle_new_owner();

-- ---------------------------------------------------------------------------------------------------------------
-- Documents (private storage). Files are stored under <owner id>/<record type>/<file>; only the signed-in owner
-- with the second sign-in step can read, add or delete them.
-- ---------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
    on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'owner documents read') then
      execute $p$
        create policy "owner documents read" on storage.objects for select to authenticated
        using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
      $p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'owner documents insert') then
      execute $p$
        create policy "owner documents insert" on storage.objects for insert to authenticated
        with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
      $p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'owner documents delete') then
      execute $p$
        create policy "owner documents delete" on storage.objects for delete to authenticated
        using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text and coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
      $p$;
    end if;
  end if;
end $$;
