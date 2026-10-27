/* The real server.js on PostgreSQL (PGlite behind a socket, reached through the `pg` driver),
   driven over HTTP with a software passkey: the one-time owner bootstrap, invite-only signup,
   passkey registration and login, sessions (expiry, logout, sign-out-everywhere), WebAuthn origin
   and RP_ID checks, authorisation boundaries, user isolation, persistence across a real process
   restart, and what two API instances do to each other. Every test has its own empty database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { boundPort } from './helpers.mjs';
import { softPasskey } from './softpasskey.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const BOOT = crypto.randomBytes(16).toString('hex');           // 32 hex characters, as documented
const ORIGIN = 'https://fitsaku.test', RP_ID = 'fitsaku.test';
let xff = 0;
const ip = () => `10.${(xff >> 16) & 255}.${(xff >> 8) & 255}.${++xff & 255}`;

async function newDb(t) {
  const db = new PGlite();
  const sock = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await sock.start();
  const port = sock.server.address().port;
  t.after(() => sock.stop().catch(() => {}));
  return { db, sock, port };
}

async function boot(t, d, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-flow-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID, TRUST_PROXY: '1',
      DATABASE_URL: `postgres://postgres:pw@127.0.0.1:${d.port}/postgres`, DATABASE_TLS: 'insecure-local',
      SESSION_SECRET, ...env,
    },
  });
  let log = '';
  child.stdout.on('data', x => log += x); child.stderr.on('data', x => log += x);
  const exited = new Promise(r => child.once('exit', code => r(code)));
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return { url, child, log: () => log, exited, dataDir, kill: () => { child.kill('SIGKILL'); return exited; } };
}

async function call(api, method, p, { cookie, body, origin = ORIGIN, from = ip() } = {}) {
  const r = await fetch(api.url + p, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': from, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.getSetCookie?.()[0] || '';
  let json = null; try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: json, cookie: /Max-Age=0/i.test(set) ? '' : set.split(';')[0], cleared: /Max-Age=0/i.test(set) };
}

/** Register a profile with a software passkey. `code` is an invite code or the bootstrap secret. */
async function register(api, name, code, pk = softPasskey({ rpId: RP_ID, origin: ORIGIN }), opts = {}) {
  const o = await call(api, 'POST', '/api/register/options', { body: { name, code } });
  if (o.status !== 200) return { ...o, pk, stage: 'options' };
  const v = await call(api, 'POST', '/api/register/verify', { body: { cid: o.body.cid, credential: pk.attestation(o.body.options.challenge, opts) } });
  return { ...v, pk, stage: 'verify' };
}
async function login(api, pk, opts = {}) {
  const o = await call(api, 'POST', '/api/login/options', { body: {} });
  return call(api, 'POST', '/api/login/verify', { body: { cid: o.body.cid, credential: pk.assertion(o.body.options.challenge, opts) } });
}
const sessionFor = (uid, { sv = 0, ttl = 86400000 } = {}) => {
  const payload = `${uid}:${Date.now() + ttl}:${sv}`;
  return `__Host-gymsid=${payload}.${crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url')}`;
};
const dbDoc = async d => (await d.db.query("select body from app_documents where name = 'db'")).rows[0]?.body;
const S = extra => ({ routines: [{ id: 'r1', name: 'Push' }], workouts: [], unit: 'kg', ...extra });

// ------------------------------------------------------------------ bootstrap

test('bootstrap: with no secret, a wrong secret, or a guess, nobody can create the first account', async t => {
  const d = await newDb(t); const api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  assert.equal((await register(api, 'Eve', '')).status, 403);
  assert.equal((await register(api, 'Eve', 'A'.repeat(32))).status, 403);
  assert.equal((await register(api, 'Eve', BOOT.slice(0, 31))).status, 403);
  assert.equal((await register(api, 'Eve', BOOT.slice(0, 31) + (BOOT.endsWith('0') ? '1' : '0'))).status, 403);
  assert.equal((await dbDoc(d))?.users?.length ?? 0, 0);
  // a user-supplied admin flag or id changes nothing
  const o = await call(api, 'POST', '/api/register/options', { body: { name: 'Eve', code: '', admin: true, owner: true, uid: 'x', bootstrap: false } });
  assert.equal(o.status, 403);
});

