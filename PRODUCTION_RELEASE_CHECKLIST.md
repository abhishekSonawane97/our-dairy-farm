# Production Release and Staging Checklist

**Status: not ready for hosted staging or production.** This document records the release path after Phase 3.3. No hosted Supabase project or Cloudflare Pages site has been created, linked, changed, or deployed. The first hosted farm database is intended to start empty.

## Current architecture

- Static, mobile-first single-page frontend built with vanilla HTML/CSS/JavaScript and Supabase JS v2.
- Supabase PostgreSQL has five farm tables, RLS, a claim-gated shared farm identity, billing/reset/restore RPCs, and a private PIN attempt limiter.
- Local sign-in uses a local Edge Function and a local-only provisioned Auth identity. Local PIN/test credentials and fixtures are excluded from the generated production artifact.
- `scripts/build-production.py` creates an allowlisted Cloudflare Pages artifact in `dist/` from explicitly supplied project URL and publishable key.
- The production builder hardcodes `productionAuthConfigured: false`; the generated artifact deliberately cannot sign in or query Supabase. A reviewed staging activation mechanism is a blocker before a usable staging Pages build.
- Local Supabase uses Docker. The source tree has no package-managed frontend build or conventional automated test suite.

## Local workflow status

Phase 3.3 was reported browser-verified for shared PIN sign-in, milk sessions and editing, billing/payment entry, cattle edits/status changes, reports, backup, and authenticated restore. Temporary test records were removed and local data counts were reported unchanged. This Phase 4.0 session reran JavaScript syntax checks, Python compile checks, whitespace checks, and the production artifact build; it could not inspect Docker health because access to the Docker socket was denied by the current sandbox.

## Critical blockers before usable hosted staging

- [ ] Resolve the **local migration ledger discrepancy** through a separately reviewed, non-destructive local reconciliation. `00500` restore objects exist although its ledger entry is absent; the `00600` PIN limiter migration was also applied directly and is absent from the ledger. Do not reset, replay blindly, or mutate the ledger until the live objects and SQL are compared and backed up.
- [ ] Provision one hosted shared Auth identity and trusted `app_metadata.farm_access = true` using an approved admin-only setup path. No production credential/provisioning workflow is currently in the repository.
- [ ] Configure hosted Edge Function secrets and exact allowed Pages origin. Keep the service-role credential function-side only.
- [ ] Deploy and verify `farm-pin-login` on a clean staging Supabase project.
- [ ] Decide and implement an explicit fail-closed staging build activation mechanism. Today the builder always disables production auth, so do not deploy its artifact for family use.
- [ ] Configure a separate Cloudflare Pages staging project/environment and verify the artifact actually uses the staging Supabase URL/key.
- [ ] Verify clean migration application, RLS, Edge Function login, all workflows, headers, mobile access, printing, backup/restore, and empty initial farm setup in staging.
- [ ] Pin the Supabase CLI version after validating the chosen release version against the migrations.

## Migration files and safe deployment order

The repository contains these migrations in timestamp order:

1. `supabase/migrations/20261124000100_core_schema.sql` — five core tables, constraints, indexes, and relationships.
2. `supabase/migrations/20261124000200_security_and_bootstrap.sql` — grants, RLS, trusted-claim helper, and initial farm initializer.
3. `supabase/migrations/20261124000300_billing_cycle_reset.sql` — authorized cycle reset.
4. `supabase/migrations/20261124000400_billing_reset_duplicate_retry.sql` — reset retry correction.
5. `supabase/migrations/20261124000500_backup_restore.sql` — constrained restore executor and authenticated restore RPC.
6. `supabase/migrations/20261125000100_pin_login_attempt_limit.sql` — private HMAC-IP attempt store and service-role-only atomic limiter functions.

For a **new, empty staging project**, review all six files in order, then use the CLI dry-run before applying them. The two missing local ledger entries are not evidence that the SQL should be run against the local DB again. The clean hosted staging database has its own empty ledger and should receive the complete committed migration chain once. Never include `supabase/seed.sql` (`--include-seed`) for staging or production.

Staging command sequence, after separate authorization and project creation:

```sh
# From the repository root. Confirm the displayed project ref is the staging ref.
supabase login
supabase link --project-ref <STAGING_PROJECT_REF>
supabase migration list --linked
supabase db push --dry-run --include-all --linked
# Review the dry-run: it must list the six files above and no seed data.
supabase db push --include-all --linked
supabase migration list --linked
```

