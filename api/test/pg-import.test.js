/* The file -> PostgreSQL import: dry run writes nothing, apply is verified by counts, an existing
   database is protected, a damaged source is refused, and the API then serves the imported data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { importFiles } from '../scripts/import-files-to-pg.mjs';
import { openPgStore } from '../pg-store.js';

const quiet = () => {};
function sourceDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-import-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }], creds: [{ id: 'c1', userId: 'u1', publicKey: 'pk', counter: 3 }], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dir, 'state-u1.json'), JSON.stringify({ _rev: 7, _wid: 'abc', workouts: [{ d: '2026-01-01' }, { d: '2026-01-02' }], routines: [] }));
  fs.writeFileSync(path.join(dir, 'state-u2.json'), JSON.stringify({ _rev: 1, workouts: [{ d: '2026-02-01' }], routines: [] }));
  fs.writeFileSync(path.join(dir, 'audit.log'), '{"id":1,"ts":1,"ev":"login","ok":true}\n{"id":2,"ts":2,"ev":"logout","ok":true}\n{"id":3,"ts"');
  fs.writeFileSync(path.join(dir, 'secret'), 'topsecret');
  return dir;
}

test('a dry run validates and counts but writes nothing', async () => {
  const dir = sourceDir(); const db = new PGlite();
  const r = await importFiles({ dir, pool: db, log: quiet });
  assert.equal(r.applied, false); assert.equal(r.error, undefined);
  assert.deepEqual([r.source.users, r.source.credentials, r.source.states, r.source.workouts, r.source.audit], [2, 1, 2, 3, 2]);
  const t = await db.query("select count(*)::int as n from pg_tables where schemaname = 'public'");
  assert.equal(t.rows[0].n, 0, 'not even the schema is created');
});

test('apply imports everything, keeps revisions, and the store then serves it', async () => {
  const dir = sourceDir(); const db = new PGlite();
  const r = await importFiles({ dir, pool: db, apply: true, log: quiet });
  assert.equal(r.error, undefined, r.error); assert.equal(r.applied, true); assert.deepEqual(r.mismatches, []);
  const s = await openPgStore({ pool: db, log: { error() {}, log() {} } });
  assert.equal(JSON.parse(s.stateText('u1'))._rev, 7);
  assert.equal(s.loadDb().creds[0].counter, 3, 'passkey credential metadata is carried over');
  assert.equal(s.auditRows().length, 2);
  assert.equal(s.secret('session'), null, 'the session secret is only imported on request');
  assert.ok(fs.existsSync(path.join(dir, 'db.json')), 'the source is untouched');
});

test('a database that already holds data is not overwritten without --force', async () => {
  const dir = sourceDir(); const db = new PGlite();
  await importFiles({ dir, pool: db, apply: true, log: quiet });
  fs.writeFileSync(path.join(dir, 'state-u1.json'), JSON.stringify({ _rev: 99, workouts: [], routines: [] }));
  const refused = await importFiles({ dir, pool: db, apply: true, log: quiet });
  assert.match(refused.error, /already holds data/);
  assert.equal(Number((await db.query("select rev from user_state where user_id = 'u1'")).rows[0].rev), 7);
  const forced = await importFiles({ dir, pool: db, apply: true, force: true, log: quiet });
  assert.equal(forced.error, undefined);
  assert.equal(Number((await db.query("select rev from user_state where user_id = 'u1'")).rows[0].rev), 99);
});

test('--with-secret keeps the session secret so signed-in users stay signed in', async () => {
  const dir = sourceDir(); const db = new PGlite();
  await importFiles({ dir, pool: db, apply: true, withSecret: true, log: quiet });
  assert.equal((await db.query("select value from app_secrets where name = 'session'")).rows[0].value, 'topsecret');
});

test('a damaged source file stops the import before anything is written', async () => {
  const dir = sourceDir(); const db = new PGlite();
  fs.writeFileSync(path.join(dir, 'state-u2.json'), '{"_rev": 1, "workouts": [');
  const r = await importFiles({ dir, pool: db, apply: true, log: quiet });
  assert.match(r.error, /nothing imported/); assert.equal(r.applied, false);
  assert.ok(r.problems.some(p => p.startsWith('state-u2.json')));
});
