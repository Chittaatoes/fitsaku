/* The Spotify integration against a faked Spotify: PKCE and state handling, token storage and
   refresh, playlists, playback and the failure classes. No network, no credentials. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSpotify, spotifyRoutes, SpotifyError, SCOPES } from '../spotify.js';

const ENV = { SPOTIFY_CLIENT_ID: 'client-abc', SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:5173/spotify/callback' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-test-'));
const reply = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: k => headers[k.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});

/** A scripted Spotify: `handlers` map "METHOD url-prefix" to a function (init, url) → reply. */
function fake(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url: String(url), init });
    // the longest matching prefix wins, so '/me' does not swallow '/me/playlists'
    const hit = Object.entries(handlers).map(([k, fn]) => [...k.split(' '), fn])
      .filter(([m, prefix]) => m === method && String(url).startsWith(prefix)).sort((a, b) => b[1].length - a[1].length)[0];
    if (hit) return hit[2](init, String(url));
    throw new Error('unexpected ' + method + ' ' + url);
  };
  return { fetchImpl, calls };
}
const TOKEN = 'https://accounts.spotify.com/api/token';
const ok = (extra = {}) => () => reply(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope: SCOPES.join(' '), ...extra });
const ME = () => reply(200, { id: 'u1', display_name: 'Dewi', product: 'premium' });
const form = init => Object.fromEntries(new URLSearchParams(init.body));
const stateOf = url => new URL(url).searchParams.get('state');

function setup(handlers, { env = ENV, now } = {}) {
  const dataDir = tmp();
  const f = fake(handlers);
  // vault: null — plaintext files, portable; the vault has its own tests (spotify-security.test.js)
  const sp = createSpotify({ dataDir, env, fetchImpl: f.fetchImpl, vault: null, ...(now ? { now } : {}) });
  return { sp, dataDir, ...f };
}
async function connect(sp, uid = 'u1', code = 'CODE') {
  const { url } = sp.begin(uid);
  return sp.finish(uid, { code, state: stateOf(url) });
}
const tokenFile = dir => path.join(dir, 'spotify-' + crypto.createHash('sha256').update('u1').digest('hex').slice(0, 32) + '.json');

/* ------------------------------ configuration ------------------------------ */

test('without client id or redirect URI nothing starts and the status says so', () => {
  for (const env of [{}, { SPOTIFY_CLIENT_ID: 'x' }, { SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:1/c' }]) {
    const { sp } = setup({}, { env });
    assert.equal(sp.status('u1').configured, false);
    assert.equal(sp.status('u1').connected, false);
    assert.throws(() => sp.begin('u1'), e => e instanceof SpotifyError && e.code === 'not_configured');
  }
});

/* ------------------------------ authorization ------------------------------ */

test('the authorize URL is PKCE: S256 challenge of the verifier, state, exact redirect, minimal scopes, no secret', async () => {
  let exchange;
  const { sp } = setup({ ['POST ' + TOKEN]: (init) => { exchange = form(init); return ok()(); }, 'GET https://api.spotify.com/v1/me': ME });
  const { url } = sp.begin('u1');
  const q = new URL(url).searchParams;
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), ENV.SPOTIFY_CLIENT_ID);
  assert.equal(q.get('redirect_uri'), ENV.SPOTIFY_REDIRECT_URI);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('scope'), SCOPES.join(' '));
  assert.ok(!q.has('client_secret'));
  assert.ok(!SCOPES.includes('user-read-email'));
  await sp.finish('u1', { code: 'C', state: q.get('state') });
  // the verifier sent to the token endpoint hashes to the challenge sent to authorize
  assert.equal(crypto.createHash('sha256').update(exchange.code_verifier).digest('base64url'), q.get('code_challenge'));
  assert.ok(exchange.code_verifier.length >= 43 && exchange.code_verifier.length <= 128);
  assert.equal(exchange.grant_type, 'authorization_code');
  assert.equal(exchange.redirect_uri, ENV.SPOTIFY_REDIRECT_URI);
  assert.ok(!('client_secret' in exchange));
});

