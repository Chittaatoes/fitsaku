# Spotify integration

REPO can connect to a profile's own Spotify account to pick a workout playlist and control playback
on a Spotify device the user already has open. It is optional and off until the server is given a
client ID. REPO never plays audio itself: it opens music in Spotify or sends play, pause, next,
previous and "use this device" to Spotify's Web API, which acts on the user's own Spotify Connect
player. There is no embedded player and no Web Playback SDK in this version.

## How it works

```
REPO UI  →  REPO API (api/spotify.js)  →  accounts.spotify.com / api.spotify.com
```

- **Authorization Code flow with PKCE.** There is no client secret anywhere, and the deprecated
  implicit grant is not used. `POST /api/spotify/connect` makes a 64-byte verifier, its SHA-256
  (S256) challenge and a random state, keeps the verifier and state **in server memory for ten
  minutes** (one per profile, single use), and returns the Spotify URL.
- **The callback.** Spotify redirects the browser to `SPOTIFY_REDIRECT_URI`. At boot the app
  (`lib/spotify.js`) moves `code`/`state` out of the address bar into `sessionStorage`, rewrites the
  address to `#/spotify/callback`, and posts them once to `POST /api/spotify/callback`. The server
  checks the state (known, unexpired, unused, issued to *this* profile), exchanges the code with the
  stored verifier, reads the account (`/me`), and only then reports connected.
- **Tokens stay on the server.** Access and refresh tokens are written to
  `DATA_DIR/spotify-<hash>.json`, where `<hash>` is 32 hex characters of the SHA-256 of the profile id
  (never the id itself), separate from `db.json` and the workout state. They are never sent to the
  browser, never put in the workout state or settings, never logged. `data/` and `.env` are
  git-ignored. The access token is refreshed a minute before it expires, one refresh at a time per
  profile; a refresh Spotify rejects clears that profile's tokens and the app asks the user to
  reconnect. Disconnect (and deleting the account) deletes the file and any `.tmp` sibling.
- **File names and isolation.** Because the name is a hash, no character of a profile id reaches the
  path (no traversal, drive letters or reserved names), two ids can never share a file, and ids that
  differ only by case (which NTFS treats as one name) stay apart. An id that is not a non-empty
  string of at most 128 characters is refused rather than turned into some other id.
