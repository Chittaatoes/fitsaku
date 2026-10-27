# Deploying FitSaku (Vercel + Render + Supabase)

**Status: NOT deployed. Nothing here has been run against Supabase, Render or Vercel.** The code paths were
tested locally against a real PostgreSQL engine (PGlite) and a TLS front for it; section "Verification status" says
exactly what ran. The public launch status is **NO-GO** until the items under "Go / No-Go" are done.

Architecture: **Vercel** serves the static frontend and proxies `/api/*` to **Render** (one Node API instance), which keeps
all durable data in **Supabase PostgreSQL**. The browser talks to one origin (`https://fitsaku.my.id`, planned,
**not purchased or confirmed available**), which is what passkeys and the `__Host-` cookie need (reasons: `FITSAKU_DEPLOYMENT_AUDIT.md`).
Dashboard wording changes: trust the dashboards over this file for button names, hostnames and DNS records.

## Environment variables

| Name | Purpose | Owner | Public/Secret | Dev | Production |
|---|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL connection, Supabase **Session pooler** string. Must **not** contain `sslmode`/`ssl*` parameters (refused) | Render | **Secret** | optional (files if unset) | required |
| `DATABASE_SSL_CA` | Supabase CA certificate, PEM text (several certificates allowed). **Required**: the server certificate chain and host name are always verified | Render | public certificate | - | **required** |
| `DATABASE_SSL_CA_FILE` | path to the same PEM, alternative to `DATABASE_SSL_CA` | Render | - | - | optional |
| `REQUIRE_DATABASE` | `1` = refuse to start without `DATABASE_URL` (no silent fall-back to files). On Render (`RENDER=true`) this is the default unless `ALLOW_FILE_STORAGE=1` | Render | public | unset | `1` (in `render.yaml`) |
| `DATABASE_TLS` | unset or `verify-full`. `insecure-local` skips TLS **only** for a loopback host outside production (refused when `NODE_ENV=production` or on Render) | local only | public | local tests | **never set** |
| `DATABASE_POOL_MAX` | pool size (default 5) | Render | public | - | optional |
| `SESSION_SECRET` | signs session cookies; keep stable. Else generated once into the database | Render | **Secret** | - | set (Blueprint generates) |
| `BOOTSTRAP_SECRET` | one-time owner bootstrap, 32 to 40 letters/digits (`openssl rand -hex 16`) | Render | **Secret** | - | set for the bootstrap, then **remove** |
| `PHONE_LOGIN` | `1` adds sign-up/sign-in with a phone number and a 4-digit PIN (`/api/register/phone`, `/api/login/phone`, `/api/account/pin`). See "Phone number + PIN" below | Render | public | - | `1` |
| `PHONE_DEFAULT_COUNTRY` | calling code a number starting with `0` is read in | Render | public | - | `62` |
| `INVITE_ONLY` | explicit invite-only | Render | public | - | `1` |
| `PUBLIC_SIGNUP` | `1` allows open registration, **only** when an administrator exists and `INVITE_ONLY` is not set. A database deployment is invite-only otherwise | Render | public | - | unset until go-live |
| `FIRST_USER_ADMIN` | **ignored** with a database (use `BOOTSTRAP_SECRET`); file self-hosting unchanged | - | - | - | never |
| `RP_ID`, `ORIGIN` | passkey relying party and exact site origin | Render | public | `localhost`, `http://localhost:8080` | `fitsaku.my.id`, `https://fitsaku.my.id` |
| `TRUST_PROXY` | client IP from `X-Forwarded-For` | Render | public | - | `1` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push keys; else generated into the database | Render | private key **Secret** | - | optional |
| `MEDIA_UPLOADS` | `0` = no photo/video upload. **Forced off with a database** unless `MEDIA_UPLOADS_EPHEMERAL_OK=1` | Render | public | - | `0` |
| `MEDIA_UPLOADS_EPHEMERAL_OK`, `SPOTIFY_EPHEMERAL_OK` | accept that uploads / Spotify tokens live on a disk Render does not keep | Render | public | - | **never** |
| `PORT`, `HOST` | `PORT` from Render; `HOST` defaults to `0.0.0.0` with a database | Render | public | - | automatic |
| `VITE_BUILTIN_MEDIA` | `0` = build without third-party exercise media (default in `vercel.json` and in `web/Dockerfile`) | Vercel | public (baked in) | - | `0` |
| `VITE_SOURCE_URL` | where the source of this build is offered (AGPL section 13); configurable until the repository exists | Vercel | public | - | your repository URL |

