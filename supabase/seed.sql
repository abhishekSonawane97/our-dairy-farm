-- Development-only fixtures for the isolated local Supabase stack.
-- Never use this data as real farm history or deploy it to a hosted project.
insert into public.farm_settings (farm_name, timezone, initial_setup_date)
values ('Our Dairy Farm (local sample)', 'Asia/Kolkata', '2026-10-25');

insert into public.billing_cycles (start_date, end_date, cycle_type) values
  ('2026-10-25', '2026-11-03', 'AUTOMATIC'),
  ('2026-11-04', '2026-11-13', 'AUTOMATIC'),
  ('2026-11-14', '2026-11-23', 'AUTOMATIC');

insert into public.milk_records (record_date, session, litres, fat_percent, snf_percent, rate_per_litre, amount, notes) values
  ('2026-10-30', 'MORNING', 12.000, 4.00, 8.30, 45.00, null, 'Local sample · estimated value'),
  ('2026-11-01', 'EVENING', 8.000, 4.20, 8.40, 45.00, 360.00, 'Local sample · recorded value'),
  ('2026-11-08', 'MORNING', 15.000, 4.10, 8.50, 45.00, 675.00, 'Local sample · recorded value'),
  ('2026-11-09', 'EVENING', 9.000, 4.30, 8.60, 45.00, null, 'Local sample · estimated value'),
  ('2026-11-20', 'MORNING', 12.000, 4.00, 8.40, 46.00, null, 'Local sample · estimated value'),
  ('2026-11-20', 'EVENING', 8.000, 4.20, 8.50, 50.00, 400.00, 'Local sample · recorded value');

insert into public.payments (billing_cycle_id, payment_date, amount_received, notes)
select id, '2026-11-02', 300.00, 'Local sample · first installment'
from public.billing_cycles where start_date='2026-10-25';
insert into public.payments (billing_cycle_id, payment_date, amount_received, notes)
select id, '2026-11-12', 500.00, 'Local sample · partial payment'
from public.billing_cycles where start_date='2026-11-04';
insert into public.payments (billing_cycle_id, payment_date, amount_received, notes)
select id, '2026-11-15', 100.00, 'Local sample · second installment'
from public.billing_cycles where start_date='2026-11-04';
insert into public.payments (billing_cycle_id, payment_date, amount_received, notes)
select id, '2026-11-22', 200.00, 'Local sample · partial payment'
from public.billing_cycles where start_date='2026-11-14';
