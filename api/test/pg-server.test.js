/* The real server.js in PostgreSQL mode (DATABASE_URL), talking to a real PostgreSQL engine over
   the wire (PGlite behind a socket server, reached through the `pg` driver): health and readiness,
   sessions and per-user isolation, saving and reading a profile, revision conflicts, persistence
   across a restart of the API process, and the database going away and coming back. */
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

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const session = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const ORIGIN = 'https://fitsaku.test';
const as = uid => ({ Cookie: `__Host-gymsid=${session(uid)}`, Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' });

async function startDb(t, db = new PGlite(), port = 0) {
  const sock = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
  await sock.start();
  const bound = sock.server?.address?.()?.port ?? port;
  t.after(() => sock.stop().catch(() => {}));
  return { db, sock, port: bound };
}

async function startApi(t, dbPort) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-pg-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'fitsaku.test',
      DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${dbPort}/postgres`, DATABASE_TLS: 'insecure-local', SESSION_SECRET: SECRET,
    },
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return { url, child, log: () => log, dataDir };
}

const users = [{ id: 'u_a', name: 'Ana', created: new Date().toISOString() }, { id: 'u_b', name: 'Budi', created: new Date().toISOString() }];
async function seeded(t) {
  const d = await startDb(t);
  await d.db.exec(fs.readFileSync(path.join(API, 'migrations', '001_init.sql'), 'utf8').replace(/^/, 'create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now());\n'));
  await d.db.query("insert into schema_migrations (id) values ('001_init.sql')");
  await d.db.query("insert into app_documents (name, body) values ('db', $1::jsonb)", [JSON.stringify({ users, creds: [], subs: [], invites: [] })]);
  return d;
}
const put = (api, uid, state, extra = {}) => fetch(api + '/api/data', { method: 'PUT', headers: as(uid), body: JSON.stringify({ state, ...extra }) });
const get = (api, uid) => fetch(api + '/api/data', { headers: as(uid) }).then(r => r.json());
const S = (extra = {}) => ({ routines: [{ id: 'r1', name: 'Push' }], workouts: [], unit: 'kg', ...extra });

test('health and readiness report the database, and expose no secrets or user data', async t => {
  const d = await seeded(t); const api = await startApi(t, d.port);
  const h = await (await fetch(api.url + '/api/health')).json();
  assert.equal(h.ok, true); assert.equal(h.storage, 'postgres');
  const r = await fetch(api.url + '/api/health/ready'); const rb = await r.json();
  assert.equal(r.status, 200); assert.equal(rb.ok, true);
  const text = JSON.stringify([h, rb]);
  assert.ok(!/postgres:\/\/|password|secret|u_a|Ana/i.test(text), text);
});

test('saved workouts survive a restart of the API process, and nothing is written to the local disk', async t => {
  const d = await seeded(t);
  const a = await startApi(t, d.port);
  const saved = await put(a.url, 'u_a', S({ workouts: [{ id: 'w1', d: '2026-10-01', entries: [{ ex: 'squat', sets: [{ r: 5, w: 100, done: true }] }] }] }));
  assert.equal(saved.status, 200); assert.equal((await saved.json()).rev, 1);
  assert.deepEqual(fs.readdirSync(a.dataDir).filter(f => /^(state-|db\.json|secret|vapid)/.test(f)), [], 'no profile data on the disk');
  a.child.kill('SIGKILL');
  const b = await startApi(t, d.port);
  const back = await get(b.url, 'u_a');
  assert.equal(back.rev, 1);
  assert.equal(back.state.workouts[0].entries[0].sets[0].w, 100);
});

test('a profile cannot read or write another profile, whatever the request says', async t => {
  const d = await seeded(t); const api = await startApi(t, d.port);
  await put(api.url, 'u_a', S({ secret_note: 'ana-only' }));
  await put(api.url, 'u_b', S({ secret_note: 'budi-only' }));
  assert.equal((await get(api.url, 'u_a')).state.secret_note, 'ana-only');
  assert.equal((await get(api.url, 'u_b')).state.secret_note, 'budi-only');
  // the id in the body, query or a header changes nothing: the session decides
  const sneaky = await fetch(api.url + '/api/data?uid=u_b&userId=u_b', { method: 'PUT', headers: { ...as('u_a'), 'X-User-Id': 'u_b' }, body: JSON.stringify({ userId: 'u_b', uid: 'u_b', state: S({ secret_note: 'overwritten?' }) }) });
  assert.equal(sneaky.status, 200);
  assert.equal((await get(api.url, 'u_b')).state.secret_note, 'budi-only');
  assert.equal((await fetch(api.url + '/api/data')).status, 401, 'no session');
  assert.equal((await fetch(api.url + '/api/data', { headers: { Cookie: '__Host-gymsid=u_b:9999999999999:0.forged' } })).status, 401, 'forged session');
});

test('a push built on an old revision gets 409 with the current document, and a retry on it succeeds', async t => {
  const d = await seeded(t); const api = await startApi(t, d.port);
  const first = await (await put(api.url, 'u_a', S({ unit: 'kg' }))).json();
  const second = await (await put(api.url, 'u_a', S({ unit: 'lb' }), { baseRev: first.rev, baseWid: first.wid })).json();
  const stale = await put(api.url, 'u_a', S({ unit: 'stone' }), { baseRev: first.rev, baseWid: first.wid });
  assert.equal(stale.status, 409);
  const body = await stale.json();
  assert.equal(body.rev, second.rev); assert.equal(body.state.unit, 'lb');
  const retry = await put(api.url, 'u_a', S({ unit: 'stone' }), { baseRev: body.rev, baseWid: body.state._wid });
  assert.equal(retry.status, 200);
});

test('simultaneous pushes from two devices: exactly one wins, the other is told to merge', async t => {
  const d = await seeded(t); const api = await startApi(t, d.port);
  const base = await (await put(api.url, 'u_a', S())).json();
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => put(api.url, 'u_a', S({ unit: 'device' + i }), { baseRev: base.rev, baseWid: base.wid })));
  const codes = results.map(r => r.status).sort();
  assert.equal(codes.filter(c => c === 200).length, 1, codes.join());
  assert.equal(codes.filter(c => c === 409).length, 5, codes.join());
  const stored = (await d.db.query("select rev from user_state where user_id = 'u_a'")).rows[0];
  assert.equal(Number(stored.rev), base.rev + 1);
});

test('database unreachable: a save answers 503 and is never reported as stored; it works again once the database is back', async t => {
  const d = await seeded(t);
  const api = await startApi(t, d.port);
  const ok = await put(api.url, 'u_a', S({ unit: 'kg' })); assert.equal(ok.status, 200);
  await d.sock.stop();
  const down = await put(api.url, 'u_a', S({ unit: 'lb' }), { baseRev: 1 });
  assert.equal(down.status, 503); assert.equal((await down.json()).code, 'storage-unavailable');
  const ready = await fetch(api.url + '/api/health/ready'); assert.equal(ready.status, 503);
  assert.equal((await get(api.url, 'u_a')).state.unit, 'kg', 'the failed write is not served back');
  const sock2 = new PGLiteSocketServer({ db: d.db, port: d.port, host: '127.0.0.1', maxConnections: 10 });
  await sock2.start(); t.after(() => sock2.stop().catch(() => {}));
  await new Promise(r => setTimeout(r, 5200));       // the readiness probe is cached for 5 s
  const again = await put(api.url, 'u_a', S({ unit: 'lb' }), { baseRev: 1 });
  assert.equal(again.status, 200);
  assert.equal((await fetch(api.url + '/api/health/ready')).status, 200);
});
