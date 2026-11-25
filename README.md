# Our Dairy Farm

A mobile-first, single-page farm journal built with vanilla HTML, CSS, and JavaScript. The current application is a **local development preview** backed by an isolated Supabase Docker project. Production authentication, production data access, and deployment are not ready.

## Local development setup

Requirements: Docker, the Supabase CLI, and Python 3. Local development needs no npm install or build step. The production artifact is generated with `scripts/build-production.py`. This baseline review used Supabase CLI v2.2.1; the CLI reports v3.3.0 is available. The project does not pin a CLI version yet, so select and document a supported version before future migration work.

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

3. Generate ignored local Edge Function secrets from the owner-only test-account file:

   ```sh
   python3 scripts/provision-local-pin-function.py
   ```

   It writes `supabase/functions/.env` with mode `0600`. The file contains a keyed PIN verifier, random peppers, and the pre-provisioned local Auth credentials. It is ignored by Git and must never be copied to production.

4. In one terminal, serve the PIN function locally:

   ```sh
   supabase functions serve farm-pin-login --env-file supabase/functions/.env
   ```

5. In another terminal, serve the frontend:

   ```sh
   python3 scripts/local-dev-server.py
   ```

   Open [http://localhost:8001](http://localhost:8001). The shared local development PIN is `246810` by default and can be set when generating the ignored function environment with `DAIRY_FARM_LOCAL_PIN`. For a phone on the same trusted Wi-Fi, run `python3 scripts/local-dev-server.py --lan` and use `http://<laptop-LAN-IP>:8001`. Local mode is selected by source configuration, not hostname or query parameters. Use LAN mode only on a trusted network.

6. Stop the web server with Ctrl+C. Stop only this local Supabase project with:

   ```sh
   supabase stop
   ```

### Local PIN authentication

The PIN is not a production credential and does not authorize database requests by itself. The local Supabase Edge Function verifies its HMAC PIN verifier, applies the database-backed attempt limiter, and signs in the pre-provisioned local Auth identity. The browser installs the returned genuine Supabase session; the SDK persists and refreshes it. The test identity has `app_metadata.farm_access = true`; only the provisioning script and Edge Function use local administrative credentials. Browser code receives no service-role or secret key.

The local test account, PIN verifier, peppers, and credential file are development-only. The production Edge Function and Auth identity have not been deployed or configured. Do not use local secrets or the local function as production security.

## Environment separation and production output

The development source config explicitly selects the local Docker project. The hostname is used only to address the local helper/API from a phone on the LAN. A hostname or query string cannot select the production/local environment. The production builder generates a separate `dist/js/supabase-config.js` from `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` supplied to the build process.

Build a production-shaped artifact using placeholder values for local inspection:

```sh
SUPABASE_URL=https://dairy-farm-build-test.invalid \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_build_test_only \
python3 scripts/build-production.py
```

For a real Pages build, set those two values in the selected Cloudflare Pages environment. They are public browser configuration; never supply a secret/service-role key. The generated build currently sets `productionAuthConfigured: false`. It has no Supabase client session and sends no Supabase API requests; the app displays that production sign-in is unavailable until the next authentication phase. Do not deploy this locked build as an active farm application.

The Cloudflare Pages output directory is `dist/`. It contains only the generated `index.html`, `_headers`, stylesheet, required application scripts (including the shared PIN form handler), and cow image. The local PIN controls/helper, local config, sample data, provisioning scripts, Supabase config/seed/migrations, and all other development files are excluded by the build allowlist. Production authentication remains locked (`productionAuthConfigured: false`); the build uses only the Python standard library and does not contact Supabase.

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

`20261124000500_backup_restore.sql` is present in the repository, and its restore function, helper, and executor role exist in the local database. The local Supabase migration history reports `00500` pending even though its policies already exist; `supabase migration up --local` previously failed on a duplicate restore policy. The approved PIN limiter migration `20261125000100_pin_login_attempt_limit.sql` was applied directly to the local database in a transaction and is also absent from CLI migration history. Do not reset or blindly replay these migrations. Phase 3.3 browser verification covered backup creation and restore; the local migration ledger still needs a reviewed, non-destructive reconciliation before relying on it for later local migration work.

`supabase/seed.sql` is local-only development data. It is configured for local Supabase startup/reset and must never be used to populate a hosted farm. Avoid `supabase db reset` when you need to preserve local records; reset rebuilds the local database and reruns migrations and seed data.

## Production status

This project is not production-ready. The hosted project has not been linked, contacted, or modified. Local PIN verification now runs through an Edge Function, but production function deployment, shared Auth identity setup, secrets, Pages origin allowlisting, migration-history reconciliation, and a staging-enabled production build remain outstanding. The generated artifact currently locks data access. See [PRODUCTION_RELEASE_CHECKLIST.md](PRODUCTION_RELEASE_CHECKLIST.md) and [supabase/ARCHITECTURE.md](supabase/ARCHITECTURE.md).

The development browser config contains only the local URL/key. Production URL/key values are added only to the generated output at build time. Publishable keys are public identifiers, not secret credentials; no service-role or Supabase secret key belongs in frontend files. Production farm CRUD is not enabled.
