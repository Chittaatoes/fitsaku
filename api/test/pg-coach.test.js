/* The AI Coach on PostgreSQL: its instance config (with the encrypted provider key) and the
   per-profile records survive a restart, read the profile document through the store, and nothing
   of it is written to the local disk. The proposal-approval routes themselves are covered by the
   existing coach tests, which run on file storage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-coach-'));
process.env.DATA_DIR = dir;
const { openPgStore } = await import('../pg-store.js');
const { rt } = await import('../runtime-store.js');
const config = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const quiet = { error() {}, log() {} };

test('coach config and per-profile records persist across a restart and stay off the disk', async () => {
  const db = new PGlite();
  let store = await openPgStore({ pool: db, log: quiet });
  rt.pg = store; rt.secret = 'a'.repeat(64);
  config.reset();
  config.save({ provider: 'fixture', enabled: true });
  jobs.setShare('u1', true);
  await store.flush();
  assert.deepEqual(fs.readdirSync(dir), [], 'no coach file on the local disk');

  // "restart": a new store over the same database, nothing in memory
  store = await openPgStore({ pool: db, log: quiet });
  rt.pg = store; config.reset();
  assert.equal(config.load().provider, 'fixture');
  assert.equal(jobs.isSharing('u1'), true);
  assert.equal(jobs.isSharing('u2'), false);
});

test('the coach reads a profile document and the list of profiles through the store', async () => {
  const db = new PGlite();
  const store = await openPgStore({ pool: db, log: quiet });
  rt.pg = store;
  await store.putState('u7', JSON.stringify({ _rev: 1, unit: 'kg', workouts: [] }), { expectedRev: 0, rev: 1 });
  assert.equal(jobs.readState('u7').unit, 'kg');
  assert.deepEqual(jobs.listUserIds(), ['u7']);
  assert.equal(jobs.readState('nobody'), null);
});

test('a credential encrypted with the session secret decrypts after a restart with the same secret', async () => {
  rt.secret = 'b'.repeat(64); config.reset();
  const sealed = config.encrypt({ key: 'sk-test' });
  config.reset();
  assert.deepEqual(config.decrypt(sealed), { key: 'sk-test' });
});

/* The proposal lifecycle on PostgreSQL: a review job (fixture provider) leaves a checked proposal in
   the profile's coach record; it survives a restart; rejecting it clears it and records the outcome;
   and nothing in the profile document changes, because a proposal is only ever applied by the app
   on the user's device (rollback = never applied). A second profile never sees it. */
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const { sampleState } = await import('./helpers.mjs');
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });
const settle = async uid => { const until = Date.now() + 20000; while (Date.now() < until) { const s = jobs.status(uid); if (!s.job) return s; await new Promise(r => setTimeout(r, 25)); } throw new Error('job never finished'); };

test('a proposal is created, survives a restart, is rejected and recorded, and the profile document is untouched', async () => {
  const db = new PGlite();
  let store = await openPgStore({ pool: db, log: quiet });
  rt.pg = store; rt.secret = 'c'.repeat(64); config.reset();
  config.save({ enabled: true, provider: 'fixture' });
  const doc = JSON.stringify({ ...sampleState(), _rev: 1 });
  await store.putState('u-coach', doc, { expectedRev: 0, rev: 1 });
  await store.putState('u-other', JSON.stringify({ ...sampleState(), _rev: 1 }), { expectedRev: 0, rev: 1 });

  jobs.enqueue('u-coach', { kind: 'review' });
  const s = await settle('u-coach');
  assert.ok(s.pending?.changes?.length, 'a checked proposal is held for the user');
  await store.flush();

  store = await openPgStore({ pool: db, log: quiet });             // restart
  rt.pg = store; config.reset();
  assert.ok(jobs.status('u-coach').pending, 'the proposal is still there');
  assert.equal(jobs.status('u-other').pending, null, 'another profile does not see it');
  assert.deepEqual(jobs.resolvePending('u-other', { rejected: ['x'] }), { ok: true }, 'resolving without a proposal changes nothing');

  jobs.resolvePending('u-coach', { rejected: s.pending.changes.map((c, i) => c.id ?? i) });
  await store.flush();
  assert.equal(jobs.status('u-coach').pending, null);
  assert.equal(jobs.readUser('u-coach').history.at(-1).outcome, 'applied');
  assert.deepEqual(JSON.parse(store.stateText('u-coach')), JSON.parse(doc), 'the profile document is exactly as it was: nothing is applied server-side');

  jobs.enqueue('u-coach', { kind: 'review' });
  const second = await settle('u-coach');
  jobs.resolvePending('u-coach', { dismissed: true });
  assert.equal(jobs.readUser('u-coach').history.at(-1).outcome, 'dismissed');
  assert.ok(second.pending);
  await store.flush();
  const kv = (await db.query("select body from kv_documents where name = 'coach/u-coach.json'")).rows[0];
  assert.ok(kv && JSON.parse(kv.body).history.length >= 2, 'the record is in the database');
});

test('with the database down a proposal decision is not reported as stored', async () => {
  const db = new PGlite();
  const pool = { down: false, query(...a) { return this.down ? Promise.reject(new Error('connection refused')) : db.query(...a); }, exec(t) { return this.down ? Promise.reject(new Error('connection refused')) : db.exec(t); } };
  const store = await openPgStore({ pool, log: quiet, retryMs: 20 });
  rt.pg = store; config.reset();
  jobs.setShare('u-down', true);
  pool.down = true;
  jobs.setShare('u-down', false);
  assert.equal(store.dirty, true, 'the decision is queued, and an HTTP answer would wait for it (json() flush)');
  await assert.rejects(store.flush(), /connection refused/);
  pool.down = false;
  await new Promise(r => setTimeout(r, 150));
  assert.equal(store.dirty, false);
  assert.equal(JSON.parse((await db.query("select body from kv_documents where name = 'coach/u-down.json'")).rows[0].body).share, false);
});