`--include-all` asks the CLI to include migration files missing from the target history. The migration dry-run is a review step, not proof of SQL correctness; the staging apply must be followed by checks for five tables, constraints, grants, RLS, function ACLs, and absence of anonymous access. Supabase documents `db push --dry-run`, `--include-all`, and history repair separately; repair changes migration tracking only and should be used only after comparing actual schema state ([migration guide](https://supabase.com/docs/guides/deployment/database-migrations), [CLI reference](https://supabase.com/docs/reference/cli/supabase-db-push)).

### Local history investigation plan (not executed here)

1. Record the current `supabase migration list --local` output and local row counts.
2. Create and verify a local database backup before any history change.
3. Compare `00500` and `00600` SQL against `pg_catalog`, policies, roles, private limiter table, function definitions, grants, and RLS flags in the local database.
4. Confirm `00500`'s restore effects and `00600`'s limiter effects are complete and match the checked-in files.
5. If the comparison is exact, propose marking only those two versions as applied with `supabase migration repair --status applied <version> --local`; this updates the ledger and does not replay SQL. Review output, then re-list migrations and verify row counts and objects. Stop if any object differs; do not repair or reapply.

No migration history was changed in this phase. No hosted database was inspected.

## Hosted Supabase staging prerequisites

Create a **separate clean staging project**, distinct from production, in the selected region. Record its project ref, API URL, publishable key, database password location, and owner contacts in the approved secret manager; do not put credentials in Git. Do not use the actual production project for staging.

Before enabling access:

- Disable public sign-ups and confirm the shared farm Auth identity is the only intended identity.
- Provision that user through a trusted Admin API/setup procedure; set trusted `app_metadata.farm_access = true`, confirm email if required, and use a randomly generated Auth password.
- Keep the shared PIN out of code and Pages variables. Generate a keyed HMAC verifier plus independent PIN and rate-limit peppers for staging, and store only the resulting values in Edge Function secrets.
- Set function secrets `FARM_PIN_HASH`, `FARM_PIN_PEPPER`, `FARM_PIN_RATE_PEPPER`, `FARM_AUTH_EMAIL`, `FARM_AUTH_PASSWORD`, and `FARM_PIN_ALLOWED_ORIGINS` to the **staging** values. Do not set `FARM_PIN_ALLOW_LOCAL_ORIGINS` in hosted environments. Supabase injects project runtime variables; the function currently expects legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which must be confirmed available for the selected project/runtime before deployment. Keep all admin credentials in Edge Function secrets/runtime only.
- Ensure `farm-pin-login` is deployed with JWT verification disabled at the gateway (`--no-verify-jwt`) because a user must call it before a JWT exists; the function itself verifies PIN, applies the private limiter, and restricts CORS to the exact Pages origin.
- Verify the `private` schema is not in the Data API exposed schemas; verify no anon/authenticated grants on limiter storage/functions and no secret key in the browser.

Function deployment template (only after staging project approval/configuration):

```sh
supabase functions deploy farm-pin-login --project-ref <STAGING_PROJECT_REF> --no-verify-jwt
supabase secrets set --project-ref <STAGING_PROJECT_REF> --env-file <OWNER_ONLY_STAGING_EDGE_SECRETS_FILE>
```

Create the secrets file outside the repository with owner-only permissions; do not pass secret values on command lines or print them. Confirm the environment file uses the Edge Function variable names above and only the staging origin. Supabase supports function secrets through the Dashboard or `supabase secrets set --env-file` ([Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [function authentication configuration](https://supabase.com/docs/guides/functions/auth)).

After migrations and auth/function setup, initialize the empty farm exactly once using the approved trusted operator flow with a chosen setup date:

```sql
select public.initialize_farm(date '<CHOSEN_SETUP_DATE>');
```

Verify one `farm_settings` row and one inclusive ten-day initial `billing_cycles` row. Do not restore local seed data, sample data, test rows, or backups. The family enters real records after release.

## Cloudflare Pages staging prerequisites

Create a separate Pages project connected to the reviewed Git branch. Do not deploy the repository root as static output. Use the Python build command and output directory below, subject to verifying the Pages build image has a compatible Python 3 runtime:

- Build command: `python3 scripts/build-production.py`
- Build output directory: `dist`
- Build-time public variables: `SUPABASE_URL` (staging project origin) and `SUPABASE_PUBLISHABLE_KEY` (staging publishable key).
- Build-time auth activation: currently unavailable by design; add only after a reviewed staging-only opt-in is implemented and hosted auth is ready. Do not set production to enabled by hostname, query parameter, or a production key being present.
- No service-role, secret key, shared Auth password, PIN, PIN verifier, or pepper in Cloudflare Pages variables or artifact.
- Configure staging Pages HTTPS URL as the exact `FARM_PIN_ALLOWED_ORIGINS` origin, and ensure Supabase Auth URL/site settings match the deployed URL as required.
- Configure and verify `_headers` CSP/connect-src, cache behavior, static asset paths, direct page refresh, mobile layout, and browser printing.
- Inspect the generated `dist/` contents before deployment; confirm no `js/local-auth.js`, test credentials, seed data, local Supabase config, provisioning scripts, backups, source migrations, or secrets.

The current build can be exercised without network access using a reserved `.invalid` URL and fake publishable value. Its output is deliberately auth-disabled and is **not deployable as a working farm application**.

## Initial data and post-deployment verification

The intended first hosted farm starts empty. Do not move any local test data or backup. After the migrations, trusted Auth identity, Edge Function secrets, and Pages staging build are ready, initialize only farm settings and the first cycle. Verify:

- Exactly five farm tables and expected indexes/constraints exist; RLS is enabled/forced as required.
- Anonymous requests cannot read or write any farm table; authenticated without `farm_access` is denied; the shared claim can access only intended operations.
- `initialize_farm` is not callable by anon/authenticated; cycle reset and restore remain claim-gated; limiter functions are service-role-only.
- Correct PIN returns a genuine Supabase Auth session; wrong PIN and repeated attempts are denied; refresh persists sign-in.
- Milk, billing/payments, cattle, reports/printing, backup/restore, refresh, and mobile layouts work end-to-end against staging.
- No production secrets or auth tokens appear in Pages artifact, URLs, console, or logs.
- Database starts with one settings row, one cycle, and zero milk, payment, and cattle rows; totals remain zero until real records are entered.

## Actions requiring separate approval

- Creating the separate hosted staging Supabase project.
- Logging into/linking the CLI to hosted staging and applying the six migrations.
- Creating the shared Auth identity, storing its credentials, configuring Edge Function secrets, and deploying the function.
- Any migration ledger repair to the existing local database.
- Implementing/activating the staging production build configuration.
- Creating/configuring a Cloudflare Pages staging project and deploying the artifact.
- Moving from staging to actual production, including the production Supabase project, domain, secrets, and deployment.
