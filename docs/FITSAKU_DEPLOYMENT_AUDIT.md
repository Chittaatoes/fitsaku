# FitSaku deployment audit

Audit of the repository as found (openGym 1.4.2 base), done by reading the files, plus what was
changed because of it. Line numbers are of the tree at the time of writing.

## 0. Repository state

- The checkout is **not a Git repository** (`git status` fails: no `.git`), there is no `origin`, and
  GitHub CLI (`gh`) is not installed. Nothing could be renamed on GitHub and no history exists to
  preserve or rewrite. See "Repository identity" in `FITSAKU_REBRAND_REPORT.md` for the manual steps.
- Unrelated user work was not touched. Changes are limited to the files listed in the rebrand report.

## 1. Frameworks, start and build

| Part | What it is | Start / build |
|---|---|---|
| Frontend `frontend/` | React 19 + Vite SPA, `HashRouter` (`src/App.jsx:386`), Zustand store, PWA (`public/manifest.json`, `public/sw.js`), Capacitor shells | `npm run dev` (proxies `/api` to :3000), `npm run build` -> `dist/` |
| API `api/` | Plain `node:http`, no framework (`server.js`, route table `routes['METHOD /path']`), deps: `@simplewebauthn/server`, `web-push`, `undici` (+ `pg` added) | `node server.js`; `PORT`, now also `HOST` |
| MCP `mcp/` | Optional read-only stdio bridge reading `DATA_DIR` files | spawned by an LLM client; not deployed |
| Web `web/` | nginx image: serves the build and proxies `/api` so the app is one origin | Docker only (self-hosting) |

## 2. Where data is read and written (before this work)

All durable data was files under `DATA_DIR` (default `/data`):

| File | Content | Code |
|---|---|---|
| `db.json` (+`.bak`) | users, passkey credentials (public key, counter), push subscriptions, invites, device links | `server.js` `loadDb`/`saveDb` |
| `state-<uid>.json` | one document per profile: settings, routines, workouts and completed sets, weigh-ins, plans | `readState*`, `PUT /api/data` |
| `secret` | session HMAC key (also keys Coach encryption) | `server.js` |
| `vapid.json` | Web Push keys | `server.js` |
| `audit.log` | JSONL sign-in/admin events | `audit()` |
| `coach.json`, `coach/<uid>.json`, `coach-auth/` | AI Coach instance config (provider, encrypted key), per-profile caps/proposals/history, provider credential cache | `api/coach/*` |
| `uploads/<uid>/...` | photos/videos of custom exercises and workouts | `api/media.js` |
| `spotify-<uid>.json` | Spotify tokens (DPAPI/ACL hardened on Windows) | `api/spotify*.js` |

Writes are atomic and fsynced (`durable.js`). Everything is synchronous in one process.

## 3. Sync, revisions, concurrency

`PUT /api/data` (`server.js`, "Conditional write"): the document carries `_rev` (server-owned
counter) and `_wid`/`_wids` (write id lineage). A client quoting `baseRev`/`baseWid` that does not
match the stored document gets **409 with the current document** and merges (`frontend/src/lib/sync-merge.js`,
`api/sync-stamps.js` stamps removals/edits so merges never resurrect or wipe data). Compare and write
were atomic only because they ran synchronously in one process.

## 4. Authentication

- WebAuthn passkeys (`@simplewebauthn/server`), `RP_ID` and `ORIGIN` from the environment
  (`server.js:43-44`), verified in register/login/verify routes. Optional password login
  (`PASSWORD_LOGIN`) and device link/pairing for the mobile app.
- Session: HMAC-signed token in a cookie `__Host-gymsid` (`Secure; HttpOnly; SameSite=Lax` when `ORIGIN`
  is https) or `Authorization: Bearer` for the paired phone.
- CSRF: a state-changing browser request must carry an `Origin` equal to `ORIGIN` (`csrfOk`).
- CORS: reflects `Origin` but **never** sends `Allow-Credentials` (comment at the top of the request handler).
- Authorisation: the user id always comes from the session, never from the request. Verified by test
  (`api/test/pg-server.test.js`, "a profile cannot read or write another profile").
- Signup policy: `INVITE_ONLY`, `FIRST_USER_ADMIN`, `ADMIN_UIDS`, `ALLOW_GUEST`.

## 5. Local, preview, production

- Local: `docker compose` (nginx + api) or Vite dev server proxying `/api`; `RP_ID=localhost`.
- The frontend calls **relative** `/api/...` (`frontend/src/lib/api.js`); only the Capacitor build uses an
  absolute server URL. So no frontend API-URL variable is needed with a same-origin proxy.