test('a successful callback connects, stores tokens 0600-style on the server, and the status carries none', async () => {
  const { sp, dataDir } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME });
  const st = await connect(sp);
  assert.equal(st.connected, true);
  assert.deepEqual(st.account, { name: 'Dewi', product: 'premium' });
  assert.deepEqual(st.missingScopes, []);
  assert.ok(!/AT1|RT1/.test(JSON.stringify(st)), 'no token in the status');
  const stored = JSON.parse(fs.readFileSync(tokenFile(dataDir), 'utf8'));
  assert.equal(stored.refresh, 'RT1');
  if (process.platform !== 'win32') assert.equal(fs.statSync(tokenFile(dataDir)).mode & 0o777, 0o600);
});

test('a state that was never issued, belongs to someone else, or is used twice is refused', async () => {
  const { sp, calls } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME });
  await assert.rejects(sp.finish('u1', { code: 'C', state: 'nope' }), e => e.code === 'state');
  await assert.rejects(sp.finish('u1', { code: 'C' }), e => e.code === 'state');
  const { url } = sp.begin('u1');
  await assert.rejects(sp.finish('u2', { code: 'C', state: stateOf(url) }), e => e.code === 'state');   // and that burnt it
  await assert.rejects(sp.finish('u1', { code: 'C', state: stateOf(url) }), e => e.code === 'state');
  const again = sp.begin('u1');
  await sp.finish('u1', { code: 'C', state: stateOf(again.url) });
  await assert.rejects(sp.finish('u1', { code: 'C', state: stateOf(again.url) }), e => e.code === 'state');
  assert.equal(calls.filter(c => c.url === TOKEN).length, 1, 'only the one valid callback reached the token endpoint');
});

test('a pending authorization expires after ten minutes', async () => {
  let t = 1_000_000;
  const { sp, calls } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME }, { now: () => t });
  const { url } = sp.begin('u1');
  t += 10 * 60 * 1000 + 1;
  await assert.rejects(sp.finish('u1', { code: 'C', state: stateOf(url) }), e => e.code === 'state');
  assert.equal(calls.length, 0);
});

test('a newer attempt replaces the profile\'s earlier one', async () => {
  const { sp } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME });
  const first = sp.begin('u1');
  sp.begin('u1');
  await assert.rejects(sp.finish('u1', { code: 'C', state: stateOf(first.url) }), e => e.code === 'state');
});

test('the user denying access is its own failure, and burns the state', async () => {
  const { sp } = setup({});
  const { url } = sp.begin('u1');
  await assert.rejects(sp.finish('u1', { state: stateOf(url), error: 'access_denied' }), e => e.code === 'denied' && e.status === 400);
  await assert.rejects(sp.finish('u1', { code: 'C', state: stateOf(url) }), e => e.code === 'state');
  assert.equal(sp.status('u1').connected, false);
});

test('a failed token exchange stores nothing and says so', async () => {
  const { sp, dataDir } = setup({ ['POST ' + TOKEN]: () => reply(400, { error: 'invalid_grant', error_description: 'secret detail' }) });
  await assert.rejects(connect(sp), e => e.code === 'exchange' && !/secret detail/.test(e.message));
  assert.equal(fs.existsSync(tokenFile(dataDir)), false);
  assert.equal(sp.status('u1').connected, false);
});

test('no account profile, no connection: a /me failure after the exchange leaves no tokens behind', async () => {
  const { sp, dataDir } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': () => reply(403, { error: { message: 'user not registered' } }) });
  await assert.rejects(connect(sp), e => e.code === 'forbidden');
  assert.equal(fs.existsSync(tokenFile(dataDir)), false);
});

/* ------------------------------ tokens ------------------------------ */