The frontend needs **no API URL variable** (relative `/api/...`, forwarded by the rewrite). Supabase owns no application variable.
Never put a database URL, password, CA private material or secret in a Vercel variable or in Git.

## Ordered checklist

### 1. Supabase and its CA certificate
1. Create a project; pick the region near Render's. Free-plan pausing and quotas: check the current terms.
2. **Connect > Session pooler** (Render has no IPv6 route to the direct host; the long-lived pool does not fit the Transaction
   pooler). Copy the string from the dashboard; put your database password in it; **delete any `?sslmode=...`** from it.
3. **CA certificate:** Project Settings > Database > **SSL Configuration** > download the certificate. Keep the file (it is a public
   certificate, not a secret) and paste its PEM into `DATABASE_SSL_CA` on Render. Optionally turn on "Enforce SSL on incoming connections" there.
4. **Validate before deploying** (from your machine; this prints no secrets):
   ```bash
   cd api && npm ci
   DATABASE_URL='<session pooler string>' DATABASE_SSL_CA="$(cat supabase-ca.pem)" node scripts/check-db-tls.mjs
   # expect: tls: verify-full ... connected: ok=1 ... encrypted=true
   openssl s_client -starttls postgres -connect <pooler-host>:5432 -servername <pooler-host> -CAfile supabase-ca.pem -verify_return_error </dev/null | grep "Verify return code"
   # expect: Verify return code: 0 (ok)
   ```
   **Not verified by me:** that the downloaded CA validates the *pooler's* certificate chain and host name. If step 4 fails, the app refuses
   to start (it never falls back to unverified TLS). Fix the certificate, or use the connection mode whose certificate the CA covers, per
   Supabase's current "Connecting to your database" and "SSL" documentation.
5. **Rotation:** when Supabase publishes a new root, put the **new and old** certificates together in `DATABASE_SSL_CA` (several PEM blocks are accepted),
   redeploy, run step 4, and remove the old one after the old certificate has expired. An **expired** certificate in the variable stops start-up with
   a clear message (`DATABASE_SSL_CA contains an expired certificate`).

### 2. Migrations and (optional) import of file data
The API applies pending `api/migrations/*.sql` at boot (each in one transaction, recorded in `schema_migrations`). Never edit an applied migration.
Existing file data: dry run first (writes nothing), then apply; the same TLS variables are required:
```bash
DATABASE_URL=... DATABASE_SSL_CA="$(cat supabase-ca.pem)" node scripts/import-files-to-pg.mjs --data ./data
DATABASE_URL=... DATABASE_SSL_CA="$(cat supabase-ca.pem)" node scripts/import-files-to-pg.mjs --data ./data --apply --with-secret
```
It refuses a database that already has data unless `--force`, verifies counts afterwards, and never modifies `./data`. Keep a copy of `./data` first.
Rollback: the source is untouched; truncate `app_documents, user_state, audit_events, kv_documents, app_secrets` and unset `DATABASE_URL` to run on files again.

### 3. Render API (one instance)
1. New > Blueprint from the repo (`render.yaml`) or a Web Service with root `api`, build `npm ci --omit=dev --omit=optional`, start `node server.js`, health check `/api/health`.
2. Enter `DATABASE_URL`, `DATABASE_SSL_CA`, `RP_ID`, `ORIGIN`, and `BOOTSTRAP_SECRET` (step 4). Keep `INVITE_ONLY=1`, `MEDIA_UPLOADS=0`. Leave `PUBLIC_SIGNUP` unset.
3. Do **not** use a temporary RP_ID: a passkey is bound to it forever. Do the bootstrap on the final domain (steps 5, 7, 8 first).
4. With `DATABASE_URL` the API never creates or writes `DATA_DIR` (`/data`), so no disk or `DATA_DIR` setting is needed on Render. Without `DATABASE_URL` it stops with `FATAL: DATABASE_URL is not set, but this deployment requires PostgreSQL`.
4. If start-up fails (bad certificate, missing CA, unreachable database) the deploy fails with `FATAL: database start-up failed: <variable name>`; no secret is printed.
5. Health: `GET /api/health` (503 if the database instance conflict was detected), `GET /api/health/ready` (503 when PostgreSQL cannot be reached).