## 6. Can it deploy as static frontend + separate API?

Yes, with a **same-origin `/api` rewrite on Vercel** to the Render service. Reasons:

- Passkeys bind to the site's hostname (`RP_ID`); cookies are `__Host-` (host-only, no `Domain`) and
  `SameSite=Lax`. A separate API origin would need cross-site cookies (`SameSite=None`) plus credentialed
  CORS, which the API deliberately never enables. The rewrite avoids all of it.
- Rewrites to an external origin preserve method, body, status, `Set-Cookie`, and `Origin`.
- Limits (documented in DEPLOYMENT.md): Vercel's proxy timeout is shorter than a Coach job can run;
  the client IP seen by the API comes from `X-Forwarded-For`, so the Render URL must not be used directly
  by clients (`TRUST_PROXY`).

## 7. What was missing for Render + Supabase, and what was done

| Gap | Change |
|---|---|
| Render's disk is ephemeral | `DATABASE_URL` switches durable data to PostgreSQL (`api/pg-store.js`, `api/migrations/001_init.sql`, RLS on every table) |
| Sync server, async DB | Data is loaded into memory at boot; every write is stored before the answer leaves (`json()` waits for `flush()`); profile documents use a compare-and-swap on `rev` |
| Secrets in files | `SESSION_SECRET` / `VAPID_*` from env, else generated once into `app_secrets` |
| Insecure first admin | `FIRST_USER_ADMIN` is ignored with a database; a **one-time `BOOTSTRAP_SECRET`** creates the owner atomically (`claimBootstrap`, `api/server.js`); signup fails closed (`INVITE_ONLY` unless `PUBLIC_SIGNUP=1` **and** an admin exists) |
| TLS only verified if a CA was given | `dbConnectionConfig` (`api/pg-store.js`): CA **required**, chain + host name verified, `sslmode` in the URL, `NODE_TLS_REJECT_UNAUTHORIZED=0` and unknown `DATABASE_TLS` refused, `insecure-local` only for a loopback host outside production; start-up fails with `FATAL: database start-up failed: <variable>` |
| Third-party media in artifacts | `VITE_BUILTIN_MEDIA=0` default in `vercel.json` and `web/Dockerfile`; media stage only with `INCLUDE_EXERCISE_MEDIA=1`; `.dockerignore`/`.gitignore`; dev middleware refuses; `scripts/audit-public-artifacts.mjs` |
| Ephemeral features looked available | uploads and Spotify forced off with a database (opt-in `*_EPHEMERAL_OK`) |
| No readiness probe | `GET /api/health/ready`; `/api/health` is 503 after an instance conflict, and the instance exits 1 |
| No migration from files | `api/scripts/import-files-to-pg.mjs` (dry run, counts, refuses a non-empty DB) |

### Not migrated (still files, so not durable on Render's free disk)
Uploads (`uploads/`), Spotify tokens, the Coach provider credential cache (`coach-auth/`): **disabled by default with a database**, not silently dropped.
Rate-limit counters, WebAuthn challenges and presence are in memory by design.

## 8. Reuse vs reimplement
Reused unchanged: passkey/session/CSRF code, revision and merge logic, `sync-stamps`, the Coach and its proposal flow (state is read through the same `readState`; config and per-profile records persist through `kv_documents`), the nginx stack for self-hosting.

## 9. Single-instance behaviour (inspected, tested)
`pg-store.js` guards the user-database document with a version (optimistic lock). Stale instance + bookkeeping-only change (reminder/nudge dates, subscription pruning) -> takes the other copy; stale instance + real change -> 503, `/api/health` 503, exit status 1 (`api/test/pg-store.test.js`, `api/test/pg-flows.test.js`). A last-pull time is kept in memory only, so reads never conflict.
Render's rolling deploy overlaps the old and new instance briefly: the new one may be refused once and restart. Not safe to scale out: see `DEPLOYMENT.md` "One API instance".

