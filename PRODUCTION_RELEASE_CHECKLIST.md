# Production release checklist

**Status: blocked for production release.** This checklist records the current project state after the Phase 3.0 release-baseline audit. It does not authorize hosted changes or deployment.

## Current architecture

- Mobile-first static single-page application using vanilla HTML, CSS, and JavaScript.
- Supabase JavaScript SDK v2 loaded by the browser; no frontend framework or build pipeline is currently configured.
- Five-table PostgreSQL schema with RLS and claim-gated data access.
- Local Docker Supabase project `dairy_farm`; local app/PIN helper on port 8001.
- Development seed fixtures are configured in `supabase/config.toml` and are local-only.
- Cloudflare Pages deployment has not been configured or performed.

## Features implemented and working locally

- Milk records with independent morning/evening sessions, one per date/session, totals, filters, and historical comparisons.
- Billing cycles, billing calculations, payments/installments, and claim-gated cycle reset.
- Cattle register with active/inactive status and preserved rows.
- Daily, billing-cycle, monthly, and cattle reports with browser print/PDF output.
- Versioned JSON backup and additive, conflict-aware restore RPC.
- Local PIN helper exchanging the development PIN for the local Supabase Auth test user's session.

Production Auth, hosted CRUD, production backup/restore, hosted migrations, and Cloudflare deployment are not verified or enabled.

## Critical blockers

- [ ] Implement production authentication and session issuance. The local PIN helper is not production auth.
- [ ] Implement centralized PIN rate limiting and secure PIN storage; define PIN rotation, lost-device recovery, and session invalidation.
- [ ] Replace host/query-based local-mode detection with explicit build-time environment configuration that cannot activate local auth in production.
- [ ] Produce an allowlisted deployment artifact that excludes local helpers, local provisioning, and sample fixtures.
- [ ] Resolve whether payments are immutable: the UI is append-only, while current authenticated database grants allow updates.
- [ ] Reconcile local migration state before proceeding: CLI/history records `00500` as pending even though its restore objects exist in the local database.
- [x] Establish the source-controlled release baseline and review its staged contents.
- [ ] Pin and document the Supabase CLI version used for migration operations.

## Production configuration requirements

- [ ] Use the intended hosted Supabase project URL and publishable key per environment. The publishable key is public; never use a secret/service-role key in a browser bundle.
- [ ] Keep separate local, staging, and production configurations. Ensure staging/preview builds cannot point to production accidentally.
- [ ] Store any PIN verifier or privileged credentials only in a server-side secret store, such as Supabase Edge Function secrets.
- [ ] Configure Supabase Auth Site URL, exact redirect allowlist, sign-up policy, email/OTP policy if used, session lifetime, and recovery settings.
- [ ] Configure production CORS/API behavior as needed and verify HTTPS for the application and auth flow.

## Required authentication work

- [ ] Production PIN verifier in a trusted server-side function; do not embed the PIN or its verifier in frontend JavaScript.
- [ ] Rate limiting across devices/IPs with privacy-preserving identifiers and bounded lockouts.
- [ ] Issue a normal Supabase Auth session for the same farm identity on authorized devices.
- [ ] Assign `app_metadata.farm_access` only through trusted administration; validate it in database RLS.
- [ ] Define PIN change, lost-device recovery, refresh-token/session revocation, and stale-session handling.
- [ ] Test invalid PIN, repeated attempts, missing claim, valid claim, expired/revoked sessions, two-device access, and recovery.

## Hosted Supabase migration sequence

No hosted project has been linked or changed. After separate approval:

1. Confirm the target project reference, existing schema, backup, and current migration history.
2. Review and dry-run migrations in timestamp order:
   - `20261124000100_core_schema.sql`
   - `20261124000200_security_and_bootstrap.sql`
   - `20261124000300_billing_cycle_reset.sql`
   - `20261124000400_billing_reset_duplicate_retry.sql`
   - `20261124000500_backup_restore.sql`
3. Apply to an isolated hosted staging project first; inspect role flags, grants, RLS, function owners, function ACLs, and security-definer search paths.
4. For a genuinely new farm with no history to import, initialize once with the chosen setup date and verify the initial inclusive ten-day cycle.
5. For a backup import, restore into the empty migrated schema before initialization. Review restore conflicts and preserve IDs/foreign keys.
6. Compare source/target row counts, UUIDs, cycle boundaries, payment links, and milk/payment/billing totals.
7. Request separate production approval before linking or applying anything to the actual production project.

Never run `supabase/seed.sql` on a hosted project.

## Cloudflare Pages requirements

- [ ] Create a build/output directory with only `index.html`, `css/`, `js/`, and required assets; do not deploy the repository root.
- [ ] Generate the public Supabase URL/publishable-key config explicitly from environment-specific build configuration. Cloudflare build variables do not automatically become browser variables.
- [ ] Configure separate preview/staging and production environments; ensure preview builds cannot use production credentials/project settings.
- [ ] Add `_headers` rules for security headers and deliberate cache behavior. Avoid long caching for HTML/runtime config; fingerprint static assets before immutable caching.
- [ ] Confirm relative static asset paths, hash navigation, refresh behavior, HTTPS/custom domain, Android/mobile layout, and browser printing.
- [ ] Check the deployed artifact contains no local PIN helper, account credentials, seed SQL, local scripts, or backup files.

## Security verification requirements

- [ ] Anonymous requests cannot read or mutate any of the five farm tables.
- [ ] Authenticated requests without `app_metadata.farm_access` cannot read or mutate protected rows.
- [ ] Authenticated requests with the trusted claim have only the intended grants and policy access.
- [ ] `initialize_farm()` remains unavailable to anon/authenticated roles; reset/restore RPC checks and execute grants are verified.
- [ ] No secret/service-role key appears in source maps, browser bundles, Pages variables exposed to the client, or Git history.
- [ ] Inspect production Auth configuration, redirect allowlist, session/revocation behavior, CORS, HTTPS, and response headers.
- [ ] Verify payment mutability decision and restore authorization before release.

## Data migration considerations

- Current local database contains development fixtures and local test activity; treat it as non-production until each row is confirmed as real farm history.
- Generate the backup while writes are paused because the current client reads tables through separate paginated requests.
- Preserve UUIDs, timestamps, payment-to-cycle foreign keys, cycle boundaries, and nullable values.
- Choose either `initialize_farm()` for an empty new farm or backup restore for existing history. Do not initialize before restoring a full backup.
- Confirm migration/restore counts and financial aggregates before family access is enabled.
- Keep an untouched source backup and record the restore summary for rollback/reconciliation.

## Local verification notes for this baseline

- Local Supabase database, REST, Auth, and Kong containers were running and healthy during the release-baseline review.
- The local app returned HTTP 200 at `http://127.0.0.1:8001/`.
- The authenticated browser displayed 8 milk records, 4 cycles, 6 payments, and 1 cattle record; overview totals and report preview rendered.
- Browser backup creation succeeded and reported 20 rows across the five data groups.
- Local CLI migration history records `00100`–`00400` as applied and `00500` as pending, while `restore_farm_backup(jsonb)`, its helper, and the executor role exist in the database. Restore execution was not tested.
- The installed Supabase CLI is v2.2.1 and reports v3.3.0 as available; the repository does not pin a CLI version.
- No farm writes, restores, or deletions were performed in this verification. Milk form inspection opened an existing record for editing and was canceled without saving.
