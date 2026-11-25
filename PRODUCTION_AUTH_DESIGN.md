# Our Dairy Farm — First-Release Production Authentication

**Status: approved first-release design. The local implementation now uses `farm-pin-login`; it has not been deployed or configured on hosted Supabase.**

## Design summary

Keep the existing Cloudflare Pages frontend, Supabase JavaScript SDK, Supabase Auth, five farm tables, and RLS policies. Add one public-facing Supabase Edge Function, `farm-pin-login`, that checks the shared PIN and then signs in one pre-provisioned farm Auth identity. Both family devices use that same PIN and Auth identity; there are no individual accounts or roles.

The browser receives only an Auth session after a correct PIN. All farm data access continues through the existing `authenticated` role and the trusted `app_metadata.farm_access` claim. Anonymous table access remains denied.

## Simplified authentication flow

1. A family member enters the PIN in the production sign-in dialog. The frontend sends it over HTTPS to `farm-pin-login` using the public publishable key. It is not included in JavaScript source, URL parameters, local storage, or logs.
2. The function checks a small persistent failed-attempt limit. It verifies the submitted PIN against a keyed verifier held in Edge Function secrets.
3. After a correct PIN, the function uses a separate, randomly generated shared Auth password—also held only in Edge Function secrets—to sign in the pre-provisioned farm Auth user through Supabase Auth's normal password flow.
4. The function returns the resulting access and refresh tokens. The browser passes them to the existing Supabase JS client with `auth.setSession()`. This is a genuine Supabase Auth session, not a visual-only unlock. Supabase documents normal password sign-in and server-only Auth user provisioning ([signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword), [admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)).
5. Supabase JS stores and refreshes the session on each device. Existing RLS policies authorize the shared user through signed `app_metadata.farm_access = true`. The publishable key is public; the service-role key stays server-side and is never sent to Cloudflare Pages or the browser.

The login function must accept requests before a user has a JWT, so only this function has gateway JWT verification disabled. It still requires the PIN before returning any Auth session. CORS is limited to the production Pages origin, but is not treated as authentication. Supabase describes this public-function pattern for endpoints that perform their own verification ([Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)).

## Minimum required changes

### Edge Function and secrets

Create one function: `supabase/functions/farm-pin-login/index.ts`.

Configure Edge Function secrets for:

- A PIN verifier and its random pepper. Store a keyed verifier, never the PIN itself.
- The shared Auth user's email and long random password. These are internal credentials, distinct from the family PIN.
- The service-role credential is available only in the Edge Function runtime for the rate-limit RPC. Do not copy it into function responses, frontend files, Pages variables, or logs.

Provision the single Auth user once through a trusted Admin API operation. Set `app_metadata.farm_access = true` through that admin operation, confirm the email if applicable, and disable public sign-ups. Family members do not need the Auth email/password; the function uses them only after PIN verification. Supabase's Admin user creation API is server-only and must never run in the browser.

To set or change the PIN for the first release, an operator generates a new keyed verifier and updates the Edge Function secret. There is no in-app PIN change, recovery flow, or owner role in this release. If the PIN changes, revoke the shared Auth user's refresh sessions through the trusted admin path. Already-issued access JWTs may remain valid until their expiry, so this simple process does not provide immediate stale-token invalidation ([signOut behavior](https://supabase.com/docs/reference/javascript/auth-signout)).

### Basic repeated-attempt protection

Do not keep counters only in Edge Function memory; invocations can run in different instances. Add one small private table keyed by an HMAC of the Supabase gateway client IP, with a failure count, time window, and short cooldown. Use one atomic database function to check/increment the counter and another to clear it after successful login. Keep this schema out of the Supabase Data API; grant the wrapper RPCs to `service_role` only. Do not store raw IP addresses or PIN values.

Start with a simple threshold such as five incorrect attempts from one IP in a 15-minute window, followed by a 15-minute cooldown. Tune it in local testing. Do not add account-wide lockouts, escalating tiers, CAPTCHA, Turnstile, or a separate rate-limiting service in this phase. The gateway IP header must be read from Supabase's trusted request metadata, not from a user-supplied JSON field.

Devices behind the same home internet connection will share this one cooldown bucket; it expires automatically and does not lock out the farm globally.

### Database and RLS

No change is needed to the five farm tables or their current RLS policies. The signed `farm_access` claim is sufficient for this first release. No session-version column or helper is proposed.

The only database addition is the private failed-attempt table and narrowly granted atomic limiter RPCs. The existing `public.has_farm_access()` remains the policy check. The restore helper must continue requiring the same trusted farm claim. `initialize_farm()` remains service-role-only; cycle reset and restore keep their current authorization checks.

## Sessions and limitations

