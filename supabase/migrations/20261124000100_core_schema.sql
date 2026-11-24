-- Phase 2.1 proposal: single-farm data model.
-- This migration has not been applied. Do not run until the design is approved.

create table public.farm_settings (
  id uuid primary key default gen_random_uuid(),
  singleton boolean not null default true unique check (singleton),
  farm_name text not null default 'Our Dairy Farm' check (char_length(farm_name) between 1 and 120),
  timezone text not null default 'Asia/Kolkata',
  initial_setup_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.milk_records (
  id uuid primary key default gen_random_uuid(),
  record_date date not null,
  session text not null check (session in ('MORNING', 'EVENING')),
  litres numeric(10, 3) not null check (litres > 0),
  fat_percent numeric(5, 2) check (fat_percent is null or fat_percent >= 0),
  snf_percent numeric(5, 2) check (snf_percent is null or snf_percent >= 0),
  rate_per_litre numeric(10, 2) check (rate_per_litre is null or rate_per_litre >= 0),
  amount numeric(12, 2) check (amount is null or amount >= 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint milk_records_one_session_per_day unique (record_date, session)
);

create table public.billing_cycles (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  cycle_type text not null default 'AUTOMATIC'
    check (cycle_type in ('AUTOMATIC', 'MANUAL_RESET')),
  created_at timestamptz not null default now(),
  constraint billing_cycles_valid_length check (
    end_date >= start_date and end_date <= start_date + 9
    and (cycle_type <> 'AUTOMATIC' or end_date = start_date + 9)
  ),
  constraint billing_cycles_no_overlap exclude using gist (
    daterange(start_date, end_date, '[]') with &&
  )
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  billing_cycle_id uuid not null references public.billing_cycles(id) on delete restrict,
  payment_date date not null,
  amount_received numeric(12, 2) not null check (amount_received > 0),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cattle (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  date_of_birth date,
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index milk_records_date_idx on public.milk_records (record_date desc);
create index milk_records_session_date_idx on public.milk_records (session, record_date desc);
create index billing_cycles_start_date_idx on public.billing_cycles (start_date desc);
create index payments_cycle_date_idx on public.payments (billing_cycle_id, payment_date desc);
create index cattle_status_name_idx on public.cattle (status, name);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger farm_settings_set_updated_at before update on public.farm_settings
for each row execute function public.set_updated_at();
create trigger milk_records_set_updated_at before update on public.milk_records
for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments
for each row execute function public.set_updated_at();
create trigger cattle_set_updated_at before update on public.cattle
for each row execute function public.set_updated_at();
