-- Add optional cattle identity and calving metadata without changing existing rows.
alter table public.cattle
  add column animal_id text,
  add column calving_number integer;

alter table public.cattle
  add constraint cattle_animal_id_valid check (
    animal_id is null or char_length(btrim(animal_id)) between 1 and 60
  ),
  add constraint cattle_calving_number_nonnegative check (
    calving_number is null or calving_number >= 0
  );

-- Keep the previous restore RPC compatible with existing backups while adding
-- new cattle fields only for rows that are safe to insert.
create function public.restore_farm_backup_with_cattle(p_backup jsonb)
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
  v_base_backup jsonb;
  v_result jsonb;
  v_cattle public.cattle%rowtype;
  v_id uuid;
  v_name text;
  v_status text;
  v_animal_id text;
  v_calving_number integer;
  v_calving_numeric numeric;
  v_dob date;
  v_notes text;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_conflicts integer := 0;
  v_conflict_details jsonb := '[]'::jsonb;
begin
  if coalesce((select public.farm_restore_has_access()), false) is not true then
    raise exception using errcode='42501', message='Farm access is required to restore a backup';
  end if;

  v_data := p_backup->'data';
  v_rows := v_data->'cattle';
  if pg_catalog.jsonb_typeof(v_rows) is distinct from 'array' then
    raise exception using errcode='22023', message='Backup cattle data must be an array';
  end if;

  -- Validate new fields before the existing all-table restore runs.
  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    if v_row ? 'animal_id' and pg_catalog.jsonb_typeof(v_row->'animal_id') not in ('string','null') then
      raise exception using errcode='22023', message='Backup animal_id must be text or null';
    end if;
    if v_row ? 'animal_id' and pg_catalog.jsonb_typeof(v_row->'animal_id')='string'
       and (pg_catalog.char_length(pg_catalog.btrim(v_row->>'animal_id')) not between 1 and 60) then
      raise exception using errcode='22023', message='Backup animal_id must contain 1 to 60 characters';
    end if;
    if v_row ? 'calving_number' and pg_catalog.jsonb_typeof(v_row->'calving_number') not in ('number','null') then
      raise exception using errcode='22023', message='Backup calving_number must be a whole number or null';
    end if;
    if pg_catalog.jsonb_typeof(v_row->'calving_number')='number' then
      v_calving_numeric := (v_row->>'calving_number')::numeric;
      if v_calving_numeric < 0 or pg_catalog.trunc(v_calving_numeric)<>v_calving_numeric
         or v_calving_numeric > 2147483647 then
        raise exception using errcode='22023', message='Backup calving_number must be a non-negative whole number';
      end if;
    end if;
  end loop;

  -- The existing restore RPC serializes all restore operations and preserves
  -- its established conflict handling for settings, milk, cycles, and payments.
  v_base_backup := pg_catalog.jsonb_set(p_backup,'{data,cattle}','[]'::jsonb,false);
  v_result := public.restore_farm_backup(v_base_backup);

  for v_row in select value from pg_catalog.jsonb_array_elements(v_rows) loop
    v_id := (v_row->>'id')::uuid;
    v_name := v_row->>'name';
    v_status := v_row->>'status';
    v_animal_id := nullif(v_row->>'animal_id','');
    v_calving_number := nullif(v_row->>'calving_number','')::integer;
    v_dob := nullif(v_row->>'date_of_birth','null')::date;
    v_notes := v_row->>'notes';
    v_created_at := (v_row->>'created_at')::timestamptz;
    v_updated_at := (v_row->>'updated_at')::timestamptz;

    select * into v_cattle from public.cattle where id=v_id;
    if found then
      if v_cattle.name=v_name and v_cattle.status=v_status
         and v_cattle.animal_id is not distinct from v_animal_id
         and v_cattle.calving_number is not distinct from v_calving_number
         and v_cattle.date_of_birth is not distinct from v_dob
         and v_cattle.notes is not distinct from v_notes
         and v_cattle.created_at=v_created_at and v_cattle.updated_at=v_updated_at then
        v_skipped := v_skipped+1;
      else
        v_conflicts := v_conflicts+1;
        if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
          v_conflict_details := v_conflict_details||pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object('type','cattle','id',v_id,'reason','This cattle ID already exists with different data.'));
        end if;
      end if;
      continue;
    end if;

    select * into v_cattle from public.cattle
    where pg_catalog.lower(pg_catalog.btrim(name))=pg_catalog.lower(pg_catalog.btrim(v_name))
      and date_of_birth is not distinct from v_dob;
    if found then
      v_conflicts := v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details := v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','cattle','id',v_id,'reason','A cattle record with the same name and birth date already exists.'));
      end if;
      continue;
    end if;

    begin
      insert into public.cattle(id,name,animal_id,calving_number,status,date_of_birth,notes,created_at,updated_at)
      values(v_id,v_name,v_animal_id,v_calving_number,v_status,v_dob,v_notes,v_created_at,v_updated_at);
      v_inserted := v_inserted+1;
    exception when unique_violation then
      v_conflicts := v_conflicts+1;
      if pg_catalog.jsonb_array_length(v_conflict_details)<100 then
        v_conflict_details := v_conflict_details||pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object('type','cattle','id',v_id,'reason','A cattle record appeared during restore; it was skipped.'));
      end if;
    end;
  end loop;

  v_result := pg_catalog.jsonb_set(v_result,'{inserted}',pg_catalog.to_jsonb((v_result->>'inserted')::integer+v_inserted),true);
  v_result := pg_catalog.jsonb_set(v_result,'{skipped}',pg_catalog.to_jsonb((v_result->>'skipped')::integer+v_skipped),true);
  v_result := pg_catalog.jsonb_set(v_result,'{conflicts}',pg_catalog.to_jsonb((v_result->>'conflicts')::integer+v_conflicts),true);
  v_result := pg_catalog.jsonb_set(v_result,'{conflict_details}',
    coalesce(v_result->'conflict_details','[]'::jsonb)||v_conflict_details,true);
  return v_result;
end;
$$;

grant farm_restore_executor to postgres;
grant create on schema public to farm_restore_executor;
alter function public.restore_farm_backup_with_cattle(jsonb) owner to farm_restore_executor;
revoke create on schema public from farm_restore_executor;
revoke farm_restore_executor from postgres;
revoke all on function public.restore_farm_backup_with_cattle(jsonb) from public, anon, authenticated;
grant execute on function public.restore_farm_backup_with_cattle(jsonb) to authenticated;
