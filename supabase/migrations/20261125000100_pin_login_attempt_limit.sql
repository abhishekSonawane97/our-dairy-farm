-- Minimal server-only storage for shared-PIN login throttling.
-- Raw client IP addresses and PIN values are never stored here.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.pin_login_attempts (
  ip_key text primary key check (ip_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count between 1 and 6),
  cooldown_until timestamptz,
  updated_at timestamptz not null default pg_catalog.now()
);

alter table private.pin_login_attempts enable row level security;
alter table private.pin_login_attempts force row level security;
revoke all on private.pin_login_attempts from public, anon, authenticated, service_role;

create or replace function public.farm_pin_login_reserve(p_ip_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.pin_login_attempts%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit identifier';
  end if;

  insert into private.pin_login_attempts as current_attempt
    (ip_key, window_started_at, attempt_count, cooldown_until, updated_at)
  values (p_ip_key, v_now, 1, null, v_now)
  on conflict (ip_key) do update set
    window_started_at = case
      when current_attempt.cooldown_until is not null and current_attempt.cooldown_until <= v_now
        then v_now
      when current_attempt.window_started_at <= v_now - interval '15 minutes'
        then v_now
      else current_attempt.window_started_at
    end,
    attempt_count = case
      when (current_attempt.cooldown_until is not null and current_attempt.cooldown_until <= v_now)
        or current_attempt.window_started_at <= v_now - interval '15 minutes'
        then 1
      else least(current_attempt.attempt_count + 1, 6)
    end,
    cooldown_until = case
      when current_attempt.cooldown_until > v_now then current_attempt.cooldown_until
      when current_attempt.cooldown_until is not null and current_attempt.cooldown_until <= v_now then null
      when current_attempt.window_started_at <= v_now - interval '15 minutes' then null
      when current_attempt.attempt_count >= 5 then v_now + interval '15 minutes'
      else null
    end,
    updated_at = v_now
  returning * into v_attempt;

  -- Bound storage growth for abandoned or one-off IP hashes.
  delete from private.pin_login_attempts
    where updated_at < v_now - interval '30 days' and ip_key <> p_ip_key;

  return query select
    v_attempt.cooldown_until is null,
    case when v_attempt.cooldown_until is null then 0
      else greatest(1, ceil(extract(epoch from (v_attempt.cooldown_until - v_now)))::integer)
    end;
end;
$$;

create or replace function public.farm_pin_login_clear(p_ip_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit identifier';
  end if;
  delete from private.pin_login_attempts where ip_key = p_ip_key;
end;
$$;

revoke all on function public.farm_pin_login_reserve(text) from public, anon, authenticated;
revoke all on function public.farm_pin_login_clear(text) from public, anon, authenticated;
grant execute on function public.farm_pin_login_reserve(text) to service_role;
grant execute on function public.farm_pin_login_clear(text) to service_role;