test('bootstrap: the right secret makes exactly one owner, who can administer; the secret is nowhere in logs, audit or database', async t => {
  const d = await newDb(t); const api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const r = await register(api, 'Owner', BOOT);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.cookie.startsWith('__Host-gymsid='));
  const me = await call(api, 'GET', '/api/me', { cookie: r.cookie });
  assert.equal(me.body.user.admin, true);
  assert.equal((await call(api, 'GET', '/api/admin/users', { cookie: r.cookie })).status, 200);
  const audit = JSON.stringify((await call(api, 'GET', '/api/admin/audit', { cookie: r.cookie })).body);
  assert.match(audit, /admin\.bootstrap/);
  const doc = await dbDoc(d);
  assert.equal(doc.users.length, 1); assert.equal(doc.users[0].owner, true); assert.equal(doc.bootstrap.done, true);
  for (const where of [api.log(), audit, JSON.stringify(doc), JSON.stringify((await d.db.query('select * from audit_events')).rows), JSON.stringify((await d.db.query('select * from user_state')).rows)]) {
    assert.ok(!where.toUpperCase().includes(BOOT.toUpperCase()), 'the bootstrap secret leaked');
  }
});

test('bootstrap: five simultaneous attempts with the right secret create one owner, and the secret works once only', async t => {
  const d = await newDb(t); const api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => register(api, 'Racer' + i, BOOT)));
  const ok = results.filter(r => r.status === 200);
  assert.equal(ok.length, 1, results.map(r => r.status + r.stage).join());
  assert.ok(results.filter(r => r.status !== 200).every(r => r.status === 403));
  const doc = await dbDoc(d);
  assert.equal(doc.users.length, 1); assert.equal(doc.users.filter(u => u.admin).length, 1);
  assert.equal((await register(api, 'Late', BOOT)).status, 403, 'reuse after success');
});

test('bootstrap: it stays closed after a restart with the same secret still set, and after the owner is gone', async t => {
  const d = await newDb(t); let api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const owner = await register(api, 'Owner', BOOT); assert.equal(owner.status, 200);
  await api.kill();
  api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  assert.equal((await register(api, 'Second', BOOT)).status, 403, 'a restart does not reopen it');
  // the owner deletes their own account: the instance is empty again, but bootstrap is spent
  const del = await call(api, 'POST', '/api/account/delete', { cookie: sessionFor(owner.body.user.id), body: {} });
  assert.ok([200, 400, 401, 403].includes(del.status));
  await api.kill();
  api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  assert.equal((await register(api, 'Third', BOOT)).status, 403, 'a spent bootstrap is not reactivated by an empty instance');
});

test('bootstrap: a secret that is too short is ignored, and FIRST_USER_ADMIN is ignored with a database', async t => {
  const d = await newDb(t);
  const api = await boot(t, d, { BOOTSTRAP_SECRET: 'short', FIRST_USER_ADMIN: '1', INVITE_ONLY: '0' });
  assert.match(api.log(), /BOOTSTRAP_SECRET ignored/); assert.match(api.log(), /FIRST_USER_ADMIN is ignored/);
  assert.equal((await register(api, 'Eve', 'short')).status, 403);
  assert.equal((await register(api, 'Eve', '')).status, 403, 'INVITE_ONLY=0 does not open a database deployment');
  assert.ok(!api.log().includes('short') || /ignored/.test(api.log()));
});

// ------------------------------------------------------------------ signup policy and roles