test('an expired access token is refreshed once with the refresh token, and the new one is used', async () => {
  let t = 1_000_000, refreshes = 0, bearer = [];
  const { sp } = setup({
    ['POST ' + TOKEN]: init => {
      const f = form(init);
      if (f.grant_type === 'refresh_token') { refreshes++; assert.equal(f.refresh_token, 'RT1'); return reply(200, { access_token: 'AT2', expires_in: 3600 }); }
      return ok()();
    },
    'GET https://api.spotify.com/v1/me/playlists': init => { bearer.push(init.headers.Authorization); return reply(200, { items: [], total: 0 }); },
    'GET https://api.spotify.com/v1/me': ME,
  }, { now: () => t });
  await connect(sp);
  t += 3600 * 1000;                                     // the access token has run out
  await Promise.all([sp.playlists('u1'), sp.playlists('u1')]);
  assert.equal(refreshes, 1, 'concurrent calls share one refresh');
  assert.deepEqual(bearer, ['Bearer AT2', 'Bearer AT2']);
  assert.equal(sp.status('u1').connected, true, 'the old refresh token is kept when Spotify sends none');
});

test('a refresh Spotify rejects clears the connection and asks to reconnect', async () => {
  let t = 1_000_000;
  const { sp, dataDir } = setup({
    ['POST ' + TOKEN]: init => form(init).grant_type === 'refresh_token' ? reply(400, { error: 'invalid_grant' }) : ok()(),
    'GET https://api.spotify.com/v1/me': ME,
  }, { now: () => t });
  await connect(sp);
  t += 3600 * 1000;
  await assert.rejects(sp.playlists('u1'), e => e.code === 'reauth' && e.status === 401);
  assert.equal(fs.existsSync(tokenFile(dataDir)), false);
  assert.equal(sp.status('u1').connected, false);
});

test('a refresh that fails on Spotify\'s side keeps the connection', async () => {
  let t = 1_000_000;
  const { sp } = setup({
    ['POST ' + TOKEN]: init => form(init).grant_type === 'refresh_token' ? reply(503) : ok()(),
    'GET https://api.spotify.com/v1/me': ME,
  }, { now: () => t });
  await connect(sp);
  t += 3600 * 1000;
  await assert.rejects(sp.playlists('u1'), e => e.code === 'unavailable');
  assert.equal(sp.status('u1').connected, true);
});

test('a 401 on an unexpired token forces one refresh and retries once', async () => {
  let me = 0;
  const seen = [];
  const { sp } = setup({
    ['POST ' + TOKEN]: init => form(init).grant_type === 'refresh_token' ? reply(200, { access_token: 'AT9', expires_in: 3600 }) : ok()(),
    'GET https://api.spotify.com/v1/me/playlists': init => { seen.push(init.headers.Authorization); return seen.length === 1 ? reply(401, { error: {} }) : reply(200, { items: [], total: 0 }); },
    'GET https://api.spotify.com/v1/me': () => { me++; return ME(); },
  });
  await connect(sp);
  const page = await sp.playlists('u1');
  assert.deepEqual(seen, ['Bearer AT1', 'Bearer AT9']);
  assert.deepEqual(page, { items: [], total: 0, next: null });
});

test('disconnecting deletes the stored tokens and any pending flow', async () => {
  const { sp, dataDir } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME });
  await connect(sp);
  const pendingFlow = sp.begin('u1');
  const st = sp.disconnect('u1');
  assert.equal(st.connected, false);
  assert.equal(fs.existsSync(tokenFile(dataDir)), false);
  await assert.rejects(sp.finish('u1', { code: 'C', state: stateOf(pendingFlow.url) }), e => e.code === 'state');
});

test('no token, code or verifier is written to the console by any path', async () => {
  const logged = [];
  const spies = ['log', 'error', 'warn', 'info', 'debug'].map(k => { const o = console[k]; console[k] = (...a) => logged.push(a.join(' ')); return [k, o]; });
  try {
    const { sp } = setup({ ['POST ' + TOKEN]: init => form(init).grant_type === 'refresh_token' ? reply(400, { error: 'invalid_grant' }) : ok()(), 'GET https://api.spotify.com/v1/me': ME });
    await connect(sp, 'u1', 'SECRETCODE');
    await assert.rejects(sp.finish('u1', { code: 'SECRETCODE', state: 'x' }));
    sp.disconnect('u1');
  } finally { for (const [k, o] of spies) console[k] = o; }
  assert.deepEqual(logged, []);
});

