/* The PostgreSQL store (pg-store.js), against a real PostgreSQL engine (PGlite, in process):
   migrations, durability across a reopen, the compare-and-swap on a profile's revision, the
   optimistic lock on the user database, and what happens while the database is unreachable. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { openPgStore, runMigrations } from '../pg-store.js';

const quiet = { error() {}, log() {}, warn() {} };
/** A pool that can be made to fail, to stand in for an unreachable database. */
function flaky(db) {
  const p = { down: false, query(...a) { if (p.down) return Promise.reject(new Error('connection refused')); return db.query(...a); }, exec(t) { if (p.down) return Promise.reject(new Error('connection refused')); return db.exec(t); } };
  return p;
}
const open = (pool, extra = {}) => openPgStore({ pool, log: quiet, retryMs: 30, ...extra });
const doc = (rev, extra = {}) => JSON.stringify({ routines: [], workouts: [], _rev: rev, _wid: 'w' + rev, ...extra });

test('migrations apply once, in order, and a second run does nothing', async () => {
  const db = new PGlite();
  assert.deepEqual(await runMigrations(db), ['001_init.sql']);
  assert.deepEqual(await runMigrations(db), []);
  const tables = (await db.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map(r => r.tablename);
  for (const t of ['app_documents', 'user_state', 'app_secrets', 'audit_events', 'kv_documents', 'schema_migrations']) assert.ok(tables.includes(t), t);
});

test('every data table has row level security on, so the Data API roles see nothing', async () => {
  const db = new PGlite(); await runMigrations(db);
  const rows = (await db.query("select relname, relrowsecurity from pg_class where relname in ('app_documents','user_state','app_secrets','audit_events','kv_documents')")).rows;
  assert.equal(rows.length, 5);
  assert.ok(rows.every(r => r.relrowsecurity === true), JSON.stringify(rows));
});

test('a profile document written is there after the store is reopened', async () => {
  const db = new PGlite();
  const a = await open(db);
  assert.equal(await a.putState('u1', doc(1), { expectedRev: 0, rev: 1, wid: 'w1' }), true);
  assert.equal(await a.putState('u1', doc(2, { workouts: [{ d: '2026-01-01' }] }), { expectedRev: 1, rev: 2, wid: 'w2' }), true);
  const b = await open(db);                       // a restart: nothing is carried over but the database
  assert.deepEqual(b.stateUids(), ['u1']);
  const S = JSON.parse(b.stateText('u1'));
  assert.equal(S._rev, 2); assert.equal(S.workouts[0].d, '2026-01-01');
});

test('a write against a stale revision is refused, so two writers cannot overwrite each other', async () => {
  const db = new PGlite(); const s = await open(db);
  await s.putState('u1', doc(1), { expectedRev: 0, rev: 1, wid: 'a' });
  const results = await Promise.all([
    s.putState('u1', doc(2, { who: 'first' }), { expectedRev: 1, rev: 2, wid: 'b' }),
    s.putState('u1', doc(2, { who: 'second' }), { expectedRev: 1, rev: 2, wid: 'c' }),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  const stored = (await db.query("select rev, body->>'who' as who from user_state where user_id = 'u1'")).rows[0];
  assert.equal(Number(stored.rev), 2);
  assert.ok(['first', 'second'].includes(stored.who));
  // creating the same profile twice: only the first insert counts
  assert.equal(await s.putState('u2', doc(1), { expectedRev: 0, rev: 1 }), true);
  const t = await open(db);
  assert.equal(await t.putState('u2', doc(1, { x: 1 }), { expectedRev: 0, rev: 1 }), false);
});

test('reloadState brings in the document another writer stored', async () => {
  const db = new PGlite(); const a = await open(db); const b = await open(db);
  await a.putState('u1', doc(1), { expectedRev: 0, rev: 1 });
  assert.equal(b.stateText('u1'), null);
  assert.equal(JSON.parse(await b.reloadState('u1'))._rev, 1);
});

test('the user database round-trips, and a second writer is refused instead of overwriting', async () => {
  const db = new PGlite();
  const a = await open(db);
  assert.equal(a.loadDb(), null);
  a.saveDb({ users: [{ id: 'u1', name: 'A' }], creds: [{ id: 'c1' }], subs: [], invites: [] });
  await a.flush();
  const b = await open(db);
  assert.equal(b.loadDb().users[0].name, 'A');
  assert.equal(b.loadDb().creds[0].id, 'c1');
  // a and b both hold version 1; b writes first, then a must not clobber it
  b.saveDb({ users: [{ id: 'u1', name: 'B' }], creds: [], subs: [], invites: [] }); await b.flush();
  let fatal = null;
  const c = await open(db, { onFatal: e => { fatal = e; } });
  c.saveDb({ users: [{ id: 'u1', name: 'C' }], creds: [], subs: [], invites: [] }); await c.flush();   // c opened after b: current
  a.saveDb({ users: [{ id: 'u1', name: 'stale' }], creds: [], subs: [], invites: [] });
  await assert.rejects(a.flush(), /another API instance/);
  assert.equal((await db.query("select body->'users'->0->>'name' as n from app_documents where name = 'db'")).rows[0].n, 'C');
  assert.equal(a.fatal?.code, 'CONFLICT');
  assert.equal(fatal, null);
});

test('while the database is down a write stays queued, is reported, and lands when it returns', async () => {
  const db = new PGlite(); const pool = flaky(db); const s = await open(pool);
  pool.down = true;
  s.saveDb({ users: [{ id: 'u1', name: 'kept' }], creds: [], subs: [], invites: [] });
  assert.equal(s.dirty, true);
  await assert.rejects(s.flush(), /connection refused/);
  assert.equal(s.dirty, true, 'a failed write is not forgotten');
  await assert.rejects(s.putState('u1', doc(1), { expectedRev: 0, rev: 1 }), /connection refused/);
  assert.equal(s.stateText('u1'), null, 'memory does not run ahead of the database');
  pool.down = false;
  await new Promise(r => setTimeout(r, 120));      // the background retry
  assert.equal(s.dirty, false);
  assert.equal((await db.query("select body->'users'->0->>'name' as n from app_documents where name = 'db'")).rows[0].n, 'kept');
});

test('secrets are generated once; a second instance gets the stored value, not its own', async () => {
  const db = new PGlite(); const a = await open(db); const b = await open(db);
  const [x, y] = await Promise.all([a.ensureSecret('session', () => 'first'), b.ensureSecret('session', () => 'second')]);
  assert.equal(x, y);
  assert.equal(await a.ensureSecret('session', () => 'third'), x);
});

test('account deletion removes the profile document from the database', async () => {
  const db = new PGlite(); const s = await open(db);
  await s.putState('u1', doc(1), { expectedRev: 0, rev: 1 });
  s.deleteStateQueued('u1');
  assert.equal(s.stateText('u1'), null);
  await s.flush();
  assert.equal((await db.query('select count(*)::int as n from user_state')).rows[0].n, 0);
});

test('audit rows and coach documents persist, and clearing the log empties it', async () => {
  const db = new PGlite(); const s = await open(db);
  s.auditAppend({ id: 1, ts: 1, ev: 'login', ok: true }); s.auditAppend({ id: 2, ts: 2, ev: 'logout', ok: true });
  s.kvSet('coach.json', '{"provider":"fixture"}'); s.kvSet('coach/u1.json', '{"daily":null}');
  await s.flush();
  const t = await open(db);
  assert.deepEqual(t.auditRows().map(r => r.id), [1, 2]);
  assert.equal(t.kvGet('coach.json'), '{"provider":"fixture"}');
  assert.deepEqual(t.kvList('coach/'), ['coach/u1.json']);
  t.auditKeepOnly([{ id: 2, ts: 2, ev: 'logout', ok: true }]); await t.flush();
  assert.equal((await db.query('select count(*)::int as n from audit_events')).rows[0].n, 1);
  t.auditClear(); await t.flush();
  assert.equal((await db.query('select count(*)::int as n from audit_events')).rows[0].n, 0);
});

test('bookkeeping saved by a stale instance takes the other instance\'s copy; a real change on a stale instance is refused', async () => {
  const db = new PGlite();
  const a = await open(db);
  a.saveDb({ users: [{ id: 'u1' }], creds: [], subs: [], invites: [] }); await a.flush();
  let reloaded = null;
  const b = await open(db, { onDbReload: x => { reloaded = x; } });
  a.saveDb({ users: [{ id: 'u1' }, { id: 'u2' }], creds: [], subs: [], invites: [] }); await a.flush();   // a moves the version on
  b.saveDb({ users: [{ id: 'u1' }], creds: [], subs: [], invites: [] }, { soft: true });                  // b only noted a date
  await b.flush();
  assert.equal(reloaded.users.length, 2, 'b took a\'s copy instead of overwriting it');
  assert.equal(b.fatal, null);
  b.saveDb({ users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }], creds: [], subs: [], invites: [] }); await b.flush();   // now current: allowed
  a.saveDb({ users: [{ id: 'stale' }], creds: [], subs: [], invites: [] });
  await assert.rejects(a.flush(), /another API instance/);
  assert.equal((await db.query("select jsonb_array_length(body->'users') as n from app_documents where name = 'db'")).rows[0].n, 3);
});