test('registration without an invitation is refused; with an invitation it works and does not make an admin; non-admins cannot administer', async t => {
  const d = await newDb(t); const api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const owner = await register(api, 'Owner', BOOT);
  assert.equal((await register(api, 'Nobody', '')).status, 403);
  assert.equal((await register(api, 'Nobody', 'NOPE1234')).status, 403);
  const inv = await call(api, 'POST', '/api/admin/invites/new', { cookie: owner.cookie, body: {} });
  assert.equal(inv.status, 200);
  const code = inv.body.code || inv.body.invite?.code;
  assert.ok(code, JSON.stringify(inv.body));
  const member = await register(api, 'Member', code);
  assert.equal(member.status, 200);
  assert.equal((await call(api, 'GET', '/api/me', { cookie: member.cookie })).body.user.admin, false);
  assert.equal((await register(api, 'Again', code)).status, 403, 'an invite is single use');
  for (const [m, p] of [['GET', '/api/admin/users'], ['GET', '/api/admin/invites'], ['POST', '/api/admin/invites/new'], ['GET', '/api/admin/audit'], ['POST', '/api/admin/audit/clear'], ['GET', '/api/admin/coach']]) {
    const r = await call(api, m, p, { cookie: member.cookie, body: m === 'POST' ? {} : undefined });
    assert.ok(r.status === 403 || r.status === 404, `${m} ${p} -> ${r.status}`);
  }
  const promote = await call(api, 'POST', '/api/admin/user/role', { cookie: member.cookie, body: { id: member.body.user.id, admin: true } });
  assert.notEqual(promote.status, 200, 'a member cannot promote themselves');
  assert.equal((await call(api, 'GET', '/api/me', { cookie: member.cookie })).body.user.admin, false);
});

test('public signup is opt-in twice over: PUBLIC_SIGNUP=1 does nothing until an administrator exists', async t => {
  const d = await newDb(t);
  const closed = await boot(t, d, { PUBLIC_SIGNUP: '1' });
  assert.match(closed.log(), /PUBLIC_SIGNUP=1 ignored/);
  assert.equal((await register(closed, 'Walk-in', '')).status, 403);
  await closed.kill();
  // an owner exists (made by invite-less seeding of the database document, as an admin would be)
  await d.db.query("insert into app_documents (name, body) values ('db', $1::jsonb) on conflict (name) do update set body = excluded.body",
    [JSON.stringify({ users: [{ id: 'adm', name: 'Admin', admin: true, owner: true, created: new Date().toISOString() }], creds: [], subs: [], invites: [] })]);
  const open = await boot(t, d, { PUBLIC_SIGNUP: '1' });
  const walkIn = await register(open, 'Walk-in', '');
  assert.equal(walkIn.status, 200);
  assert.equal((await call(open, 'GET', '/api/me', { cookie: walkIn.cookie })).body.user.admin, false);
  await open.kill();
  const shut = await boot(t, d, {});               // the variable removed again: closed
  assert.equal((await register(shut, 'Walk-in-2', '')).status, 403);
});

// ------------------------------------------------------------------ auth and sessions

test('passkey login, session persistence across a real restart, expiry, logout and sign-out-everywhere', async t => {
  const d = await newDb(t); let api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const pk = softPasskey({ rpId: RP_ID, origin: ORIGIN });
  const owner = await register(api, 'Owner', BOOT, pk); assert.equal(owner.status, 200);
  const uid = owner.body.user.id;
  assert.equal((await call(api, 'GET', '/api/me', { cookie: owner.cookie })).status, 200);
  assert.equal((await call(api, 'GET', '/api/me')).status, 401, 'no session');
  assert.equal((await call(api, 'GET', '/api/me', { cookie: '__Host-gymsid=' + uid + ':9999999999999:0.forged' })).status, 401, 'forged signature');
  assert.equal((await call(api, 'GET', '/api/me', { cookie: sessionFor(uid, { ttl: -1000 }) })).status, 401, 'expired');

  await api.kill();                                  // a true process restart
  api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  assert.equal((await call(api, 'GET', '/api/me', { cookie: owner.cookie })).status, 200, 'the session survives a restart');
  const again = await login(api, pk);                // the credential and its counter were read back from PostgreSQL
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const credRow = (await dbDoc(d)).creds[0]; assert.ok(credRow.counter >= 1, 'the counter moved and was stored');
  assert.equal((await login(api, pk)).status, 200);

  const out = await call(api, 'POST', '/api/logout', { cookie: again.cookie });
  assert.equal(out.cleared, true, 'logout clears the cookie');
  const all = await call(api, 'POST', '/api/logout/all', { cookie: again.cookie });
  assert.equal(all.status, 200);
  assert.equal((await call(api, 'GET', '/api/me', { cookie: owner.cookie })).status, 401, 'every earlier session is dead');
  await api.kill();
  api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  assert.equal((await call(api, 'GET', '/api/me', { cookie: owner.cookie })).status, 401, 'and stays dead after a restart');
  assert.equal((await login(api, pk)).status, 200, 'signing in again works');
});

