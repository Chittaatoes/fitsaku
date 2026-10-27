/* Security properties of the Spotify integration: where a profile's credentials may live, who can
   reach them, what is on disk, what leaves the server, and what disconnect and a failed refresh
   remove. Fake tokens and a faked Spotify only; nothing here is a credential. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createSpotify, spotifyRoutes, SCOPES } from '../spotify.js';
import { dpapiVault } from '../spotify-vault.js';

const ENV = { SPOTIFY_CLIENT_ID: 'client-abc', SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:5173/spotify/callback' };
const TOKEN = 'https://accounts.spotify.com/api/token';
const AT = 'SECRET-ACCESS-TOKEN', RT = 'SECRET-REFRESH-TOKEN', CODE = 'SECRET-AUTH-CODE';
const reply = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-sec-'));
const hash = uid => crypto.createHash('sha256').update(uid).digest('hex').slice(0, 32);
const fileFor = (dir, uid) => path.join(dir, 'spotify-' + hash(uid) + '.json');
const stateOf = url => new URL(url).searchParams.get('state');
const form = init => Object.fromEntries(new URLSearchParams(init.body));
const ls = dir => fs.readdirSync(dir).sort();

/** A reversible fake of the vault's contract: bound to its entropy, and the stored text is not the input. */
const fakeVault = {
  kind: 'fake',
  protect: (text, entropy) => Buffer.from(entropy + '|' + text).toString('base64').split('').reverse().join(''),
  unprotect: (blob, entropy) => {
    const x = Buffer.from(String(blob).split('').reverse().join(''), 'base64').toString();
    if (!x.startsWith(entropy + '|')) throw new Error('wrong entropy');
    return x.slice(entropy.length + 1);
  },
};

/** A Spotify that hands every profile its own tokens (named after the code used), and records bearers. */
function world({ vault = null, refreshReply, now } = {}) {
  const root = tmpRoot(); const dir = path.join(root, 'data'); fs.mkdirSync(dir);
  const bearers = []; const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url); calls.push({ url: u, method: init.method || 'GET', init });
    if (u === TOKEN) {
      const f = form(init);
      if (f.grant_type === 'refresh_token') return refreshReply ? refreshReply(f) : reply(200, { access_token: 'NEW-' + f.refresh_token, expires_in: 3600 });
      return reply(200, { access_token: AT + ':' + f.code, refresh_token: RT + ':' + f.code, expires_in: 3600, scope: SCOPES.join(' ') });
    }
    bearers.push(init.headers?.Authorization);
    if (u.endsWith('/v1/me')) return reply(200, { id: 'x', display_name: 'Dewi', product: 'premium' });
    if (u.includes('/me/playlists')) return reply(200, { items: [], total: 0 });
    return reply(204);
  };
  const sp = createSpotify({ dataDir: dir, env: ENV, fetchImpl, vault, ...(now ? { now } : {}) });
  return { sp, dir, root, bearers, calls };
}
async function connect(sp, uid, code = 'c-' + uid) {
  const { url } = sp.begin(uid);
  return sp.finish(uid, { code, state: stateOf(url) });
}

/* ------------------------------ profile ids and paths ------------------------------ */

test('hostile profile ids cannot reach outside the data directory, whatever they contain', async () => {
  const evil = ['../escape', '..\\..\\escape', '/etc/passwd', 'C:\\Windows\\x', '..', '.', 'a/b', 'a\\b', 'a\0b', 'spotify-x.json', 'CON', 'NUL', '%2e%2e%2f', 'a'.repeat(128)];
  const w = world();
  const outside = ls(w.root);
  for (const uid of evil) {
    await connect(w.sp, uid);
    assert.equal(w.sp.status(uid).connected, true, uid);
    w.sp.disconnect(uid);
  }
  assert.deepEqual(ls(w.root), outside, 'nothing was created beside the data directory');
  assert.deepEqual(ls(w.dir), [], 'and disconnect removed everything it made');
  // while connected, every file is a hash name directly inside the data directory
  await connect(w.sp, '../escape');
  for (const f of ls(w.dir)) assert.match(f, /^spotify-[0-9a-f]{32}\.json$/);
  assert.ok(!fs.existsSync(path.join(w.root, 'escape')));
});

test('ids that are not usable ids are refused outright, never turned into another id', () => {
  const w = world();
  for (const bad of ['', null, undefined, 42, {}, ['u1'], 'x'.repeat(129)]) {
    assert.throws(() => w.sp.status(bad), e => e.code === 'bad_request', String(bad));
    assert.throws(() => w.sp.begin(bad), e => e.code === 'bad_request');
    assert.throws(() => w.sp.disconnect(bad), e => e.code === 'bad_request');
  }
  assert.deepEqual(ls(w.dir), []);
});

