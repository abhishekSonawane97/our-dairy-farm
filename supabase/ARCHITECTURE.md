# Our Dairy Farm: database and authentication status

## Current status

The app is a single-farm vanilla HTML/CSS/JavaScript frontend using Supabase JavaScript SDK v2. The five-table schema and migrations `00100`–`00400` are recorded as applied to the isolated local Supabase project `dairy_farm`. The local stack has been validated; no hosted project has been linked, contacted, or changed.

Production authentication and production farm-data access are **not implemented**. This document describes the current local implementation and explicitly marks planned production work as outstanding.

## Local authentication

For local development, `scripts/local-dev-server.py` serves the application and provides `POST /__local_auth/pin`. The helper checks the development PIN (`246810` by default, configurable using `DAIRY_FARM_LOCAL_PIN`), reads the random local test account password from `/tmp/our-dairy-farm/local-auth.json`, and signs in to the local Supabase Auth service. The browser receives a normal local Auth session. Supabase JS persists and refreshes that session; database requests run as `authenticated` and are governed by RLS.

`scripts/provision-local-milk-user.py` provisions only the local test user. It reads local Supabase CLI output, sets the trusted `app_metadata.farm_access` claim, generates a random account password, and writes it outside the repository with owner-only permissions. The local helper and test account are development-only. Never package them with the production site.

The frontend currently selects local configuration by checking its runtime host and, for private LAN addresses, the `localSupabase=1` query parameter. The non-local branch has a hosted URL/publishable key for the connection test, but production sign-in and farm CRUD are not implemented. This runtime switch must be replaced with an explicit production-safe build/configuration before release.

## Data model

The project currently represents one farm per Supabase project; records have no `farm_id` tenant column.

- `farm_settings`: a singleton farm name, timezone, and initial setup date.
- `milk_records`: one morning and one evening record per date, enforced by a unique `(record_date, session)` constraint. Missing sessions remain absent.
- `billing_cycles`: inclusive start/end dates; automatic cycles are ten days; an exclusion constraint prevents overlaps.
- `payments`: positive installments referencing a billing cycle with `ON DELETE RESTRICT`.
- `cattle`: name, optional birth date and notes, and `ACTIVE`/`INACTIVE` state. Deactivation preserves the row.

Indexes cover milk date/session, cycle start, payment cycle/date, and cattle status/name. Updated-at triggers are used where applicable.

## Grants, RLS, and functions

All five public tables have RLS enabled and forced. The migrations revoke table privileges from `PUBLIC` and `anon`. The local audit confirmed no anonymous table grants. Authenticated farm requests require the signed `app_metadata.farm_access = 'true'` claim through `public.has_farm_access()`; the policies do not trust user-editable metadata. Authenticated users can select, insert, and update milk, payments, and cattle; they can only select farm settings and cycles. Authenticated deletes are not granted.

- `initialize_farm(date)` is `SECURITY DEFINER` and executable by `service_role` only. It creates singleton farm settings and the first ten-day cycle; retrying the same date is safe.
- `reset_billing_cycle()` is `SECURITY DEFINER`, executable by authenticated users, checks `farm_access`, serializes requests, and creates a new cycle without granting direct cycle writes.
- `restore_farm_backup(jsonb)` is an authenticated, claim-gated, additive restore RPC. It uses a dedicated `farm_restore_executor` role (`NOLOGIN`, `NOBYPASSRLS`) with select/insert-only table grants and RLS policies. It preserves UUIDs and reports conflicts rather than overwriting or deleting existing records.
- `set_updated_at()` is a trigger function, not a browser RPC.

The local database audit verified RLS, grants, policies, and function ACLs. Hosted permissions still require independent review after a separately approved staging deployment. No service-role or secret key is shipped to the frontend.

One data-integrity decision remains: the UI treats payments as append-only, but current authenticated database grants permit payment updates. Decide whether to remove that capability before production.

## Migration history

These migration files are present in the repository in timestamp order:

1. `migrations/20261124000100_core_schema.sql` — five tables, constraints, indexes, timestamps.
2. `migrations/20261124000200_security_and_bootstrap.sql` — grants, RLS policies, `has_farm_access()`, and `initialize_farm(date)`.
3. `migrations/20261124000300_billing_cycle_reset.sql` — claim-gated manual reset RPC.
4. `migrations/20261124000400_billing_reset_duplicate_retry.sql` — same-day duplicate/retry correction for reset.
5. `migrations/20261124000500_backup_restore.sql` — constrained restore role and additive restore RPC.

The local CLI/database migration history records only `00100`–`00400` as applied and reports `00500` pending. At the same time, the local database contains `restore_farm_backup(jsonb)`, `farm_restore_has_access()`, and the `farm_restore_executor` role. The migration effects appear present but are not represented by the migration history. Resolve this discrepancy against the isolated local database, with a backup and without deleting local data, before using `db push` or relying on migration history. The browser backup download works; restore was not exercised during the release-baseline check.

`supabase/seed.sql` contains local-only fixtures and is enabled by the local CLI config. It is not a production migration and must not be run against a hosted project. The `00100` SQL header still contains an earlier “not applied” proposal comment; this historical comment was left unchanged to avoid rewriting an applied migration. This status section reflects the actual migration-history and object checks performed for this baseline.

## Production work not yet completed

Before production data access is enabled:

1. Implement the approved production authentication flow in a trusted server-side component. A future shared-PIN verifier must keep its hash/credential server-side, use central rate limits, issue a Supabase Auth session for the same farm identity on each device, and support PIN rotation, lost-device recovery, and session invalidation.
2. Keep authorization in the signed `app_metadata.farm_access` claim and RLS. Never accept a UI-only PIN state or user-editable metadata as database authorization.
3. Replace host/query-based local-mode detection with explicit, separate local/staging/production configuration. Exclude the local helper, provisioning script, and seed fixtures from deployed output.
4. Use a public publishable key in browser code only; keep any Supabase secret key exclusively in a server-side secret store. Production sign-up, redirect allowlist, and Auth settings must be configured deliberately.
5. Test the reviewed migration chain, RLS, functions, and authentication against an isolated hosted staging project before production approval.

## Data migration and initialization

For a new farm with no records to import, apply migrations and then invoke `public.initialize_farm(<chosen setup date>)` through a trusted operator process. Verify the settings row and first inclusive ten-day cycle.

For a backup import, apply migrations to an empty target and do **not** initialize first. Sign in with an authorized farm session, run the additive restore, and review inserted/skipped/conflict counts. The initializer creates different settings/cycle IDs and can conflict with imported settings and overlapping cycle ranges. Verify all UUIDs, payment foreign keys, cycle ranges, table counts, and milk/payment/billing totals against the source before opening the app to family devices. Pause writes while generating a backup because the client reads tables in separate paginated requests rather than a single database snapshot.

No hosted migration or data import has been performed.