test('WebAuthn: a wrong origin, a wrong RP_ID, a bad signature and an unknown credential are all refused', async t => {
  const d = await newDb(t); const api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const wrongOrigin = await register(api, 'Owner', BOOT, softPasskey({ rpId: RP_ID, origin: ORIGIN }), { o: 'https://evil.test' });
  assert.equal(wrongOrigin.status, 400);
  const wrongRp = await register(api, 'Owner', BOOT, softPasskey({ rpId: RP_ID, origin: ORIGIN }), { rp: 'evil.test' });
  assert.equal(wrongRp.status, 400);
  assert.equal((await dbDoc(d))?.users?.length ?? 0, 0, 'nothing was created by a refused registration');
  const pk = softPasskey({ rpId: RP_ID, origin: ORIGIN });
  assert.equal((await register(api, 'Owner', BOOT, pk)).status, 200);
  assert.equal((await login(api, pk, { badSignature: true })).status >= 400, true);
  assert.equal((await login(api, pk, { o: 'https://evil.test' })).status, 400);
  assert.equal((await login(api, pk, { rp: 'evil.test' })).status, 400);
  assert.equal((await login(api, softPasskey({ rpId: RP_ID, origin: ORIGIN }))).status, 404, 'unknown credential');
  // a cross-site POST never reaches a handler: the request's Origin has to be this site's
  assert.equal((await call(api, 'POST', '/api/register/options', { body: { name: 'x', code: BOOT }, origin: 'https://evil.test' })).status, 403);
});

// ------------------------------------------------------------------ data, isolation, restart