### 4. First administrator: the only safe procedure
Registration is closed to everyone except holders of an invite code. The owner is created with a **one-time bootstrap secret**, never by opening signup.
1. On your own machine: `openssl rand -hex 16` (32 characters, 128 bits). Do not paste it into chat, Git or a ticket.
2. Render dashboard > environment: `BOOTSTRAP_SECRET=<that value>` (secret). `INVITE_ONLY=1` stays. Deploy.
3. On `https://<final domain>`: Create profile > enter your name > in the **Invite code** field type the bootstrap secret > create the passkey.
   The server checks it in constant time, only while the instance has **no** profile and the bootstrap is not spent, and makes that one account owner/admin in the same
   atomic step that creates it. Concurrent attempts yield one owner; a restart, a later attempt, or deleting the owner cannot reopen it (`bootstrap.done` is stored with the account).
4. Verify as the owner: Settings shows the admin area; sign out and in again with the passkey; add a second passkey (device link) so losing a device does not lock you out.
5. Remove `BOOTSTRAP_SECRET` from Render and redeploy (it is already inert; removing it is hygiene).
Wrong or missing secrets are refused (403); the audit log records `auth.register.denied` without the value. Passkey registration is deliberately not throttled by address (a shared address must not pause it), which is safe because the secret has 128 bits; the password-registration path is throttled. At no point is unrestricted signup open.

### 5. Vercel frontend
Import the repo; Root Directory `frontend`; framework Vite; build output `dist` (in `frontend/vercel.json`). Replace `https://fitsaku-api.onrender.com` in `vercel.json` with the **real** Render URL.
Set `VITE_SOURCE_URL`. `VITE_BUILTIN_MEDIA=0` is already in `vercel.json`.

### 6. Verify the preview
The app loads; exercises show neutral tiles; `/api/health` through the site works; run `npm run build && npm run audit:public` (below) before trusting a build.
Passkeys only work on the host that equals the API's `RP_ID`/`ORIGIN`, so test them on the real domain.

### 7. Domain (manual)
`fitsaku.my.id` is not confirmed available or purchased. Add it in Vercel and create exactly the DNS records Vercel displays.

### 8. Production origin and RP_ID
`RP_ID=fitsaku.my.id`, `ORIGIN=https://fitsaku.my.id` on Render **before** the bootstrap. Changing RP_ID later invalidates every passkey.

### 9 to 10. End-to-end and isolation
Register, sign out and in, wrong credentials, two accounts that cannot see each other, sync from two devices (409 then merge), restart Render and confirm history, Coach (if enabled) including rejecting a proposal.

### 11. Exercise media: personal-use mode (owner's decision)
The exercise stills and clips (Gym visual) are licensed to the openGym project; `NOTICE.md` lets a **non-commercial** fork keep them **unmodified, with the notice**.
This deployment keeps them because the owner states it is personal and non-commercial (`MEDIA_PERSONAL_USE.md`, which records the conditions and the risk, including that opening sign-up to anyone weakens the "personal" claim).
- `frontend/vercel.json` builds with `VITE_BUNDLE_MEDIA=1`: `vite build` copies `catalogue/media/still`, `clip` and `NOTICE.md` into `dist/exercise-media/` (about 240 MB, 13,000 files). The files must be in the repository (`.gitignore` no longer excludes them).
- Settings > About shows Gym visual's attribution while the media is on.
- **Vercel limits are unverified:** a 240 MB static output may exceed what your plan accepts. If a deploy fails for size, set `VITE_BUNDLE_MEDIA=0` (placeholders return) or ship only `still/` (48 MB).
- `scripts/audit-public-artifacts.mjs` allows the media only inside `exercise-media/still|clip` and only while `MEDIA_PERSONAL_USE.md` exists; the Docker `web` image still defaults to **no** media (`INCLUDE_EXERCISE_MEDIA=0`).
- To go back to excluding it: delete `MEDIA_PERSONAL_USE.md`, set `VITE_BUNDLE_MEDIA` to `0` (or `VITE_BUILTIN_MEDIA=0`) in `vercel.json`, and re-add `catalogue/media/still/` and `clip/` to `.gitignore`. The audit then enforces it again.
If the use ever becomes commercial or the site is offered as a service, remove the media or obtain a licence from gymvisual.com first.

### 12. Open registration
Only after: owner verified (step 4), restricted media absent (step 11), TLS validated (step 1), staging tests passed, backups understood. Then `PUBLIC_SIGNUP=1` and **remove** `INVITE_ONLY`. It has no effect while no administrator exists. Revert to close it.

