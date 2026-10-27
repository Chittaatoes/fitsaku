# FitSaku rebrand report

## Principle

Only the **product name users read** was changed. Technical identifiers that existing data, exports, builds or
native apps depend on were left alone, so nothing already written by an openGym install is orphaned.
No global search-and-replace: a script replaced the name token only where it is a standalone word (not part of
a path, file name, identifier or version-tagged artifact), skipped lines about the upstream project, its
GitHub address, its licence and its media, and the locale packs were replaced with the same rule so the English
source string and its 19 translation keys stay identical (`check-locales`, `check-source-strings --strict` pass).

## Changed

- **Browser/PWA:** `index.html` title, description, Apple web-app title; `public/manifest.json` (name, short name,
  description); `public/sw.js` (notification default title); Capacitor `appName`; `frontend/package.json` name.
- **Icons:** `public/icon-180.png`, `icon-512.png` replaced with new artwork (accent tile with a dumbbell) made for
  this fork. The previous icons were not kept.
- **UI (frontend/src):** about box, login/onboarding, settings, sheets, error screens, share pages and cards,
  FIT export device name, backup README text, empty states; ~1,800 replacements across 83 files, in all 19
  locale packs. Tests that assert visible text were updated with them. Grammar fixed for "a FitSaku".
- **API:** WebAuthn `RP_NAME` default (`FitSaku`, only the display name in the passkey prompt), push notification
  default titles, OpenAPI documents the new readiness route.
- **Deployment/config:** `docker-compose.yml` project name `fitsaku` and local image tags `fitsaku-api:local` /
  `fitsaku-web:local` (the compose file no longer pulls upstream's registry images; build with `--build`),
  `.env.example` (`RP_NAME`, hosted block), new `render.yaml`, `frontend/vercel.json`.
- **Documentation:** `README.md` starts with the fork statement; `NOTICE.md` has an appended FitSaku section
  (nothing above it edited); new `docs/DEPLOYMENT.md`, `docs/FITSAKU_DEPLOYMENT_AUDIT.md`, this report.
- **Settings > About:** states "FitSaku is a modified fork of openGym by Duarte Santos (AGPL-3.0-or-later). Not the
  official project", and links the source (`VITE_SOURCE_URL`, defaults to upstream until the fork has an address).

## Deliberately NOT changed (and why)

| Kept | Why |
|---|---|
| `AUTO_BACKUP_DIR = 'openGym'` (`Documents/openGym`) | where existing automatic backups live; renaming would hide them from "Import" and the retention rule |
| `opengym-backup.json`, `opengym-state.json`, `opengym-remote.json`, `opengym-stash.json`, `opengym-media/`, `opengym-health.json`, `opengym-workout.fit`, `opengym_plan` marker, `opengym-pack://` | file names, import/export markers and URL schemes: renaming breaks restoring upstream exports and on-device data |
| Service-worker cache names `opengym-rt-*`, `opengym-device`, `opengym-media-v1`, `/opengym-device-id` | existing caches/device ids |
| Android `ch.duartesantos.opengym`, iOS `OpenGymWidgets`, Kotlin package paths | application identifiers; changing them makes a different app and breaks update/signing |
| WebAuthn `RP_ID`, cookie names (`gymsid`), localStorage keys (`gym_state_v1`, ...), DB keys | auth and sync contracts |
| `LICENSE`, upstream copyright and attribution in `NOTICE.md`, `CLA.md` | legal text |
| Release artifact names (`openGym-1.4.2.apk`, ...) in docs/CI | upstream's released files |
| `website/`, `helm/`, `kubernetes/`, `contrib/nix`, `.github`, `.gitlab*`, `docs/*` self-hosting guides, `CHANGELOG.md`, `catalogue/` text, `mcp/`, native projects, Coach prompt files | not yet rebranded (see below) |

### Remaining occurrences (counted, not hidden)

About 6,400 case-insensitive matches of `openGym` remain in the tree: 4,323 in `catalogue/` (upstream contribution
docs and exercise data), 390 in `frontend/src` (all technical identifiers, upstream-fact lines, comments and tests
of the above), 235 in `website/`, 183 in `frontend/ios`, 150 in `contrib/`, 150 in the locale packs (URLs, paths,
file names), 117 in `docs/NIX.md`, plus CI, helm, kubernetes, Android and the self-hosting docs. The static project
website, Nix/Helm/Kubernetes packaging, CI publishing workflows and the self-hosting guides still describe the upstream
product. They are not part of the hosted FitSaku app; rebrand them when FitSaku is published as its own project.
Coach prompt files and the MCP server (`opengym-mcp`) also still use the old name internally.

## Repository identity

- This checkout has **no `.git` directory** and no remote, and `gh` is not installed. Nothing on GitHub was renamed and no
  history was touched.
- Manual steps once you have your own repository (never the upstream one):
  1. On GitHub: your fork > Settings > Repository name > `fitsaku`.
  2. Locally: `git remote set-url origin https://github.com/<you>/fitsaku.git`.
  3. Keep the upstream as `git remote add upstream https://github.com/DuarteSantos8/openGym.git`; do not rewrite history.
  4. Set `VITE_SOURCE_URL` on Vercel to the new repository URL (AGPL section 13).

## Licence verification (Phase 3)

| Category | Source and licence | FitSaku public use |
|---|---|---|
| Application source | openGym, AGPL-3.0-or-later (`LICENSE`, `NOTICE.md`) | Allowed as a fork under AGPL: keep notices, offer the modified source to network users, do not claim to be upstream. |
| Exercise stills and animations (`catalogue/media`) | **Gym visual (Aliaksandr Makatserchyk), licensed to openGym; not AGPL.** `NOTICE.md` and `catalogue/media/NOTICE.md`: "strictly for use within the openGym application", third parties have no rights to reuse; a non-commercial fork may keep unmodified 180 px media with the notice; **a commercial fork or any other use needs its own licence** | **Not established.** Rebranding to FitSaku and a public service is not "within the openGym application", and the commercial status is undecided. **Excluded from every public artifact** (`VITE_BUILTIN_MEDIA=0`; the Docker `web` image builds the media stage only with `INCLUDE_EXERCISE_MEDIA=1`; `.dockerignore` and `.gitignore` exclude the files; `scripts/audit-public-artifacts.mjs` fails if any is present). Blocker until written permission from gymvisual.com. |
| Exercise text (names, muscles, instructions) | 1,324 entries from ExerciseDB v1 via hasaneyldrm/exercises-dataset (MIT, notice kept); the rest written for openGym (AGPL) | Allowed with the MIT notice retained (already in `NOTICE.md`). |
| Muscle-map geometry (`body-paths.js`) | MuscleMap by Melih Colpan, MIT | Allowed with the notice retained. |
| Fonts | none shipped; system font stack (`index.css`) | n/a |
| In-app icons | inline SVG paths in `Icon.jsx`, part of the AGPL code | Allowed under AGPL. |
| Logos / app icon | upstream icon replaced by new original artwork for FitSaku | Allowed (own work). |
| Spotify / Hevy integrations | third-party services' own terms, disabled unless configured | Leave unconfigured for the public launch. |

Evidence is the text of `NOTICE.md` and `catalogue/media/NOTICE.md` in this checkout; I did not contact any licensor.
When media is off: Library/search/detail views show the neutral tile, the workout view closes the media card, the
background prefetch requests nothing, all catalogue data and tracking work (`src/branding.test.js`).

## Tests of this phase

`src/branding.test.js` (metadata, preserved identifiers, media-off build), full frontend suite, locale checks:
see the final report.