- **At rest on Windows: DPAPI.** Checked on this machine: Node's `0600` does **not** restrict an NTFS
  file. A new file simply inherits its folder's access list, and under `E:\Claude\REPO` that list
  includes `Authenticated Users: Modify` and `Users: Read` (`icacls` output in the audit), so any
  local account could have read a plaintext token file placed in `data\`. On Windows the file
  therefore holds a **DPAPI blob** (`ProtectedData`, `CurrentUser` scope) instead of tokens, made by
  `api/spotify-vault.js` through the PowerShell that ships with Windows (`api/dpapi.ps1`): no new
  dependency, the secret goes over stdin and never on a command line, and the file's own name is
  mixed in as entropy so a blob copied over another profile's file does not open. Windows Credential
  Manager was considered and rejected: it needs either a native module or `cmdkey`, which can store
  but not read back a secret.
- **Limits of that storage.** DPAPI keeps out other Windows users and anyone who copies the file or
  the disk; it does **not** keep out other processes running as *your* Windows user (malware in your
  session can decrypt). Each protect or unprotect starts PowerShell (about 250 ms here, run
  synchronously), so the decrypted record is cached in memory and the disk is touched on a write
  (connect, hourly refresh, profile update) or a cold read after a restart. If the vault fails,
  nothing is stored and the user is told the connection could not be stored securely; the app never
  falls back to plaintext on Windows. A file that cannot be opened (another Windows user, a swapped
  blob, corruption) reads as "not connected" and is left alone. A plaintext file from a run without
  a vault is re-wrapped the first time it is read.
- **Data folder warning (Windows).** DPAPI protects the Spotify file, but the rest of `data` (session secret, `db.json`, Coach credentials) relies on the folder's access list. At start the API checks it and prints one warning, with the `icacls` command that restricts it to you, if Everyone, Users or Authenticated Users can use it (for example a data folder on a non-system drive such as `E:`). It changes nothing by itself.
- **At rest elsewhere (Linux, macOS, Docker).** There is no vault: the file is plaintext JSON with
  mode `0600`, which a POSIX filesystem does enforce, so protection is the data volume's
  permissions, as for the rest of `data/` (including the session secret). Anyone who can read the
  volume can use a refresh token until the user revokes REPO at
  <https://www.spotify.com/account/apps/>. Pending sign-ins live in memory only, so restarting the
  API mid-flow invalidates them (press Connect again).
- **What the browser keeps.** Only the chosen playlist (`id`, `uri`, `name`, `image`, `url`) in the
  normal settings (`S.spotifyPlaylist`). Connection status is always read from `/api/spotify/status`.
- Spotify needs a signed-in REPO profile (the server holds the tokens per profile). Guest mode, which
  never talks to the server, shows a "sign in" note instead.

### Scopes, and why

| Scope | Used for |
|---|---|
| `playlist-read-private` | list the user's private playlists |
| `playlist-read-collaborative` | …and collaborative ones they belong to |
| `user-read-playback-state` | current track, playback device, device list |
| `user-modify-playback-state` | play, pause, next, previous, choose a device |
| `user-read-private` | whether the account is Premium, to explain it instead of failing at Play |

No playlist-write, library or email scopes are requested. Playlists are read from
`GET /v1/me/playlists` (the non-deprecated endpoint); track lists are not fetched or stored.

### Failure classes

The API answers with a `code` and the app shows its own translated sentence: `not_configured`,
`denied`, `state`, `exchange`, `reauth`, `premium`, `forbidden`, `no_device`, `rate_limited` (with
`retryAfter` seconds; a 429 pauses all of that profile's Spotify calls until then),
`unavailable`. Spotify's own error text is never shown or logged. The music panel polls only while it
is open and the page is visible (every 10 s), and reads the player state back after each command
instead of assuming it worked.

## Setting it up on this repository (Windows, no Docker)

1. **Create a Spotify app** at <https://developer.spotify.com/dashboard> (Create app). Pick *Web API*.
2. **Copy its Client ID** (Settings). You do not need the client secret; do not put it anywhere.
3. **Add the redirect URI** under Settings → Redirect URIs, exactly:
   `http://127.0.0.1:5173/spotify/callback` and save. Spotify's rules: exact match; `localhost` is not
   allowed; plain `http` is allowed only for the loopback IP literals `127.0.0.1` / `[::1]`.
4. **Add yourself to the app's users** (Settings → User Management) with the email of your Spotify
   account. In Development Mode a user who is not listed gets a 403.
5. **Configure the API.** Copy `.env.example` to `.env` in the repo root and set:
   ```
   SPOTIFY_CLIENT_ID=<your client id>
   SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/spotify/callback
   PASSWORD_LOGIN=1
   ```
   `PASSWORD_LOGIN=1` matters here: Spotify forces you to browse REPO at `127.0.0.1`, and browsers
   refuse passkeys on an IP address (WebAuthn needs a domain name), so on this address you sign in
   with a name and password. The API reads real environment variables only (it has no `.env`
   loader); start it with Node 22's loader. Leave `RP_ID` and `ORIGIN` at their defaults: the Vite
   dev proxy already presents the origin the API expects.
   ```bash
   cd api && npm install
   DATA_DIR=../data node --env-file=../.env server.js
   ```
   PowerShell: `$env:DATA_DIR='..\data'; node --env-file=..\.env server.js`. With Docker Compose the
   same variables in `.env` reach the API.
6. **Start the frontend:** `cd frontend && npm install && npm run dev -- --host 127.0.0.1 --port 5173`.
   Vite proxies `/api` to `127.0.0.1:3000`; set `API_TARGET` if your API listens elsewhere.
