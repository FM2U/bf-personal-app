-- 0001: extensions and shared helper functions.

create extension if not exists pgcrypto;

-- True when the signed-in user owns the row AND signed in with the second step (authenticator app).
-- "aal2" means the session passed the authenticator-app check.
create or replace function public.is_owner(row_owner uuid)
returns boolean
language sql
stable
as $$
  select row_owner is not null
     and row_owner = auth.uid()
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Keeps updated_at current on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Who made the change: 'ai' when an approved AI proposal is applied, 'system' for scheduled jobs,
-- otherwise 'owner'.
create or replace function public.current_actor()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.actor', true), ''),
    case when auth.role() = 'service_role' then 'system' else 'owner' end
  )
$$;
