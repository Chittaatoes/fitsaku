/* Spotify integration — OAuth Authorization Code with PKCE, and the few Web API calls REPO makes.
 *
 * The browser never holds a Spotify token. It asks this module (through /api/spotify/*) to act,
 * and gets back account names, playlists and playback state only. Tokens live in
 * DATA_DIR/spotify-<uid>.json (mode 0600), apart from the workout state and the user database.
 * There is no client secret: PKCE is the flow for a client that cannot keep one.
 *
 * A factory like coach/routes.js, taking the server's own helpers, so it stays testable against
 * fakes. Nothing in here logs: a token, a code or an Authorization header in a log line is the
 * leak this module exists to avoid, and errors carry a class and a status, never a body.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';
import { platformVault } from './spotify-vault.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';

// Why each scope is asked for. Playlist browsing needs the two playlist-read scopes only; the
// playback ones are for the controls; user-read-private is what tells us whether the account is
// Premium, so the app can say so instead of failing at the first Play.
export const SCOPES = [
  'playlist-read-private',        // list the user's private playlists
  'playlist-read-collaborative',  // …and the collaborative ones they belong to
  'user-read-playback-state',     // current track, devices
  'user-modify-playback-state',   // play, pause, next, previous, choose a device
  'user-read-private',            // subscription level (Premium is needed to control playback)
];

const PENDING_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10000;
const SKEW_MS = 60 * 1000;          // refresh a minute before the token runs out
const b64url = buf => Buffer.from(buf).toString('base64url');

/** A failure the routes turn into a status and a class the app translates. `retryAfter` in seconds. */
export class SpotifyError extends Error {
  constructor(code, status, extra = {}) { super(code); this.code = code; this.status = status; Object.assign(this, extra); }
}

