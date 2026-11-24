-- Phase 2.6: additive, conflict-aware local/hosted-ready backup restore RPC.
-- Apply to isolated local Supabase first. Do not deploy remotely without approval.

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='farm_restore_executor') then
    execute 'create role farm_restore_executor nologin nobypassrls';
  end if;
end;
$$;

alter role farm_restore_executor nologin nobypassrls;
grant usage on schema public to farm_restore_executor;
grant select, insert on public.farm_settings, public.milk_records,
  public.billing_cycles, public.payments, public.cattle to farm_restore_executor;

create or replace function public.farm_restore_has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt()->'app_metadata'->>'farm_access')='true',false);
$$;
revoke all on function public.farm_restore_has_access() from public, anon, authenticated;
grant execute on function public.farm_restore_has_access() to farm_restore_executor;

create policy farm_settings_restore_executor_read on public.farm_settings
  for select to farm_restore_executor using ((select public.farm_restore_has_access()));
create policy farm_settings_restore_executor_insert on public.farm_settings
  for insert to farm_restore_executor with check ((select public.farm_restore_has_access()));

create policy milk_records_restore_executor_read on public.milk_records
  for select to farm_restore_executor using ((select public.farm_restore_has_access()));
create policy milk_records_restore_executor_insert on public.milk_records
  for insert to farm_restore_executor with check ((select public.farm_restore_has_access()));

create policy billing_cycles_restore_executor_read on public.billing_cycles
  for select to farm_restore_executor using ((select public.farm_restore_has_access()));
create policy billing_cycles_restore_executor_insert on public.billing_cycles
  for insert to farm_restore_executor with check ((select public.farm_restore_has_access()));

create policy payments_restore_executor_read on public.payments
  for select to farm_restore_executor using ((select public.farm_restore_has_access()));
create policy payments_restore_executor_insert on public.payments
  for insert to farm_restore_executor with check ((select public.farm_restore_has_access()));

create policy cattle_restore_executor_read on public.cattle
  for select to farm_restore_executor using ((select public.farm_restore_has_access()));
create policy cattle_restore_executor_insert on public.cattle
  for insert to farm_restore_executor with check ((select public.farm_restore_has_access()));