- Each device receives its own Supabase Auth session for the same shared user. Supabase JS persists and refreshes each device's session; ordinary sign-out should clear only that device's session.
- Use the project's normal Auth JWT expiry initially (currently one hour by default); do not add custom session-version infrastructure. Supabase JS handles refresh tokens through its Auth client ([session behavior](https://supabase.com/docs/guides/auth/sessions)).
- If the shared PIN is changed manually, the trusted operator must also revoke Auth refresh sessions. Existing access JWTs can still work until their expiry. This is an accepted first-release limitation; a later security phase can add immediate session-version enforcement if needed.
- A shared PIN gives every family member the same permissions and does not show who made a change. Device-by-device revocation and self-service forgotten-PIN recovery are deferred.
- The Auth user's random password and PIN verifier are secrets in the Edge Function environment. A compromise of the function or its secrets could allow farm access; function logs must redact request bodies and tokens.

## Local and production separation

- Keep `js/local-auth.js`, the local test account, local credentials, and local Supabase configuration limited to development.
- Production builds continue using `scripts/build-production.py` and its explicit production configuration. Do not select local mode from hostnames or query parameters.
- Production output contains no local PIN helper, local test credentials, or seed data. It includes only the public project URL and publishable key plus the shared PIN form handler; production remains locked until `productionAuthConfigured` is enabled after hosted setup.
- The production build must remain locked until the Edge Function, Auth user, and RLS flow pass local validation. Never put the shared Auth password, PIN, verifier pepper, or service-role key in Cloudflare Pages variables intended for browser access.

The source app calls the same `farm-pin-login` function through the isolated local Supabase API. `scripts/provision-local-pin-function.py` generates ignored owner-only local secrets from the existing test account; `scripts/local-dev-server.py` serves static files only and does not validate PINs. The production build excludes local-only connection/sign-out controls and provisioning scripts.

## Files and functions needed during implementation

| Change | Purpose |
| --- | --- |
| Create `supabase/functions/farm-pin-login/index.ts` | Verify PIN, apply the basic attempt limit, sign in the shared Auth identity, and return its session. |
| Create one timestamped migration, e.g. `supabase/migrations/<timestamp>_pin_login_attempt_limit.sql` | Add the private limiter table and service-role-only atomic RPCs. Do not alter the five farm tables. |
| Modify `supabase/config.toml` | Configure the login function's public invocation and keep the private auth schema out of API-exposed schemas. |
| Modify `js/database.js` | Invoke the login function and install its returned session using `auth.setSession()`. |
| Modify `index.html` and `js/app.js` | Add production PIN entry, loading/error states, and fail-closed behavior while preserving existing sections. |
| Modify `scripts/build-production.py` | Enable production Supabase client initialization only when the production auth configuration is ready; continue excluding all local helpers. |
| One-time trusted Auth provisioning | Create the shared Auth identity and set `app_metadata.farm_access = true`; this is not browser code and needs no individual user accounts. |

No milk, billing, cattle, reports, or backup/restore feature needs redesign. Their database requests continue to use the same Supabase client and RLS-protected session.

## Local testing plan

Use an isolated disposable Supabase test project/configuration or a separate local stack; do not reset the existing farm database.

1. Apply the additive limiter migration only to the disposable test database.
2. Provision one test Auth user with the trusted `farm_access` claim and set local-only function secrets.
3. Verify wrong PINs do not create a session; repeated failures from one simulated IP trigger the cooldown; successful PIN entry clears that IP's failures.
4. Verify a correct PIN creates an Auth session, the session persists after refresh, and two browser contexts can sign in with the same PIN.
5. Verify anonymous access remains denied and the signed session can load and use existing RLS-protected farm data.
6. Verify milk entry, billing/payments, cattle, reports, and backup still work locally; do not insert test farm records into the existing local database.
7. Inspect the generated production artifact for the local PIN module, test credentials, seed data, and service-role material. Confirm production does not fall back to local mode.

## Genuine blockers and deferred items

- The local migration-history discrepancy remains: CLI history reports `20261124000500_backup_restore.sql` pending although its restore objects exist locally. Local `migration up` fails on a duplicate policy. The PIN limiter migration was applied directly to local Postgres but is not recorded in CLI migration history. Resolve this safely before building the hosted migration sequence; do not reset the existing local database.
- The local shared Auth user is provisioned and PIN sign-in was verified against local Supabase. Hosted Auth identity and production Edge Function secrets are not provisioned; no hosted project was contacted.
- Local genuine Auth sessions, anonymous denial, trusted-claim access, and rollback-only permitted writes were verified. Production remains untested and disabled.
- PIN rotation is an operator-updated Edge Function secret, not an in-app feature. Lost-PIN recovery, immediate JWT invalidation, account-wide rate limiting, Turnstile, individual identities, and device management remain deferred.

## References

- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)
- [Auth `signInWithPassword`](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Admin `createUser`](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase Auth sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase Auth sign-out](https://supabase.com/docs/reference/javascript/auth-signout)
