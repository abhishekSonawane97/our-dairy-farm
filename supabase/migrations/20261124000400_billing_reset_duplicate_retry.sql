-- Correct reset retry behavior when a cycle already starts on today's date.
create or replace function public.reset_billing_cycle()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Asia/Kolkata')::date;
  v_current public.billing_cycles%rowtype;
  v_new_id uuid;
begin
  if coalesce((select public.has_farm_access()), false) is not true then
    raise exception using errcode='42501', message='Farm access is required to reset a billing cycle';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(72024012);

  select * into v_current from public.billing_cycles
    where start_date=v_today for update;
  if found then
    if exists(select 1 from public.billing_cycles
      where cycle_type='MANUAL_RESET' and end_date=v_today-1) then
      return v_current.id;
    end if;
    raise exception 'A billing cycle already starts today; reset is not applicable';
  end if;

  select * into v_current
    from public.billing_cycles
    where start_date < v_today and end_date >= v_today - 1
    order by start_date desc
    limit 1
    for update;
  if not found then
    raise exception 'No active billing cycle covers today or ended yesterday';
  end if;

  update public.billing_cycles
    set end_date=v_today-1, cycle_type='MANUAL_RESET'
    where id=v_current.id;

  insert into public.billing_cycles(start_date,end_date,cycle_type)
    values(v_today,v_today+9,'AUTOMATIC')
    returning id into v_new_id;
  return v_new_id;
end;
$$;

revoke all on function public.reset_billing_cycle() from public, anon, authenticated;
grant execute on function public.reset_billing_cycle() to authenticated;