/* ------------------------------ playlists ------------------------------ */

const pl = (n, extra = {}) => ({
  id: 'p' + n, uri: 'spotify:playlist:p' + n, name: 'List ' + n, images: [{ url: 'big' + n }, { url: 'mid' + n }, { url: 'small' + n }],
  owner: { display_name: 'Dewi' }, external_urls: { spotify: 'https://open.spotify.com/playlist/p' + n }, items: { total: n }, ...extra,
});
async function connected(handlers, opts) {
  const s = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME, ...handlers }, opts);
  await connect(s.sp);
  return s;
}

test('playlists are reduced to what the app shows, with pagination as an offset', async () => {
  const { sp, calls } = await connected({
    'GET https://api.spotify.com/v1/me/playlists': (_, url) => reply(200, new URL(url).searchParams.get('offset') === '0'
      ? { items: [pl(1), pl(2)], total: 3, next: 'https://api.spotify.com/v1/me/playlists?offset=2&limit=2' }
      : { items: [pl(3)], total: 3, next: null }),
  });
  const first = await sp.playlists('u1', { offset: 0, limit: 2 });
  assert.equal(first.items.length, 2);
  assert.deepEqual(first.items[0], { id: 'p1', uri: 'spotify:playlist:p1', name: 'List 1', image: 'mid1', owner: 'Dewi', url: 'https://open.spotify.com/playlist/p1', tracks: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.next, 2);
  const last = await sp.playlists('u1', { offset: first.next, limit: 2 });
  assert.equal(last.next, null);
  const q = new URL(calls.filter(c => c.url.includes('/me/playlists')).at(-1).url).searchParams;
  assert.equal(q.get('offset'), '2'); assert.equal(q.get('limit'), '2');
});

test('an empty library, and playlists with no cover, owner, link or count, are fine', async () => {
  const { sp } = await connected({
    'GET https://api.spotify.com/v1/me/playlists': (_, url) => reply(200, url.includes('offset=5')
      ? { items: [], total: 0, next: null }
      : { items: [null, { id: 'x', name: 'Bare' }, { name: 'no id' }], total: 1, next: null }),
  });
  assert.deepEqual((await sp.playlists('u1', { offset: 5 })).items, []);
  const bare = await sp.playlists('u1');
  assert.deepEqual(bare.items, [{ id: 'x', uri: '', name: 'Bare', image: null, owner: null, url: null, tracks: null }]);
});

test('the limit and offset are clamped before they go to Spotify', async () => {
  const { sp, calls } = await connected({ 'GET https://api.spotify.com/v1/me/playlists': () => reply(200, { items: [], total: 0 }) });
  await sp.playlists('u1', { offset: -4, limit: 9999 });
  const q = new URL(calls.at(-1).url).searchParams;
  assert.equal(q.get('limit'), '50'); assert.equal(q.get('offset'), '0');
});

test('a 429 pauses every call for Retry-After without asking Spotify again', async () => {
  let t = 1_000_000, hits = 0;
  const { sp } = await connected({
    'GET https://api.spotify.com/v1/me/playlists': () => { hits++; return reply(429, {}, { 'retry-after': '7' }); },
  }, { now: () => t });
  await assert.rejects(sp.playlists('u1'), e => e.code === 'rate_limited' && e.retryAfter === 7 && e.status === 429);
  t += 3000;
  await assert.rejects(sp.player('u1'), e => e.code === 'rate_limited' && e.retryAfter === 4);
  assert.equal(hits, 1);
});

test('forbidden, unavailable and failed responses become classes, without Spotify\'s text', async () => {
  for (const [status, code] of [[403, 'forbidden'], [500, 'unavailable'], [503, 'unavailable'], [400, 'failed']]) {
    const { sp } = await connected({ 'GET https://api.spotify.com/v1/me/playlists': () => reply(status, { error: { message: 'internal detail' } }) });
    await assert.rejects(sp.playlists('u1'), e => e.code === code && !/internal detail/.test(e.message));
  }
});

test('a network failure is "unavailable", and the connection survives it', async () => {
  const { sp } = await connected({ 'GET https://api.spotify.com/v1/me/playlists': () => { throw new Error('ECONNRESET'); } });
  await assert.rejects(sp.playlists('u1'), e => e.code === 'unavailable');
  assert.equal(sp.status('u1').connected, true);
});

/* ------------------------------ playback ------------------------------ */

test('current playback is read from the device and track Spotify reports', async () => {
  const { sp } = await connected({
    'GET https://api.spotify.com/v1/me/player/devices': () => reply(200, { devices: [{ id: 'd1', name: 'Phone', type: 'Smartphone', is_active: true }, { name: 'no id' }] }),
    'GET https://api.spotify.com/v1/me/player': () => reply(200, {
      is_playing: true, device: { id: 'd1', name: 'Phone', type: 'Smartphone' }, context: { uri: 'spotify:playlist:p1' },
      item: { type: 'track', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'a' }, { url: 'b' }] }, external_urls: { spotify: 'https://open.spotify.com/track/t' } },
    }),
  });
  assert.deepEqual(await sp.player('u1'), {
    active: true, playing: true, device: { id: 'd1', name: 'Phone', type: 'Smartphone' }, context: 'spotify:playlist:p1',
    track: { name: 'Song', artists: ['A', 'B'], image: 'b', url: 'https://open.spotify.com/track/t' },
  });
  assert.deepEqual(await sp.devices('u1'), [{ id: 'd1', name: 'Phone', type: 'Smartphone', active: true, restricted: false }]);
});