test('profiles whose ids differ only by case or punctuation get separate credentials', async () => {
  const w = world();
  const ids = ['Ab', 'aB', 'a.b', 'a_b', 'a-b'];
  for (const id of ids) await connect(w.sp, id);
  assert.equal(new Set(ls(w.dir)).size, ids.length, 'one file each, no collapsing');
  w.bearers.length = 0;
  for (const id of ids) {
    // force each through its own stored token
    await w.sp.playlists(id);
  }
  assert.deepEqual(w.bearers, ids.map(id => 'Bearer ' + AT + ':c-' + id), 'each profile used only its own token');
});

/* ------------------------------ isolation ------------------------------ */

test('one profile\'s status, calls and disconnect never touch another\'s', async () => {
  const w = world();
  await connect(w.sp, 'alice'); await connect(w.sp, 'bob');
  w.sp.disconnect('alice');
  assert.equal(w.sp.status('alice').connected, false);
  assert.equal(w.sp.status('bob').connected, true);
  w.bearers.length = 0;
  await w.sp.playlists('bob');
  assert.deepEqual(w.bearers, ['Bearer ' + AT + ':c-bob']);
  await assert.rejects(w.sp.playlists('alice'), e => e.code === 'not_connected');
  assert.deepEqual(ls(w.dir), [path.basename(fileFor(w.dir, 'bob'))]);
});

test('another profile\'s pending sign-in cannot be finished by someone else', async () => {
  const w = world();
  const { url } = w.sp.begin('alice');
  await assert.rejects(w.sp.finish('bob', { code: CODE, state: stateOf(url) }), e => e.code === 'state');
  assert.equal(w.sp.status('bob').connected, false);
  assert.equal(w.calls.filter(c => c.url === TOKEN).length, 0);
});

/* ------------------------------ at rest ------------------------------ */

test('with a vault, the file holds no token and no refresh field in the clear, and survives a restart', async () => {
  const w = world({ vault: fakeVault });
  await connect(w.sp, 'u1');
  const raw = fs.readFileSync(fileFor(w.dir, 'u1'), 'utf8');
  assert.ok(!raw.includes(AT) && !raw.includes(RT) && !/refresh|access/.test(raw), 'nothing readable in the file');
  assert.equal(JSON.parse(raw).enc, 'dpapi');
  // a fresh process (cold cache) opens it again
  const again = createSpotify({ dataDir: w.dir, env: ENV, fetchImpl: async () => reply(200, { items: [], total: 0 }), vault: fakeVault });
  assert.equal(again.status('u1').connected, true);
  assert.equal(again.status('u1').account.name, 'Dewi');
});

test('a blob copied over another profile\'s file does not open, and is not used', async () => {
  const w = world({ vault: fakeVault });
  await connect(w.sp, 'alice'); await connect(w.sp, 'bob');
  fs.copyFileSync(fileFor(w.dir, 'alice'), fileFor(w.dir, 'bob'));
  const cold = createSpotify({ dataDir: w.dir, env: ENV, fetchImpl: w.sp && (async () => { throw new Error('must not be called'); }), vault: fakeVault });
  assert.equal(cold.status('bob').connected, false);
  await assert.rejects(cold.playlists('bob'), e => e.code === 'not_connected');
  assert.equal(cold.status('alice').connected, true);
});

test('a file this process cannot decrypt reads as not connected, and is left alone', async () => {
  const w = world({ vault: fakeVault });
  await connect(w.sp, 'u1');
  const before = fs.readFileSync(fileFor(w.dir, 'u1'));
  const other = createSpotify({ dataDir: w.dir, env: ENV, vault: { ...fakeVault, unprotect: () => { throw new Error('other windows user'); } } });
  assert.equal(other.status('u1').connected, false);
  assert.deepEqual(fs.readFileSync(fileFor(w.dir, 'u1')), before);
});

test('plaintext tokens left by a vault-less run are re-wrapped the first time they are read', async () => {
  const w = world({ vault: null });
  await connect(w.sp, 'u1');
  assert.ok(fs.readFileSync(fileFor(w.dir, 'u1'), 'utf8').includes(RT));
  const wrapped = createSpotify({ dataDir: w.dir, env: ENV, fetchImpl: async () => reply(200, {}), vault: fakeVault });
  assert.equal(wrapped.status('u1').connected, true);
  const raw = fs.readFileSync(fileFor(w.dir, 'u1'), 'utf8');
  assert.ok(!raw.includes(RT) && JSON.parse(raw).enc === 'dpapi');
});

