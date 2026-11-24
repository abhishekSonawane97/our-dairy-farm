-- Phase 2.1 proposal: authorization and one-time initialization.
-- This migration has not been applied. Do not run until the design is approved.

revoke create on schema public from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;

revoke all on public.farm_settings, public.milk_records, public.billing_cycles,
  public.payments, public.cattle from public, anon, authenticated, service_role;

-- Ordinary shared-farm sessions may read/update data, but never delete history.
grant select on public.farm_settings, public.billing_cycles to authenticated;
grant select, insert, update on public.milk_records, public.payments, public.cattle to authenticated;

-- Bootstrap is an operational server-only step. It does not grant browser access.
grant select, insert, update on public.farm_settings, public.billing_cycles to service_role;
grant select, insert, update on public.milk_records, public.payments, public.cattle to service_role;

create function public.has_farm_access()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'farm_access') = 'true',
    false
  );
$$;
revoke all on function public.has_farm_access() from public, anon;
grant execute on function public.has_farm_access() to authenticated;

alter table public.farm_settings enable row level security;
alter table public.farm_settings force row level security;
alter table public.milk_records enable row level security;
alter table public.milk_records force row level security;
alter table public.billing_cycles enable row level security;
alter table public.billing_cycles force row level security;
alter table public.payments enable row level security;
alter table public.payments force row level security;
alter table public.cattle enable row level security;
alter table public.cattle force row level security;

create policy farm_settings_read_shared_farm on public.farm_settings
  for select to authenticated
  using ((select public.has_farm_access()));

create policy milk_records_read_shared_farm on public.milk_records
  for select to authenticated
  using ((select public.has_farm_access()));
create policy milk_records_insert_shared_farm on public.milk_records
  for insert to authenticated
  with check ((select public.has_farm_access()));
create policy milk_records_update_shared_farm on public.milk_records
  for update to authenticated
  using ((select public.has_farm_access()))
  with check ((select public.has_farm_access()));

create policy billing_cycles_read_shared_farm on public.billing_cycles
  for select to authenticated
  using ((select public.has_farm_access()));

create policy payments_read_shared_farm on public.payments
  for select to authenticated
  using ((select public.has_farm_access()));
create policy payments_insert_shared_farm on public.payments
  for insert to authenticated
  with check ((select public.has_farm_access()));
create policy payments_update_shared_farm on public.payments
  for update to authenticated
  using ((select public.has_farm_access()))
  with check ((select public.has_farm_access()));

create policy cattle_read_shared_farm on public.cattle
  for select to authenticated
  using ((select public.has_farm_access()));
create policy cattle_insert_shared_farm on public.cattle
  for insert to authenticated
  with check ((select public.has_farm_access()));
create policy cattle_update_shared_farm on public.cattle
  for update to authenticated
  using ((select public.has_farm_access()))
  with check ((select public.has_farm_access()));

-- Called once by an operator/server using a server-only credential after approval.
-- It creates the singleton settings row and the first inclusive 10-day cycle atomically.
create function public.initialize_farm(p_initial_setup_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing_date date;
  v_settings_id uuid;
  v_cycle_id uuid;
begin
  if p_initial_setup_date is null then
    raise exception 'Initial setup date is required';
  end if;

  -- Serialize concurrent retries even before the singleton row exists.
  perform pg_catalog.pg_advisory_xact_lock(72024011);

  select id, initial_setup_date
    into v_settings_id, v_existing_date
    from public.farm_settings
    where singleton
    for update;

  if v_settings_id is not null then
    if v_existing_date <> p_initial_setup_date then
      raise exception 'Farm is already initialized with a different setup date';
    end if;
    select id into v_cycle_id from public.billing_cycles
      where start_date = p_initial_setup_date and cycle_type = 'AUTOMATIC';
    if v_cycle_id is null then
      raise exception 'Farm settings exist but the initial billing cycle is missing';
    end if;
    return v_cycle_id;
  end if;

  insert into public.farm_settings (initial_setup_date)
    values (p_initial_setup_date)
    returning id into v_settings_id;

  insert into public.billing_cycles (start_date, end_date, cycle_type)
    values (p_initial_setup_date, p_initial_setup_date + 9, 'AUTOMATIC')
    returning id into v_cycle_id;

  return v_cycle_id;
end;
$$;
revoke all on function public.initialize_farm(date) from public, anon, authenticated;
grant execute on function public.initialize_farm(date) to service_role;