test('no playback anywhere (204) is "not active", not an error; an episode shows no track', async () => {
  let body;
  const { sp } = await connected({ 'GET https://api.spotify.com/v1/me/player': () => body ? reply(200, body) : reply(204) });
  assert.deepEqual(await sp.player('u1'), { active: false });
  body = { is_playing: false, device: { id: 'd', name: 'TV', type: 'TV' }, item: { type: 'episode', name: 'Pod' } };
  assert.equal((await sp.player('u1')).track, null);
});

test('play starts a playlist on the chosen device; resume sends no body', async () => {
  const { sp, calls } = await connected({ 'PUT https://api.spotify.com/v1/me/player/play': () => reply(204) });
  await sp.play('u1', { context_uri: 'spotify:playlist:p1', device_id: 'd1' });
  const c = calls.at(-1);
  assert.equal(new URL(c.url).searchParams.get('device_id'), 'd1');
  assert.deepEqual(JSON.parse(c.init.body), { context_uri: 'spotify:playlist:p1' });
  await sp.play('u1', {});
  assert.equal(calls.at(-1).init.body, undefined);
});

test('play, transfer and device inputs are validated before anything is sent', async () => {
  const { sp, calls } = await connected({});
  const n = calls.length;
  for (const bad of [{ context_uri: 'https://evil' }, { context_uri: 'spotify:track:abc' }, { context_uri: 'spotify:playlist:a b' }, { device_id: '../x' }])
    assert.throws(() => sp.play('u1', bad), e => e.code === 'bad_request' && e.status === 400);
  assert.throws(() => sp.transfer('u1', { device_id: '' }), e => e.code === 'bad_request');
  assert.equal(calls.length, n);
});