test('if the vault fails, nothing is written and the user is told the connection was not stored', async () => {
  const broken = { kind: 'broken', protect: () => { throw new Error('child said: ' + RT); }, unprotect: () => { throw new Error('x'); } };
  const w = world({ vault: broken });
  await assert.rejects(connect(w.sp, 'u1'), e => e.code === 'storage' && e.status === 500 && !String(e.message + e.stack).includes(RT));
  assert.deepEqual(ls(w.dir), []);
  assert.equal(w.sp.status('u1').connected, false);
});

test('POSIX file mode is 0600 when there is no vault', { skip: process.platform === 'win32' }, async () => {
  const w = world();
  await connect(w.sp, 'u1');
  assert.equal(fs.statSync(fileFor(w.dir, 'u1')).mode & 0o777, 0o600);
});

test('Windows DPAPI: the real vault round-trips, binds to its entropy, and keeps the secret out of the file', { skip: process.platform !== 'win32' }, async () => {
  const v = dpapiVault();
  const blob = v.protect('{"refresh":"' + RT + '"}', 'entropy-a');
  assert.ok(!Buffer.from(blob, 'base64').toString('latin1').includes(RT));
  assert.equal(v.unprotect(blob, 'entropy-a'), '{"refresh":"' + RT + '"}');
  assert.throws(() => v.unprotect(blob, 'entropy-b'), e => e.name === 'VaultError' && !String(e.message).includes(RT));
  assert.equal(v.unprotect(v.protect('Dewi — ünï 🏋', 'e'), 'e'), 'Dewi — ünï 🏋');

  const w = world({ vault: v });            // the real thing, end to end
  await connect(w.sp, 'u1');
  const raw = fs.readFileSync(fileFor(w.dir, 'u1'), 'utf8');
  assert.ok(!raw.includes(AT) && !raw.includes(RT));
  const cold = createSpotify({ dataDir: w.dir, env: ENV, fetchImpl: async () => reply(200, { items: [], total: 0 }), vault: v });
  assert.equal(cold.status('u1').connected, true);
  await cold.playlists('u1');
});

/* ------------------------------ refresh and disconnect ------------------------------ */

test('a rejected refresh clears that profile only', async () => {
  let t = 1_000_000;
  const w = world({ now: () => t, refreshReply: f => (f.refresh_token.endsWith('alice') ? reply(400, { error: 'invalid_grant' }) : reply(200, { access_token: 'NEW', expires_in: 3600 })) });
  await connect(w.sp, 'alice'); await connect(w.sp, 'bob');
  t += 3600 * 1000;
  await assert.rejects(w.sp.playlists('alice'), e => e.code === 'reauth');
  await w.sp.playlists('bob');
  assert.equal(w.sp.status('alice').connected, false);
  assert.equal(w.sp.status('bob').connected, true);
  assert.deepEqual(ls(w.dir), [path.basename(fileFor(w.dir, 'bob'))]);
});

test('disconnecting while a refresh is in flight does not bring the tokens back', async () => {
  let t = 1_000_000, release;
  const gate = new Promise(r => { release = r; });
  const w = world({ now: () => t, refreshReply: () => gate.then(() => reply(200, { access_token: 'LATE', refresh_token: 'LATE-RT', expires_in: 3600 })) });
  await connect(w.sp, 'u1');
  t += 3600 * 1000;
  const pending = w.sp.playlists('u1');            // starts a refresh and waits on the gate
  await new Promise(r => setImmediate(r));
  w.sp.disconnect('u1');
  release();
  await assert.rejects(pending, e => e.code === 'not_connected');
  assert.deepEqual(ls(w.dir), [], 'no file was written after the disconnect');
  assert.equal(w.sp.status('u1').connected, false);
});

test('a stored record with no refresh token is not sent to Spotify as an empty one', async () => {
  let t = 1_000_000;
  const w = world({ now: () => t });
  await connect(w.sp, 'u1');
  const doc = JSON.parse(fs.readFileSync(fileFor(w.dir, 'u1'), 'utf8')); delete doc.refresh; doc.exp = 0;
  fs.writeFileSync(fileFor(w.dir, 'u1'), JSON.stringify(doc));
  const before = w.calls.filter(c => c.url === TOKEN).length;
  await assert.rejects(w.sp.playlists('u1'), e => e.code === 'not_connected' || e.code === 'reauth');
  assert.equal(w.calls.filter(c => c.url === TOKEN).length, before);
});