7. **Open REPO at `http://127.0.0.1:5173`**, not `localhost`, and create a profile with a password
   (Settings → Account → *Create profile with a password*). A session made on `localhost` is a
   different cookie jar and does not follow Spotify's redirect to `127.0.0.1`.
8. **Connect:** Profile → Spotify → *Connect Spotify*, approve on Spotify's page; you land on
   Profile with your account name shown.
9. **Playlists and playback:** Profile → *Choose a playlist*. In a workout, open the Music row,
   start Spotify on a phone or computer, then *Play this playlist* (or *Choose a device*). Playback is
   never started by REPO on its own.
10. **Disconnect:** Profile → *Disconnect Spotify*. the profile's `data\spotify-<hash>.json` is deleted;
    verify with `dir data\spotify-*` (only other profiles' files remain). Revoke access on Spotify's side too if you want it gone there.

## Troubleshooting

- **"Not set up on this server yet"** — `SPOTIFY_CLIENT_ID` or `SPOTIFY_REDIRECT_URI` is empty in the
  API's environment (restart the API after changing it).
- **Spotify shows `INVALID_CLIENT: Invalid redirect URI`** — the URI in `.env` and in the dashboard
  differ by even a character (port, path, trailing slash, `localhost` vs `127.0.0.1`).
- **"That Spotify sign-in expired or was already used"** — more than ten minutes passed, the API was
  restarted, the Back button replayed the callback, or the tab was signed in as another profile.
- **403 / "may not be allowed for this app"** — your Spotify account is not in the app's allowlist
  (see Development Mode below), or a scope was not granted (the card offers *Reconnect Spotify*).
- **"Controlling playback needs Spotify Premium"** — Spotify's playback endpoints require Premium
  for the account being controlled. Browsing playlists and opening links still work.
- **"No Spotify device is active"** — Spotify only controls a device that is open. Start the Spotify
  app, play something for a second, then use *Choose a device*.
- **429 / "limiting requests"** — REPO waits for Spotify's `Retry-After` before asking again. Development
  Mode quotas are small; see below.

## Development Mode, and anything beyond local use

Checked against Spotify's quota-modes page: apps start in *Development Mode*, where the app **owner
must have Premium**, **up to 5 authenticated users** may use it, **each must be added to the allowlist**
(others get 403), and endpoints share quota buckets that return 429 when exceeded. Spotify says these
limits are subject to change and describes a "February 2026 Dev Mode Changes" migration guide —
re-read <https://developer.spotify.com/documentation/web-api/concepts/quota-modes> before relying on
any number here. Extended quota is, per that page, only for organizations.

This is a **local development setup.** Letting other people use it (a public deployment, an app
store build, anything commercial) needs a separate review of Spotify's current Developer Terms,
brand guidelines, quota/approval requirements and what the app is allowed to do with Spotify
content. Nothing here has been submitted to or approved by Spotify.

- The loopback redirect only works in a browser on the **same machine** as the server. It will not
  work from a phone on your Wi-Fi opening `http://192.168.x.x:5173`, and Spotify rejects non-loopback
  `http` redirects. Other devices need an **HTTPS** redirect URI registered in the dashboard, served
  by a real hostname (reverse proxy), plus a matching `SPOTIFY_REDIRECT_URI`.
- Behind the bundled nginx, an unknown path such as `/spotify/callback` is redirected to the app root
  with its query; the app accepts that return only in a tab that just pressed *Connect*.
- The native Capacitor apps are not covered: their redirect and API origin differ.
- Brand: the card names Spotify in text only. Before any release, add Spotify's official logo and
  attribution per <https://developer.spotify.com/documentation/design> (logos must not be redrawn).

## Verification status

See the "Spotify" section of `REPO_REDESIGN_AUDIT.md` for what was executed. Real OAuth against
Spotify and real playback require your credentials and a Premium device and were **NOT TESTED** by
the automated suite; the suite uses mocked Spotify responses only.