## Phone number + PIN sign-in
Enabled with `PHONE_LOGIN=1` (set in `render.yaml`). Sign-up and sign-in take a phone number and a 4-digit PIN; the profile is stored in the database
like any other (`users[].phone` as E.164, `users[].pin` = scrypt hash of the PIN keyed with the server secret, plus the failure counter).
Read this before relying on it:
- **A 4-digit PIN is a weak secret by nature (10,000 values).** Safety comes from limiting guesses: 5 wrong PINs pause the account (5 min, then 15, then an hour, up to 24 h),
  the counter is on the account record so a restart or a Render spin-down does not reset it, and every wrong PIN also counts against the caller's address. Trivial PINs (`0000`, `1234`, ...) are refused.
  Even so, a determined attacker who knows a phone number can still try about 15 PINs a day against that account. Use passkeys for anything that matters.
- **The phone number is not verified.** No SMS is sent (that needs a paid provider); the number is only an identifier. Anyone can register an unused number.
  That is why sign-up stays **invite-only** (`INVITE_ONLY`; a database deployment fails closed). Do not open `PUBLIC_SIGNUP` with phone sign-up on until numbers are verified.
- The PIN is never stored or logged in the clear; a copy of the database alone cannot be searched for the 10,000 PINs because they are keyed with `SESSION_SECRET` first. **Keep `SESSION_SECRET` stable**: changing it makes every PIN stop working.
- There is no PIN reset by SMS. A forgotten PIN needs an administrator (delete the profile, or recover through a passkey); changing a PIN needs the current one (`POST /api/account/pin`).
- A profile created with a phone number has no passkey; adding one later is not offered in this version.

## One API instance (what happens on deploys)
The API keeps data in memory and writes it through to PostgreSQL. Profile documents are compare-and-swap on their revision, so two instances cannot overwrite each other's workouts.
The **user database** (accounts, passkeys, invites) is one document guarded by a version: an instance whose copy is stale and that tries to save a **real** change (a sign-in, an invite, a role) is refused with 503, `/api/health` turns 503, and it **exits with status 1** so the platform restarts it from fresh data.
Bookkeeping-only changes (reminder dates, pruned subscriptions) take the other instance's copy instead.
Render's rolling deploy briefly runs the old and the new instance together: the old one can save a change after the new one loaded, so the new one may answer 503 once and restart (a short blip, no data loss; tested in `api/test/pg-flows.test.js`). To avoid it, deploy at a quiet moment or stop the old instance first.
**Do not scale beyond one instance.** Before ever doing so: per-user compare-and-swap is already safe, but the user database, the in-memory profile cache, rate-limit counters, WebAuthn challenges (`putChallenge`) and presence are per-process and would need a shared store and locking first.

## What is and is not durable (Render's disk is not kept)
Durable in PostgreSQL: accounts, passkey credentials, sessions' signing secret, push subscriptions, profiles and all workout state and completed sets, plans, settings, audit events, Coach configuration and per-profile Coach records.
**Not durable, therefore disabled by default with a database:** photo/video uploads (`MEDIA_UPLOADS` forced off), Spotify tokens (integration absent from `/api/config`), the Coach's provider credential cache (`coach-auth/`: use an API key provider). Nothing is silently discarded: the features are simply not offered.
Rate-limit counters and WebAuthn challenges are in memory and reset on restart (a user retries; no data is lost).

## Free-tier realities
Render free web services spin down when idle (cold start; counters reset). Supabase free: quota and inactivity pause, no point-in-time backups on the free plan (verify current terms): take your own `pg_dump`. Vercel Hobby is for non-commercial use and its rewrite proxy has a time limit that long Coach calls can exceed. No uptime is promised.

## Updating safely
New `api/migrations/00N_*.sql` only (never edit applied ones); deploy to a staging service against a copy first. Roll back code by redeploying the previous commit; migrations are additive and not auto-reverted.

## Git (not a repository yet)
Verify, then initialise locally. Nothing below pushes or creates a remote.
```bash
node scripts/git-readiness.mjs          # secrets, credential files, .gitignore rules (read-only)
git init -b main
git add -A && git status                # read the list: no .env, data/, dist/, catalogue/media/still|clip, *.pem
git commit -m "FitSaku: fork of openGym (AGPL-3.0-or-later)"
# only when YOU have created an empty repository on GitHub:
git remote add origin https://github.com/<you>/fitsaku.git
git remote add upstream https://github.com/DuarteSantos8/openGym.git   # keep attribution; never rewrite history
git push -u origin main
```
Then set `VITE_SOURCE_URL` on Vercel to that repository URL. `LICENSE`, `NOTICE.md` and `catalogue/media/NOTICE.md` are tracked; the media files are not.

## Verification status (what actually ran)
See `FITSAKU_DEPLOYMENT_AUDIT.md`, section "Test evidence".

## Go / No-Go
See `FITSAKU_DEPLOYMENT_AUDIT.md`, section "Final gate".