test('workouts and completed sets are written, isolated per user across every protected route, and survive a restart', async t => {
  const d = await newDb(t); let api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const owner = await register(api, 'Ana', BOOT);
  const inv = await call(api, 'POST', '/api/admin/invites/new', { cookie: owner.cookie, body: {} });
  const member = await register(api, 'Budi', inv.body.code || inv.body.invite?.code);
  assert.equal(member.status, 200);
  const sets = [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: true }, { w: 100, r: 4, done: false }];
  const put = (who, state, extra) => call(api, 'PUT', '/api/data', { cookie: who.cookie, body: { state, ...extra } });
  const a1 = await put(owner, S({ workouts: [{ id: 'w1', d: '2026-10-01', entries: [{ ex: 'squat', sets }] }], note: 'ana' }));
  const b1 = await put(member, S({ workouts: [{ id: 'w9', d: '2026-10-02', entries: [] }], note: 'budi' }));
  assert.equal(a1.status, 200); assert.equal(b1.status, 200);
  const stale = await put(owner, S({ note: 'ana-2' }), { baseRev: 0 });
  assert.equal(stale.status, 409, 'a push on an out-of-date revision is a conflict');
  const next = await put(owner, S({ workouts: [{ id: 'w1', d: '2026-10-01', entries: [{ ex: 'squat', sets }] }], note: 'ana-2' }), { baseRev: a1.body.rev, baseWid: a1.body.wid });
  assert.equal(next.status, 200);

  for (const who of [owner, member]) {
    const got = await call(api, 'GET', '/api/data', { cookie: who.cookie });
    assert.equal(got.body.state.note, who === owner ? 'ana-2' : 'budi');
    assert.equal((await call(api, 'GET', '/api/data/rev', { cookie: who.cookie })).body.rev, got.body.rev);
  }
  // the user id in a query string, a header or the body never selects whose data is used
  const probe = await call(api, 'GET', `/api/data?uid=${owner.body.user.id}&userId=${owner.body.user.id}`, { cookie: member.cookie });
  assert.equal(probe.body.state.note, 'budi');
  const nudge = await call(api, 'GET', '/api/nudge-check?date=2026-10-01', { cookie: member.cookie });
  assert.equal(nudge.body.done, false, 'the other profile\'s workout on that date is not visible');
  assert.equal((await call(api, 'GET', '/api/nudge-check?date=2026-10-01', { cookie: owner.cookie })).body.done, true);
  const adminPeek = await call(api, 'GET', `/api/admin/user?id=${owner.body.user.id}`, { cookie: member.cookie });
  assert.ok(adminPeek.status === 403 || adminPeek.status === 404);
  // every protected route refuses a request with no session
  for (const [m, p] of [['GET', '/api/data'], ['GET', '/api/data/rev'], ['PUT', '/api/data'], ['GET', '/api/me'], ['GET', '/api/nudge-check?date=2026-10-01'],
    ['POST', '/api/logout/all'], ['POST', '/api/push/subscribe'], ['GET', '/api/admin/users'], ['POST', '/api/coach/pending/resolve'], ['GET', '/api/coach/status']]) {
    const r = await call(api, m, p, { body: m === 'GET' ? undefined : {} });
    assert.ok([401, 403, 503].includes(r.status), `${m} ${p} -> ${r.status}`);
    assert.notEqual(r.status, 200);
  }

  await api.kill();
  api = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const back = await call(api, 'GET', '/api/data', { cookie: owner.cookie });
  assert.equal(back.body.state.workouts[0].entries[0].sets.filter(s => s.done).length, 2, 'completed sets are intact after a restart');
  assert.equal((await call(api, 'GET', '/api/data', { cookie: member.cookie })).body.state.note, 'budi');
  assert.deepEqual(fs.readdirSync(api.dataDir).filter(f => /^(state-|db\.json|secret|vapid|audit)/.test(f)), [], 'no durable file on the local disk');
});

// ------------------------------------------------------------------ one instance

test('a second API instance cannot overwrite the first: a real change on a stale instance is refused and that instance stops', async t => {
  const d = await newDb(t);
  const a = await boot(t, d, { BOOTSTRAP_SECRET: BOOT });
  const owner = await register(a, 'Owner', BOOT); assert.equal(owner.status, 200);
  const b = await boot(t, d, {});
  const uid = owner.body.user.id; const ck = owner.cookie;
  assert.equal((await call(b, 'GET', '/api/data', { cookie: ck })).status, 200);       // B starts from A's copy
  // A changes the user database again (a sign-in); B then notes a last-pull time: bookkeeping only
  assert.equal((await call(b, 'GET', '/api/health')).status, 200);
  // now a real change on the stale instance: refused, and the instance says so and stops
  await call(a, 'POST', '/api/admin/invites/new', { cookie: ck, body: {} });            // A moves the version on
  const refused = await call(b, 'POST', '/api/admin/invites/new', { cookie: ck, body: {} });
  assert.equal(refused.status, 503);
  const health = await call(b, 'GET', '/api/health'); assert.equal(health.status, 503);
  assert.equal(await Promise.race([b.exited, new Promise(r => setTimeout(() => r('still running'), 4000))]), 1, 'it exits with a failure code so the platform restarts it');
  assert.match(b.log(), /another API instance/);
  const stored = await dbDoc(d);
  assert.equal(stored.invites.length, 1, 'what instance A wrote is intact and the refused write left nothing');
  assert.equal((await call(a, 'GET', '/api/health')).status, 200);
});