## 10. Risks
1. **Media licence**: excluded from all public artifacts; no permission exists (see `FITSAKU_REBRAND_REPORT.md`).
2. One instance only (above). All profile documents are held in memory.
3. Changing `RP_ID` invalidates every passkey. A lost only-passkey with no password and no second passkey has no in-app recovery.
4. `pg` is a runtime dependency (the project's "two dependencies" preference gives way to a database driver).
5. **Supabase TLS not verified against Supabase**: whether the downloadable CA validates the pooler certificate chain and host name is unknown until step 1.4 of `DEPLOYMENT.md` is run; the app fails closed if not.
6. The Docker `web` image build was **not run** (no Docker here); the Dockerfile rules are checked statically.

## Test evidence (what actually ran, 2026-10-27, Windows 10, Node 24)

| Suite | Command | Result |
|---|---|---|
| API | `cd api && npm test` | 757 pass, 0 fail, 1 skipped (`POSIX file mode is 0600 when there is no vault`, a POSIX-only assertion) |
| PostgreSQL store / import / Coach / TLS / flows | `node --test test/pg-store.test.js test/pg-import.test.js test/pg-coach.test.js test/pg-tls.test.js test/pg-flows.test.js test/pg-server.test.js` | all pass (included in the 757) |
| Frontend | `cd frontend && npx vitest run` | 468 files, 5,809 tests pass, in UTC+7 (machine zone), UTC-7 (`PST8PDT`) and UTC+14 (`Pacific/Kiritimati`) |
| Locales | `check-locales`, `check-source-strings --strict`, PT-BR fingerprint | 19 locales / 2,590 keys in sync; strict check passes; fingerprint unchanged from the reviewed value |
| Build | `npm run build` with and without `VITE_BUILTIN_MEDIA=0` | both build |
| Artifact audit | `node scripts/audit-public-artifacts.mjs --dir frontend/dist` | ok: inputs and `dist` clean (no restricted path, video or hash match) |
| Git readiness | `node scripts/git-readiness.mjs` | ok (no secrets, no credential files, `.gitignore` rules hold); the directory is **not** a Git repository |
| MCP | `cd mcp && npx vitest run` | 94 pass, 1 skipped (Windows), 0 fail |

**Correction to the previous report:** the frontend run labelled `America/Los_Angeles` was not in that zone. In Git Bash on Windows a `TZ` value containing `/` is dropped and Node keeps the machine zone (UTC+7). The zones above were set from PowerShell and their offsets were printed (-420, 420, -840 minutes) before each run.

**MCP failures, triaged (not "pre-existing" by assertion):** there is no original baseline (no Git history, no pristine copy), so that claim cannot be made. Evidence from runs instead:
- 4 failures (`get_week_plan` x3, `list_workouts`) appeared **only in zones east of UTC+6**: the fixture (`frontend/src/lib/demoSeed.js`, line 121) leaves today's session out only while the local hour is below 18, and the pinned 12:00 UTC is 19:00 in UTC+7. They pass in UTC and `PST8PDT`. A timezone-fragile fixture, not a regression of this work. Fixed in the test (pin `TZ=UTC` in `mcp/test/tools.test.js`), assertions unchanged.
- 1 failure (`a permission failure names the file`) cannot be provoked on Windows (`chmod 000` does not stop the owner). It is skipped on Windows with a stated reason, like the existing root-user skip; **not run on POSIX here**.
- 1 unhandled `EPERM ... watch` error failed the whole file: a real defect on Windows (an `fs.watch` error event with no handler would end the MCP process). Handled in `mcp/src/state.js`.

### Not run
- Docker image build and `--docker-image` audit (no Docker installed). Command: `docker build -f web/Dockerfile -t fitsaku-web:local . && node scripts/audit-public-artifacts.mjs --docker-image fitsaku-web:local`.
- Anything against real Supabase, Render, Vercel; the Vercel rewrite and route refresh there (the app uses `HashRouter`, so refresh does not depend on the host).
- MCP permission test on POSIX; the API `POSIX file mode` test.

## Final gate

| Target | Status | Why |
|---|---|---|
| Local development | **GO** | all suites above pass; the file-storage fallback and the PostgreSQL adapter both work |
| Staging deployment | **GO to try**, not yet verified | needs Supabase CA validation (DEPLOYMENT 1.4) and a real deploy; nothing external was touched |
| Public website, registration closed | **NO-GO until staging passes** | code verified; TLS against Supabase, bootstrap on the real domain, domain/DNS and a real two-user isolation check not yet done |
| Public signup | **NO-GO** | deliberately not enabled; opt-in `PUBLIC_SIGNUP=1` only after the owner is verified |
| Use of restricted (Gym visual) media | **BLOCKED** | no licence; excluded from every artifact; do not enable |
| Future commercial use | **BLOCKED** on media (needs a gymvisual.com licence); the code is AGPL (offer the source) | |

Overall public launch: **NO-GO**. Verified locally: first-admin bootstrap, verified-TLS enforcement (live handshakes), user isolation and authorization, authentication and sessions, restricted-media exclusion (static checks and build output). Unverified: anything that needs the real platforms, and the Docker build.