test('no active device, Premium required and refused permission are told apart', async () => {
  let resp;
  const { sp } = await connected({ 'PUT https://api.spotify.com/v1/me/player/play': () => resp, 'PUT https://api.spotify.com/v1/me/player/pause': () => resp, 'POST https://api.spotify.com/v1/me/player/next': () => resp, 'POST https://api.spotify.com/v1/me/player/previous': () => resp });
  resp = reply(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } });
  await assert.rejects(sp.play('u1', {}), e => e.code === 'no_device' && e.status === 404);
  resp = reply(403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } });
  await assert.rejects(sp.pause('u1'), e => e.code === 'premium' && e.status === 403);
  resp = reply(403, { error: { status: 403, message: 'Insufficient client scope' } });
  await assert.rejects(sp.next('u1'), e => e.code === 'forbidden');
  resp = reply(503);
  await assert.rejects(sp.previous('u1'), e => e.code === 'unavailable');
  resp = reply(204);
  assert.deepEqual(await sp.pause('u1'), {});
});

test('transfer targets one device', async () => {
  const { sp, calls } = await connected({ 'PUT https://api.spotify.com/v1/me/player': () => reply(204) });
  await sp.transfer('u1', { device_id: 'd2', play: true });
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { device_ids: ['d2'], play: true });
});

/* ------------------------------ HTTP surface ------------------------------ */

function surface(sp, user = { id: 'u1' }) {
  const routes = spotifyRoutes({
    json: (res, code, obj, headers) => { res.out = { code, obj, headers }; }, readBody: async req => req.body,
    readSession: () => user, spotify: sp,
  });
  const run = async (key, req = {}) => { const res = {}; await routes[key]({ url: '/x', ...req }, res); return res.out; };
  return { routes, run };
}

test('every route needs a session', async () => {
  const { sp } = setup({});
  const { routes } = spotifyRoutes ? surface(sp, null) : {};
  for (const key of Object.keys(routes)) {
    const res = {}; await routes[key]({ url: '/x', body: {} }, res);
    assert.equal(res.out.code, 401, key);
  }
});

test('routes answer with classes and Retry-After, and never with a token', async () => {
  const { sp } = await connected({
    'GET https://api.spotify.com/v1/me/playlists': () => reply(429, {}, { 'retry-after': '9' }),
    'PUT https://api.spotify.com/v1/me/player/play': () => reply(403, { error: { reason: 'PREMIUM_REQUIRED' } }),
  });
  const { run } = surface(sp);
  const st = await run('GET /api/spotify/status');
  assert.equal(st.code, 200); assert.ok(!/AT1|RT1/.test(JSON.stringify(st)));
  const prem = await run('POST /api/spotify/player/play', { body: { context_uri: 'spotify:playlist:p1' } });
  assert.equal(prem.code, 403); assert.equal(prem.obj.code, 'premium');
  const bad = await run('POST /api/spotify/player/play', { body: { context_uri: 'nope' } });
  assert.equal(bad.code, 400);
  // a 429 blocks the profile, so it comes last
  const lim = await run('GET /api/spotify/playlists', { url: '/api/spotify/playlists?offset=0' });
  assert.equal(lim.code, 429); assert.equal(lim.obj.retryAfter, 9); assert.equal(lim.headers['Retry-After'], '9');
});

test('connect and callback routes drive the flow; unconfigured says 503', async () => {
  const { sp } = setup({ ['POST ' + TOKEN]: ok(), 'GET https://api.spotify.com/v1/me': ME });
  const { run } = surface(sp);
  const c = await run('POST /api/spotify/connect');
  assert.equal(c.code, 200);
  const done = await run('POST /api/spotify/callback', { body: { code: 'C', state: stateOf(c.obj.url) } });
  assert.equal(done.code, 200); assert.equal(done.obj.connected, true);
  const dead = await run('POST /api/spotify/callback', { body: { code: 'C', state: stateOf(c.obj.url) } });
  assert.equal(dead.code, 400); assert.equal(dead.obj.code, 'state');
  assert.equal((await run('POST /api/spotify/disconnect')).obj.connected, false);

  const off = surface(setup({}, { env: {} }).sp);
  const r = await off.run('POST /api/spotify/connect');
  assert.equal(r.code, 503); assert.equal(r.obj.code, 'not_configured');
  assert.equal((await off.run('GET /api/spotify/status')).obj.configured, false);
});