create function public.restore_farm_backup(p_backup jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = on
as $$
declare
  v_data jsonb;
  v_rows jsonb;
  v_row jsonb;
  v_id uuid;
  v_settings public.farm_settings%rowtype;
  v_milk public.milk_records%rowtype;
  v_cycle public.billing_cycles%rowtype;
  v_payment public.payments%rowtype;
  v_cattle public.cattle%rowtype;
  v_cycle_safe_ids uuid[] := array[]::uuid[];
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_conflicts integer := 0;
  v_conflict_details jsonb := '[]'::jsonb;
  v_name text;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_date date;
  v_session text;
  v_litres numeric;
  v_fat numeric;
  v_snf numeric;
  v_rate numeric;
  v_amount numeric;
  v_start date;
  v_end date;
  v_cycle_type text;
  v_payment_date date;
  v_cattle_status text;
  v_dob date;
  v_notes text;
begin
  if coalesce((select public.farm_restore_has_access()), false) is not true then
    raise exception using errcode='42501', message='Farm access is required to restore a backup';
  end if;
  if p_backup is null or pg_catalog.jsonb_typeof(p_backup)<>'object'
     or p_backup->>'format'<>'our-dairy-farm-backup'
     or p_backup->>'version'<>'1' then
    raise exception using errcode='22023', message='Unsupported or malformed farm backup';
  end if;
  v_data:=p_backup->'data';
  if pg_catalog.jsonb_typeof(v_data)<>'object'
     or pg_catalog.jsonb_typeof(v_data->'farm_settings')<>'array'
     or pg_catalog.jsonb_typeof(v_data->'milk_records')<>'array'
     or pg_catalog.jsonb_typeof(v_data->'billing_cycles')<>'array'
     or pg_catalog.jsonb_typeof(v_data->'payments')<>'array'
     or pg_catalog.jsonb_typeof(v_data->'cattle')<>'array' then
    raise exception using errcode='22023', message='Backup data must contain all five record arrays';
  end if;
  if pg_catalog.jsonb_array_length(v_data->'farm_settings')>1 then
    raise exception using errcode='22023', message='Backup contains more than one farm settings row';
  end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(v_data->'payments') p
    where not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_data->'billing_cycles') c
      where c->>'id'=p->>'billing_cycle_id'
    )
  ) then
    raise exception using errcode='23503', message='Backup contains a payment without its billing cycle';
  end if;

  -- Serialize restore operations. All accepted inserts remain in this RPC's transaction.
  perform pg_catalog.pg_advisory_xact_lock(72024013);

  v_rows:=v_data->'farm_settings';
  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    v_id:=(v_row->>'id')::uuid;
    select * into v_settings from public.farm_settings where singleton limit 1;
    if found then
      if v_settings.id=v_id
         and v_settings.farm_name=v_row->>'farm_name'
         and v_settings.timezone=v_row->>'timezone'
         and v_settings.initial_setup_date=(v_row->>'initial_setup_date')::date then
        v_skipped:=v_skipped+1;
      else
        v_conflicts:=v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','farm_settings','id',v_id,'reason','The connected farm already has different settings; existing settings were kept.'));
        end if;
      end if;
    else
      v_created_at:=(v_row->>'created_at')::timestamptz;
      v_updated_at:=(v_row->>'updated_at')::timestamptz;
      begin
        insert into public.farm_settings(id,singleton,farm_name,timezone,initial_setup_date,created_at,updated_at)
        values(v_id,(v_row->>'singleton')::boolean,v_row->>'farm_name',v_row->>'timezone',
          (v_row->>'initial_setup_date')::date,v_created_at,v_updated_at);
        v_inserted:=v_inserted+1;
      exception when unique_violation then
        v_conflicts:=v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','farm_settings','id',v_id,'reason','Farm settings appeared during restore; existing settings were kept.'));
        end if;
      end;
    end if;
  end loop;

  v_rows:=v_data->'billing_cycles';
  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    v_id:=(v_row->>'id')::uuid; v_start:=(v_row->>'start_date')::date;
    v_end:=(v_row->>'end_date')::date; v_cycle_type:=v_row->>'cycle_type';
    select * into v_cycle from public.billing_cycles where id=v_id;
    if found then
      if v_cycle.start_date=v_start and v_cycle.end_date=v_end and v_cycle.cycle_type=v_cycle_type then
        v_skipped:=v_skipped+1; v_cycle_safe_ids:=pg_catalog.array_append(v_cycle_safe_ids,v_id);
      else
        v_conflicts:=v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','billing_cycles','id',v_id,'reason','This cycle ID already exists with different dates or type.'));
        end if;
      end if;
      continue;
    end if;
    if exists(select 1 from public.billing_cycles c where c.id<>v_id and
      pg_catalog.daterange(c.start_date,c.end_date,'[]')&&pg_catalog.daterange(v_start,v_end,'[]')) then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','billing_cycles','id',v_id,'reason','This cycle overlaps a cycle already in the connected farm.'));
      end if;
      continue;
    end if;
    v_created_at:=(v_row->>'created_at')::timestamptz;
    begin
      insert into public.billing_cycles(id,start_date,end_date,cycle_type,created_at)
      values(v_id,v_start,v_end,v_cycle_type,v_created_at);
      v_inserted:=v_inserted+1; v_cycle_safe_ids:=pg_catalog.array_append(v_cycle_safe_ids,v_id);
    exception when exclusion_violation or unique_violation then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','billing_cycles','id',v_id,'reason','A cycle conflict occurred while restoring; it was skipped.'));
      end if;
    end;
  end loop;

  v_rows:=v_data->'milk_records';
  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    v_id:=(v_row->>'id')::uuid; v_date:=(v_row->>'record_date')::date;
    v_session:=v_row->>'session'; v_litres:=(v_row->>'litres')::numeric;
    v_fat:=nullif(v_row->>'fat_percent','null')::numeric;
    v_snf:=nullif(v_row->>'snf_percent','null')::numeric;
    v_rate:=nullif(v_row->>'rate_per_litre','null')::numeric;
    v_amount:=nullif(v_row->>'amount','null')::numeric; v_notes:=v_row->>'notes';
    v_created_at:=(v_row->>'created_at')::timestamptz; v_updated_at:=(v_row->>'updated_at')::timestamptz;
    select * into v_milk from public.milk_records where id=v_id;
    if found then
      if v_milk.record_date=v_date and v_milk.session=v_session and v_milk.litres=v_litres
         and v_milk.fat_percent is not distinct from v_fat and v_milk.snf_percent is not distinct from v_snf
         and v_milk.rate_per_litre is not distinct from v_rate and v_milk.amount is not distinct from v_amount
         and v_milk.notes is not distinct from v_notes and v_milk.created_at=v_created_at and v_milk.updated_at=v_updated_at then
        v_skipped:=v_skipped+1;
      else
        v_conflicts:=v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','milk_records','id',v_id,'reason','This milk record ID already exists with different data.'));
        end if;
      end if;
      continue;
    end if;
    select * into v_milk from public.milk_records where record_date=v_date and session=v_session;
    if found then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','milk_records','id',v_id,'reason','A different record already exists for this date and session.'));
      end if;
      continue;
    end if;
    begin
      insert into public.milk_records(id,record_date,session,litres,fat_percent,snf_percent,rate_per_litre,amount,notes,created_at,updated_at)
      values(v_id,v_date,v_session,v_litres,v_fat,v_snf,v_rate,v_amount,v_notes,v_created_at,v_updated_at);
      v_inserted:=v_inserted+1;
    exception when unique_violation then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','milk_records','id',v_id,'reason','A milk record appeared during restore; it was skipped.'));
      end if;
    end;
  end loop;

  v_rows:=v_data->'cattle';
  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    v_id:=(v_row->>'id')::uuid; v_name:=v_row->>'name'; v_cattle_status:=v_row->>'status';
    v_dob:=nullif(v_row->>'date_of_birth','null')::date; v_notes:=v_row->>'notes';
    v_created_at:=(v_row->>'created_at')::timestamptz; v_updated_at:=(v_row->>'updated_at')::timestamptz;
    select * into v_cattle from public.cattle where id=v_id;
    if found then
      if v_cattle.name=v_name and v_cattle.status=v_cattle_status and v_cattle.date_of_birth is not distinct from v_dob
         and v_cattle.notes is not distinct from v_notes and v_cattle.created_at=v_created_at and v_cattle.updated_at=v_updated_at then
        v_skipped:=v_skipped+1;
      else
        v_conflicts:=v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','cattle','id',v_id,'reason','This cattle ID already exists with different data.'));
        end if;
      end if;
      continue;
    end if;
    select * into v_cattle from public.cattle where pg_catalog.lower(pg_catalog.btrim(name))=pg_catalog.lower(pg_catalog.btrim(v_name))
      and date_of_birth is not distinct from v_dob;
    if found then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','cattle','id',v_id,'reason','A cattle record with the same name and birth date already exists.'));
      end if;
      continue;
    end if;
    begin
      insert into public.cattle(id,name,status,date_of_birth,notes,created_at,updated_at)
      values(v_id,v_name,v_cattle_status,v_dob,v_notes,v_created_at,v_updated_at);
      v_inserted:=v_inserted+1;
    exception when unique_violation then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','cattle','id',v_id,'reason','A cattle record appeared during restore; it was skipped.'));
      end if;
    end;
  end loop;

  v_rows:=v_data->'payments';
  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    v_id:=(v_row->>'id')::uuid; v_id:=v_id;
    v_payment_date:=(v_row->>'payment_date')::date; v_amount:=(v_row->>'amount_received')::numeric;
    v_notes:=v_row->>'notes'; v_created_at:=(v_row->>'created_at')::timestamptz;
    v_updated_at:=(v_row->>'updated_at')::timestamptz;
    if not ((v_row->>'billing_cycle_id')::uuid=any(v_cycle_safe_ids)) then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','payments','id',v_id,'reason','The linked billing cycle was not restored safely.'));
      end if;
      continue;
    end if;
    select * into v_payment from public.payments where id=v_id;
    if found then
      if v_payment.billing_cycle_id=(v_row->>'billing_cycle_id')::uuid and v_payment.payment_date=v_payment_date
         and v_payment.amount_received=v_amount and v_payment.notes is not distinct from v_notes
         and v_payment.created_at=v_created_at and v_payment.updated_at=v_updated_at then
        v_skipped:=v_skipped+1;
      else
        v_conflicts:=v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','payments','id',v_id,'reason','This payment ID already exists with different data.'));
        end if;
      end if;
      continue;
    end if;
    select * into v_payment from public.payments where billing_cycle_id=(v_row->>'billing_cycle_id')::uuid
      and payment_date=v_payment_date and amount_received=v_amount and notes is not distinct from v_notes;
    if found then
      v_skipped:=v_skipped+1;
      continue;
    end if;
    begin
      insert into public.payments(id,billing_cycle_id,payment_date,amount_received,notes,created_at,updated_at)
      values(v_id,(v_row->>'billing_cycle_id')::uuid,v_payment_date,v_amount,v_notes,v_created_at,v_updated_at);
      v_inserted:=v_inserted+1;
    exception when unique_violation then
      v_conflicts:=v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details:=v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','payments','id',v_id,'reason','A payment appeared during restore; it was skipped.'));
      end if;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'inserted',v_inserted,'skipped',v_skipped,'conflicts',v_conflicts,
    'conflict_details',v_conflict_details
  );
end;
$$;

grant farm_restore_executor to postgres;
grant create on schema public to farm_restore_executor;
alter function public.restore_farm_backup(jsonb) owner to farm_restore_executor;
revoke create on schema public from farm_restore_executor;
revoke all on function public.restore_farm_backup(jsonb) from public, anon, authenticated;
grant execute on function public.restore_farm_backup(jsonb) to authenticated;
revoke farm_restore_executor from postgres;