export function createSpotify({ dataDir, env = process.env, fetchImpl, now = Date.now, vault: vaultOpt } = {}) {
  const doFetch = (...a) => (fetchImpl || globalThis.fetch)(...a);
  const clientId = () => String(env.SPOTIFY_CLIENT_ID || '').trim();
  const redirectUri = () => String(env.SPOTIFY_REDIRECT_URI || '').trim();
  const configured = () => !!(clientId() && redirectUri());
  // `vault` protects the file's contents (DPAPI on Windows, see spotify-vault.js); null means plaintext
  // with mode 0600, which only a POSIX filesystem enforces.
  const vault = vaultOpt === undefined ? platformVault() : vaultOpt;

  /* ---- storage: one small file per profile ---- */
  // The file name is a hash of the profile id, never the id itself: no character of it can reach the
  // path (traversal, `..`, drive letters, reserved names), two different ids cannot share a file
  // (including ones that differ only in case, which NTFS treats as the same name), and a non-string
  // or absurd id is refused rather than turned into some other id.
  const keyOf = uid => {
    if (typeof uid !== 'string' || !uid || uid.length > 128) throw new SpotifyError('bad_request', 400);
    return crypto.createHash('sha256').update(uid).digest('hex').slice(0, 32);
  };
  const fileOf = uid => path.join(dataDir, 'spotify-' + keyOf(uid) + '.json');
  // The entropy ties a blob to its own file name: copied over another profile's file it will not open.
  const entropyOf = uid => 'repo-spotify-v1:' + keyOf(uid);
  const storage = () => new SpotifyError('storage', 500);

  const cache = new Map();                         // uid → { sig, rec }: a decrypted record, while the file is unchanged
  const sigOf = file => { const s = fs.statSync(file); return s.mtimeMs + ':' + s.size; };

  function read(uid) {
    const file = fileOf(uid);
    let sig;
    try { sig = sigOf(file); } catch { cache.delete(uid); return null; }
    const hit = cache.get(uid);
    if (hit && hit.sig === sig) return structuredClone(hit.rec);
    let rec = null, plain = false;
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc && doc.enc === 'dpapi') rec = vault ? JSON.parse(vault.unprotect(doc.blob, entropyOf(uid))) : null;
      else if (doc && typeof doc.refresh === 'string') { rec = doc; plain = true; }   // a file from before the vault
    } catch { rec = null; }                        // unreadable, or not ours to open (another Windows user, a swapped blob)
    if (!rec || typeof rec !== 'object') { cache.delete(uid); return null; }
    // Plaintext tokens found where a vault exists are re-wrapped at once.
    if (plain && vault) { try { write(uid, rec); return structuredClone(rec); } catch { /* serve it; the next write retries */ } }
    cache.set(uid, { sig, rec: structuredClone(rec) });
    return rec;
  }
  function write(uid, rec) {
    const file = fileOf(uid);
    try {
      const body = vault ? JSON.stringify({ v: 2, enc: 'dpapi', blob: vault.protect(JSON.stringify(rec), entropyOf(uid)) }) : JSON.stringify(rec);
      atomicWrite(file, body, 0o600);
      cache.set(uid, { sig: sigOf(file), rec: structuredClone(rec) });
    } catch (e) { cache.delete(uid); throw e instanceof SpotifyError ? e : storage(); }
  }
  function drop(uid) {
    cache.delete(uid);
    generation.set(uid, (generation.get(uid) || 0) + 1);       // a refresh already in the air must not bring it back
    const file = fileOf(uid);
    for (const f of [file, file + '.tmp']) { try { fs.unlinkSync(f); } catch { /* nothing stored */ } }
  }
  const generation = new Map();                    // uid → bumped by every drop
  const stale = new Set();                         // profiles whose access token Spotify refused: refresh before the next call

  /* ---- pending authorizations: in memory, short-lived, one per user ---- */
  const pending = new Map();                       // state → { uid, verifier, exp }
  const sweep = () => { for (const [s, p] of pending) if (p.exp <= now()) pending.delete(s); };
  const dropPending = uid => { for (const [s, p] of pending) if (p.uid === uid) pending.delete(s); };

  /** Start a flow: the URL to send the browser to. A newer attempt replaces the user's older one. */
  function begin(uid) {
    if (!configured()) throw new SpotifyError('not_configured', 503);
    keyOf(uid);                                    // an unusable profile id never gets as far as a flow
    sweep(); dropPending(uid);
    const verifier = b64url(crypto.randomBytes(64));                       // 86 chars, within 43–128
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(24));
    pending.set(state, { uid, verifier, exp: now() + PENDING_MS });
    const q = new URLSearchParams({
      response_type: 'code', client_id: clientId(), scope: SCOPES.join(' '), redirect_uri: redirectUri(),
      state, code_challenge_method: 'S256', code_challenge: challenge,
    });
    return { url: AUTH_URL + '?' + q };
  }

  /* ---- HTTP to Spotify, bounded, never throwing its body at the caller ---- */
  async function call(url, init = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try { return await doFetch(url, { ...init, signal: ctl.signal }); }
    catch { throw new SpotifyError('unavailable', 502); }
    finally { clearTimeout(timer); }
  }
  const tokenForm = fields => ({
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...fields }).toString(),
  });
  const jsonOf = async r => { try { return await r.json(); } catch { return null; } };
  const keep = (tok, prev) => ({
    access: tok.access_token,
    refresh: tok.refresh_token || prev?.refresh,   // a refresh may not send a new one: keep the old
    exp: now() + (Number(tok.expires_in) || 3600) * 1000,
    scope: String(tok.scope || prev?.scope || ''),
  });

  /** The callback: validate the state, exchange the code with the stored verifier, store tokens. */
  async function finish(uid, { code, state, error }) {
    if (!configured()) throw new SpotifyError('not_configured', 503);
    keyOf(uid);
    sweep();
    const p = typeof state === 'string' ? pending.get(state) : null;
    if (p) pending.delete(state);                  // single use, whatever happens next
    if (!p || p.uid !== uid) throw new SpotifyError('state', 400);
    if (error) throw new SpotifyError(error === 'access_denied' ? 'denied' : 'failed', 400);
    if (typeof code !== 'string' || !code || code.length > 2048) throw new SpotifyError('failed', 400);
    const r = await call(TOKEN_URL, tokenForm({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: p.verifier,
    }));
    const tok = await jsonOf(r);
    if (!r.ok || !tok?.access_token || !tok?.refresh_token) throw new SpotifyError('exchange', 502);
    const rec = keep(tok);
    write(uid, rec);
    try { await profile(uid); } catch (e) { drop(uid); throw e; }   // no account, no connection
    return status(uid);
  }

  /* ---- tokens ---- */
  const refreshing = new Map();                    // uid → in-flight refresh
  async function freshToken(uid) {
    const rec = read(uid);
    if (!rec?.access) throw new SpotifyError('not_connected', 401);
    if (rec.exp - SKEW_MS > now() && !stale.has(uid)) return rec.access;
    if (!refreshing.has(uid)) {
      refreshing.set(uid, (async () => {
        const gen = generation.get(uid) || 0;
        // A record with no refresh token cannot be renewed: do not send Spotify an empty one.
        if (typeof rec.refresh !== 'string' || !rec.refresh) { drop(uid); throw new SpotifyError('reauth', 401); }
        const r = await call(TOKEN_URL, tokenForm({ grant_type: 'refresh_token', refresh_token: rec.refresh }));
        const tok = await jsonOf(r);
        if (!r.ok || !tok?.access_token) {
          // Revoked or expired for good: forget it, so the status says "not connected".
          if (r.status === 400 || r.status === 401) { drop(uid); throw new SpotifyError('reauth', 401); }
          throw new SpotifyError('unavailable', 502);
        }
        // Disconnected (or reset) while Spotify was answering: writing now would resurrect the tokens.
        if ((generation.get(uid) || 0) !== gen) throw new SpotifyError('not_connected', 401);
        const next = keep(tok, rec);
        write(uid, next);
        stale.delete(uid);
        return next.access;
      })().finally(() => refreshing.delete(uid)));
    }
    return refreshing.get(uid);
  }

  /* ---- rate limiting: a 429 pauses every call for that user until Retry-After ---- */
  const blocked = new Map();                       // uid → timestamp
  const retrySeconds = r => Math.min(3600, Math.max(1, Math.ceil(Number(r.headers?.get?.('retry-after')) || 5)));

  /** An authenticated Web API call. Returns the parsed body ({} for 204). */
  async function api(uid, method, route, { query, body } = {}) {
    const wait = (blocked.get(uid) || 0) - now();
    if (wait > 0) throw new SpotifyError('rate_limited', 429, { retryAfter: Math.ceil(wait / 1000) });
    let token = await freshToken(uid);
    for (let attempt = 0; ; attempt++) {
      const url = API_URL + route + (query && Object.keys(query).length ? '?' + new URLSearchParams(query) : '');
      const r = await call(url, {
        method,
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (r.status === 401 && attempt === 0) {      // the token went stale early: force one refresh
        stale.add(uid);
        token = await freshToken(uid);
        continue;
      }
      if (r.ok) return r.status === 204 ? {} : (await jsonOf(r)) || {};
      const data = await jsonOf(r);
      const reason = String(data?.error?.reason || '');
      if (r.status === 429) {
        const s = retrySeconds(r);
        blocked.set(uid, now() + s * 1000);
        throw new SpotifyError('rate_limited', 429, { retryAfter: s });
      }
      if (r.status === 401) { drop(uid); throw new SpotifyError('reauth', 401); }
      if (r.status === 403) throw new SpotifyError(reason === 'PREMIUM_REQUIRED' ? 'premium' : 'forbidden', 403);
      if (r.status === 404) throw new SpotifyError(reason === 'NO_ACTIVE_DEVICE' || /device/i.test(String(data?.error?.message || '')) ? 'no_device' : 'not_found', 404);
      throw new SpotifyError(r.status >= 500 ? 'unavailable' : 'failed', r.status >= 500 ? 502 : 400);
    }
  }

  /* ---- what the app is allowed to see ---- */
  async function profile(uid) {
    const me = await api(uid, 'GET', '/me');
    const rec = read(uid);
    if (!rec) throw new SpotifyError('not_connected', 401);
    rec.profile = {
      name: String(me.display_name || me.id || '').slice(0, 80),
      product: typeof me.product === 'string' ? me.product : null,   // 'premium' | 'free' | …
    };
    write(uid, rec);
    return rec.profile;
  }

  function status(uid) {
    const rec = read(uid);
    const connected = !!rec?.refresh;
    return {
      configured: configured(),
      connected,
      ...(connected ? {
        account: rec.profile || null,
        scopes: rec.scope ? rec.scope.split(' ') : [],
        missingScopes: SCOPES.filter(s => !String(rec.scope || '').split(' ').includes(s)),
      } : {}),
    };
  }

  const image = list => (Array.isArray(list) && list.length ? list[Math.min(1, list.length - 1)]?.url || null : null);

  async function playlists(uid, { offset = 0, limit = 20 } = {}) {
    const o = Math.max(0, Math.min(100000, Math.floor(Number(offset)) || 0));
    const l = Math.max(1, Math.min(50, Math.floor(Number(limit)) || 20));
    const page = await api(uid, 'GET', '/me/playlists', { query: { offset: o, limit: l } });
    const items = (Array.isArray(page.items) ? page.items : []).filter(p => p && p.id).map(p => ({
      id: String(p.id), uri: String(p.uri || ''), name: String(p.name || ''),
      image: image(p.images), owner: p.owner?.display_name || null,
      url: p.external_urls?.spotify || null,
      tracks: Number.isFinite(p.items?.total) ? p.items.total : Number.isFinite(p.tracks?.total) ? p.tracks.total : null,
    }));
    return { items, total: Number(page.total) || 0, next: page.next ? o + l : null };
  }

  async function player(uid) {
    const p = await api(uid, 'GET', '/me/player');       // 204 → {} when nothing is playing anywhere
    if (!p.device) return { active: false };
    const t = p.item && p.item.type === 'track' ? p.item : null;
    return {
      active: true, playing: !!p.is_playing,
      device: { id: p.device.id || null, name: String(p.device.name || ''), type: String(p.device.type || '') },
      context: typeof p.context?.uri === 'string' ? p.context.uri : null,
      track: t ? {
        name: String(t.name || ''), artists: (t.artists || []).map(a => String(a.name || '')).filter(Boolean),
        image: image(t.album?.images), url: t.external_urls?.spotify || null,
      } : null,
    };
  }

  async function devices(uid) {
    const d = await api(uid, 'GET', '/me/player/devices');
    return (Array.isArray(d.devices) ? d.devices : []).filter(x => x && x.id).map(x => ({
      id: String(x.id), name: String(x.name || ''), type: String(x.type || ''), active: !!x.is_active,
      restricted: !!x.is_restricted,
    }));
  }

  const URI_RE = /^spotify:(playlist|album|artist):[A-Za-z0-9]{1,64}$/;
  const ID_RE = /^[A-Za-z0-9]{1,64}$/;
  function play(uid, { context_uri, device_id } = {}) {
    if (context_uri != null && !URI_RE.test(String(context_uri))) throw new SpotifyError('bad_request', 400);
    if (device_id != null && !ID_RE.test(String(device_id))) throw new SpotifyError('bad_request', 400);
    return api(uid, 'PUT', '/me/player/play', {
      ...(device_id ? { query: { device_id } } : {}),
      ...(context_uri ? { body: { context_uri } } : {}),
    });
  }
  const pause = uid => api(uid, 'PUT', '/me/player/pause');
  const next = uid => api(uid, 'POST', '/me/player/next');
  const previous = uid => api(uid, 'POST', '/me/player/previous');
  function transfer(uid, { device_id, play: go } = {}) {
    if (!ID_RE.test(String(device_id))) throw new SpotifyError('bad_request', 400);
    return api(uid, 'PUT', '/me/player', { body: { device_ids: [device_id], play: !!go } });
  }

  function disconnect(uid) { dropPending(uid); blocked.delete(uid); stale.delete(uid); drop(uid); return status(uid); }

  return { configured, begin, finish, status, playlists, player, devices, play, pause, next, previous, transfer, disconnect, forget: disconnect };
}

/* ------------------------------- HTTP surface ------------------------------- */

const HTTP = { not_configured: 503, not_connected: 401 };

export function spotifyRoutes({ json, readBody, readSession, spotify }) {
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    return user;
  };
  // Every failure is a class and a status. The words are English fallbacks only: the app shows its
  // own translated line for the class.
  const fail = (res, e) => {
    // A malformed or oversized body is the server's own 400/413 (HttpError), answered and not logged there.
    if (!(e instanceof SpotifyError)) { if (Number.isInteger(e?.status)) throw e; json(res, 500, { error: 'internal error', code: 'internal' }); return; }
    json(res, e.status || HTTP[e.code] || 500, { error: e.code.replace(/_/g, ' '), code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) },
      e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : undefined);
  };
  const wrap = fn => async (req, res) => {
    const user = guard(req, res); if (!user) return;
    try { json(res, 200, await fn(user, req)); } catch (e) { fail(res, e); }
  };
  const query = req => new URL(req.url, 'http://x').searchParams;

  return {
    'GET /api/spotify/status': wrap(async user => spotify.status(user.id)),
    'POST /api/spotify/connect': wrap(async user => spotify.begin(user.id)),
    'POST /api/spotify/callback': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      try {
        const b = await readBody(req);
        json(res, 200, await spotify.finish(user.id, { code: b?.code, state: b?.state, error: b?.error }));
      } catch (e) { fail(res, e); }
    },
    'POST /api/spotify/disconnect': wrap(async user => spotify.disconnect(user.id)),
    'GET /api/spotify/playlists': wrap(async (user, req) => {
      const q = query(req); return spotify.playlists(user.id, { offset: q.get('offset'), limit: q.get('limit') });
    }),
    'GET /api/spotify/player': wrap(async user => spotify.player(user.id)),
    'GET /api/spotify/devices': wrap(async user => ({ devices: await spotify.devices(user.id) })),
    'POST /api/spotify/player/play': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      try { const b = await readBody(req); await spotify.play(user.id, b || {}); json(res, 200, { ok: true }); } catch (e) { fail(res, e); }
    },
    'POST /api/spotify/player/pause': wrap(async user => { await spotify.pause(user.id); return { ok: true }; }),
    'POST /api/spotify/player/next': wrap(async user => { await spotify.next(user.id); return { ok: true }; }),
    'POST /api/spotify/player/previous': wrap(async user => { await spotify.previous(user.id); return { ok: true }; }),
    'POST /api/spotify/player/transfer': async (req, res) => {
      const user = guard(req, res); if (!user) return;
      try { const b = await readBody(req); await spotify.transfer(user.id, b || {}); json(res, 200, { ok: true }); } catch (e) { fail(res, e); }
    },
  };
}