test('disconnect removes the file and its temporary sibling, is repeatable, and clears the pending flow', async () => {
  const w = world();
  await connect(w.sp, 'u1'); await connect(w.sp, 'u2');
  fs.writeFileSync(fileFor(w.dir, 'u1') + '.tmp', 'leftover');
  const pendingFlow = w.sp.begin('u1');
  w.sp.disconnect('u1'); w.sp.disconnect('u1');
  assert.deepEqual(ls(w.dir), [path.basename(fileFor(w.dir, 'u2'))]);
  await assert.rejects(w.sp.finish('u1', { code: CODE, state: stateOf(pendingFlow.url) }), e => e.code === 'state');
  w.sp.forget('u2');                                // what deleting an account runs
  assert.deepEqual(ls(w.dir), []);
});

/* ------------------------------ nothing secret leaves ------------------------------ */

test('no token, code or verifier appears in any response, error, stack or log line', async () => {
  const logged = [];
  const spies = ['log', 'error', 'warn', 'info', 'debug'].map(k => { const o = console[k]; console[k] = (...a) => logged.push(a.map(String).join(' ')); return [k, o]; });
  const seen = [];
  try {
    const root = tmpRoot(); const dir = path.join(root, 'data'); fs.mkdirSync(dir);
    let mode = 'ok';
    const fetchImpl = async (url, init = {}) => {
      const u = String(url);
      if (u === TOKEN) return form(init).grant_type === 'refresh_token' ? reply(400, { error: 'invalid_grant', error_description: RT + AT }) : reply(200, { access_token: AT, refresh_token: RT, expires_in: 3600, scope: SCOPES.join(' ') });
      if (u.endsWith('/v1/me')) return reply(200, { id: 'x', display_name: 'Dewi', product: 'free' });
      if (mode === 'echo') return reply(403, { error: { message: 'Bearer ' + AT + ' ' + RT, reason: 'PREMIUM_REQUIRED' } });
      if (u.includes('/me/playlists')) return reply(200, { items: [], total: 0 });
      if (u.endsWith('/me/player/devices')) return reply(200, { devices: [] });
      return reply(200, {});
    };
    const sp = createSpotify({ dataDir: dir, env: ENV, fetchImpl, vault: fakeVault });
    const out = {}; const routes = spotifyRoutes({
      json: (res, code, obj, headers) => { res.out = { code, obj, headers }; seen.push(JSON.stringify({ code, obj, headers })); },
      readBody: async req => req.body, readSession: () => ({ id: 'u1' }), spotify: sp });
    const hit = async (key, req = {}) => { const res = {}; try { await routes[key]({ url: '/x', ...req }, res); } catch (e) { seen.push(String(e.message) + e.stack); } return res.out; };

    const c = await hit('POST /api/spotify/connect'); seen.push(JSON.stringify(c));
    const state = stateOf(c.obj.url);
    seen.push(c.obj.url);                          // the authorize URL may carry state and challenge, never the verifier
    await hit('POST /api/spotify/callback', { body: { code: CODE, state } });
    for (const k of ['GET /api/spotify/status', 'GET /api/spotify/playlists', 'GET /api/spotify/player', 'GET /api/spotify/devices',
      'POST /api/spotify/player/pause', 'POST /api/spotify/player/next', 'POST /api/spotify/player/previous'])
      await hit(k);
    await hit('POST /api/spotify/player/play', { body: { context_uri: 'spotify:playlist:abc' } });
    await hit('POST /api/spotify/player/transfer', { body: { device_id: 'd1' } });
    mode = 'echo';                                 // Spotify putting the tokens in its own error text
    for (const k of ['GET /api/spotify/playlists', 'POST /api/spotify/player/pause']) await hit(k);
    await hit('POST /api/spotify/callback', { body: { code: CODE, state: 'bad' } });
    await hit('POST /api/spotify/callback', { body: { error: 'access_denied', state } });
    await hit('POST /api/spotify/disconnect');
    for (const e of [await sp.finish('u1', { code: CODE, state: 'nope' }).catch(e => e)]) seen.push(String(e.message) + e.stack);
  } finally { for (const [k, o] of spies) console[k] = o; }
  const everything = seen.join('\n') + '\n' + logged.join('\n');
  for (const secret of [AT, RT, CODE]) assert.ok(!everything.includes(secret), 'leaked ' + secret.slice(0, 10) + '…');
  assert.ok(!/code_verifier/i.test(everything));
  assert.deepEqual(logged, []);
  assert.ok(seen.length > 10, 'the responses were actually collected');
});

test('what is persisted and what the status route returns never includes the access token', async () => {
  const w = world({ vault: null });
  const st = await connect(w.sp, 'u1');
  assert.ok(!JSON.stringify(st).includes(AT) && !JSON.stringify(st).includes(RT));
  assert.deepEqual(Object.keys(st).sort(), ['account', 'configured', 'connected', 'missingScopes', 'scopes']);
});
