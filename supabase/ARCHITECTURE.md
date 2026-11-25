# Our Dairy Farm: database and authentication status

## Current status

The app is a single-farm vanilla HTML/CSS/JavaScript frontend using Supabase JavaScript SDK v2. The five-table schema and migrations `00100`–`00400` are recorded as applied to the isolated local Supabase project `dairy_farm`. The local stack has been validated; no hosted project has been linked, contacted, or changed.

The shared-PIN authentication flow is implemented and browser-tested against the isolated local project. Production authentication and production farm-data access are **not yet deployed or verified**. This document describes the local implementation and marks hosted work as outstanding.

## Local authentication

The source app's shared PIN screen calls `farm-pin-login`, a local Supabase Edge Function. The function compares a keyed HMAC verifier, checks the private attempt limiter, and signs in the pre-provisioned local test identity through the normal Supabase Auth password flow. It returns an access/refresh token pair; the browser installs the genuine session with `auth.setSession()`. Supabase JS persists and refreshes the session, and all farm requests continue to use the existing RLS policies.

`scripts/provision-local-milk-user.py` provisions the local Auth identity and sets its trusted `app_metadata.farm_access` claim using the local administrative key. `scripts/provision-local-pin-function.py` reads that account's password from `/tmp/our-dairy-farm/local-auth.json`, creates random PIN/rate-limit peppers and a keyed verifier, and writes ignored `supabase/functions/.env` with owner-only permissions. The local PIN defaults to `246810`; set `DAIRY_FARM_LOCAL_PIN` when running the helper to change it. Neither file is frontend code, and no local credential is used by the production build.

For local testing, start `supabase functions serve farm-pin-login --env-file supabase/functions/.env` and the static `scripts/local-dev-server.py` separately. The static server no longer verifies PINs or exchanges Auth credentials. Local loopback/private-LAN origins are allowed only when the local function environment explicitly sets `FARM_PIN_ALLOW_LOCAL_ORIGINS=true`; production function configuration must omit that setting and allow only the real Pages origin.

The source development app loads an explicitly local configuration. The hostname is used only to route the local API/helper to the laptop address for phone-on-LAN testing. It does not select the environment. `scripts/build-production.py` writes a separate production runtime configuration into `dist/` from build environment variables. There is no localhost fallback in that generated config.

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
6. `migrations/20261125000100_pin_login_attempt_limit.sql` — private IP-hash attempt table and service-role-only atomic limiter RPCs.

The local CLI migration history reports `00500` pending, but the local database already contains its objects. Running `supabase migration up --local` fails because the restore migration tries to recreate an existing policy. For this authentication phase, `20261125000100` was applied directly to the local database inside one transaction; its version is not recorded in CLI history. Before using normal migration deployment, reconcile this mismatch carefully without resetting local data. The auth migration itself does not change any of the five farm tables or their RLS policies.

`supabase/seed.sql` contains local-only fixtures and is enabled by the local CLI config. It is not a production migration and must not be run against a hosted project. The `00100` SQL header still contains an earlier “not applied” proposal comment; this historical comment was left unchanged to avoid rewriting an applied migration. This status section reflects the actual migration-history and object checks performed for this baseline.

## Production work not yet completed

Before production data access is enabled:

1. Deploy and configure the reviewed `farm-pin-login` Edge Function on a separately approved hosted project, provision the shared Auth identity with `app_metadata.farm_access = true`, set PIN verifier/account secrets, and allow only the actual Pages origin. The first release uses only a basic per-IP cooldown; PIN rotation/recovery and immediate session invalidation remain deferred.
2. Keep authorization in the signed `app_metadata.farm_access` claim and RLS. Never accept a UI-only PIN state or user-editable metadata as database authorization.
3. Use the explicit production build configuration and allowlisted artifact. The builder excludes the local helper, provisioning script, and seed fixtures.
4. Use a public publishable key in browser code only; keep any Supabase secret key exclusively in a server-side secret store. Production sign-up, redirect allowlist, and Auth settings must be configured deliberately.
5. Test the reviewed migration chain, RLS, functions, and authentication against an isolated hosted staging project before production approval.

## Data migration and initialization

For a new farm with no records to import, apply migrations and then invoke `public.initialize_farm(<chosen setup date>)` through a trusted operator process. Verify the settings row and first inclusive ten-day cycle.

For a backup import, apply migrations to an empty target and do **not** initialize first. Sign in with an authorized farm session, run the additive restore, and review inserted/skipped/conflict counts. The initializer creates different settings/cycle IDs and can conflict with imported settings and overlapping cycle ranges. Verify all UUIDs, payment foreign keys, cycle ranges, table counts, and milk/payment/billing totals against the source before opening the app to family devices. Pause writes while generating a backup because the client reads tables in separate paginated requests rather than a single database snapshot.

No hosted migration or data import has been performed.

## Environment boundary

- Source development config is explicitly `local`; it has the local API port and local publishable key. The shared UI calls the local Edge Function, while `js/local-auth.js` contains local-only connection and sign-out controls.
- The production builder requires `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, validates that the URL is HTTPS and not a localhost/private address, rejects non-publishable key formats, and writes `environment: "production"` plus `productionAuthConfigured: false` into `dist/js/supabase-config.js`.
- Production startup remains fail-closed: with `productionAuthConfigured: false`, it does not create a client, restore a session, or send Supabase API requests. The production artifact includes the shared PIN form handler but excludes `js/local-auth.js`; no local PIN helper, test credentials, seed data, provisioning scripts, local Supabase config, or migrations are shipped.
- `scripts/`, `supabase/`, seed data, migration files, and local credential files are not included by the build allowlist.
- Build example (uses a reserved non-routable test hostname and fake publishable value; it does not contact a project):

  ```sh
  SUPABASE_URL=https://dairy-farm-build-test.invalid \
  SUPABASE_PUBLISHABLE_KEY=sb_publishable_build_test_only \
  python3 scripts/build-production.py
  ```

Production authentication is still outstanding. The local Edge Function implementation is not deployed; this build is intentionally locked and should not be deployed for farm use.
