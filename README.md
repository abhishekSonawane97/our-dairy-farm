# Our Dairy Farm

A mobile-first, single-page farm journal built with vanilla HTML, CSS, and JavaScript. The current application is a **local development preview** backed by an isolated Supabase Docker project. Production authentication, production data access, and deployment are not ready.

## Local development setup

Requirements: Docker, the Supabase CLI, and Python 3. The repository has no npm install or frontend build step. This baseline review used Supabase CLI v2.2.1; the CLI reports v3.3.0 is available. The project does not pin a CLI version yet, so select and document a supported version before future migration work.

1. From this directory, start the isolated Supabase project:

   ```sh
   supabase start
   ```

   The project uses `supabase/config.toml`, project id `dairy_farm`, API port `55321`, and database port `55322`. Its configured seed file contains development fixtures. Do not run these fixtures against a hosted project.

2. Provision or verify the local Auth test account:

   ```sh
   python3 scripts/provision-local-milk-user.py
   ```

   This script is for local development only. It obtains credentials from the local Supabase CLI, provisions the local Auth test identity with the trusted `app_metadata.farm_access` claim, and stores its random password in `/tmp/our-dairy-farm/local-auth.json` with owner-only permissions. The file is outside the project and must not be committed or copied into a deployment.

3. Start the frontend and local PIN helper:

   ```sh
   python3 scripts/local-dev-server.py
   ```

   Open [http://localhost:8001](http://localhost:8001). The helper serves the app and accepts the local development PIN `246810` (overridable with `DAIRY_FARM_LOCAL_PIN`). For a phone on the same trusted Wi-Fi, `python3 scripts/local-dev-server.py --lan` exposes the local server; open `http://<laptop-LAN-IP>:8001/?localSupabase=1`. Use LAN mode only on a trusted network.

4. Stop the web server with Ctrl+C. Stop only this local Supabase project with:

   ```sh
   supabase stop
   ```

### Local PIN authentication

The PIN is not a production credential and does not authorize database requests by itself. The local-only Python helper checks the PIN and exchanges it for a Supabase Auth session for the provisioned local test account. The browser then uses the normal local Supabase session and RLS policies. The Supabase SDK persists the session in browser storage. The test identity has `app_metadata.farm_access = true`; the local provisioning script sets this using the local administrative key, while the browser receives no service-role or secret key.

The local helper, test account, PIN, and credential file are development-only. Production authentication has not been implemented. Do not use the PIN gate or local helper as production security.

## What works locally

- Milk records: fetch, add, and edit morning/evening sessions independently; unique date/session records; daily totals and historical comparisons.
- Billing cycles and payments: cycle summaries, estimates, weighted values, installments, and authorized manual cycle reset.
- Cattle register: list, add, edit, and activate/deactivate cattle while retaining records.
- Reports: daily, billing-cycle, monthly, and cattle reports with browser print/PDF output.
- Backup and restore: download a versioned JSON snapshot and perform an additive, conflict-aware restore through an authenticated RPC.

The UI loads farm records from local Supabase; milk, billing, payment, and cattle records are not stored in app `localStorage`. Current local data includes development fixtures and local test activity. Do not treat it as verified production farm history.

## Local migrations and seed data

The first four migrations are recorded as applied in the isolated local database, in timestamp order:

1. `supabase/migrations/20261124000100_core_schema.sql`
2. `supabase/migrations/20261124000200_security_and_bootstrap.sql`
3. `supabase/migrations/20261124000300_billing_cycle_reset.sql`
4. `supabase/migrations/20261124000400_billing_reset_duplicate_retry.sql`

`20261124000500_backup_restore.sql` is present in the repository, and its restore function, helper, and executor role exist in the local database. However, the local Supabase migration history/CLI lists only `00100`–`00400` as applied and reports `00500` pending. The schema objects and migration history therefore disagree. Do not run `supabase db push` or reset to reconcile this casually; resolve this discrepancy in the isolated local project first, preserving local data. The browser backup download was verified, but backup restore was not exercised in this baseline check.

`supabase/seed.sql` is local-only development data. It is configured for local Supabase startup/reset and must never be used to populate a hosted farm. Avoid `supabase db reset` when you need to preserve local records; reset rebuilds the local database and reruns migrations and seed data.

## Production status

This project is not production-ready. The hosted project has not been linked, contacted, or modified. Production PIN verification and session recovery, production environment configuration, a deploy-only artifact, hosted migration review, and Cloudflare Pages configuration remain outstanding. See [PRODUCTION_RELEASE_CHECKLIST.md](PRODUCTION_RELEASE_CHECKLIST.md) and [supabase/ARCHITECTURE.md](supabase/ARCHITECTURE.md).

The browser config currently contains a hosted project URL and publishable key for the connection-test path. Publishable keys are public identifiers, not secret credentials; no service-role or Supabase secret key belongs in frontend files. Production farm CRUD is not enabled.
