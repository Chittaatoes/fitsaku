/* Which storage a start-up uses, and what it touches on the disk. With DATABASE_URL the data directory
   is not created or written (on Render the service user cannot create /data: the crash this guards
   against); without it the filesystem mode works as before; a deployment that requires PostgreSQL
   refuses to start without one instead of quietly using the disk. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Variables that would change which mode a child picks, whatever the machine running the tests has set.
const CLEAN = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DATABASE_|REQUIRE_DATABASE|ALLOW_FILE_STORAGE|RENDER|NODE_ENV|DATA_DIR|SESSION_SECRET|MEDIA_UPLOADS|BOOTSTRAP_SECRET)/.test(k)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-mode-'));

async function start(t, env) {
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'], env: { ...CLEAN, PORT: '0', ...env } });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => child.kill('SIGKILL'));
  const url = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return { url, log: () => log };
}
const refused = env => spawnSync(process.execPath, ['server.js'], { cwd: API, env: { ...CLEAN, PORT: '0', ...env }, encoding: 'utf8', timeout: 20000 });

test('PostgreSQL mode starts without creating or writing the data directory', async t => {
  const db = new PGlite();
  const sock = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await sock.start(); t.after(() => sock.stop().catch(() => {}));
  const parent = tmp();
  fs.writeFileSync(path.join(parent, 'blocker'), 'a file, so nothing can be created below it');
  const DATA_DIR = path.join(parent, 'blocker', 'data');     // mkdir here fails (ENOTDIR), as /data does for the Render user
  const api = await start(t, {
    DATA_DIR, DATABASE_URL: `postgres://postgres:pw@127.0.0.1:${sock.server.address().port}/postgres`, DATABASE_TLS: 'insecure-local',
    SESSION_SECRET: 'a'.repeat(64), REQUIRE_DATABASE: '1', ORIGIN: 'https://fitsaku.test', RP_ID: 'fitsaku.test',
  });
  const h = await (await fetch(api.url + '/api/health')).json();
  assert.equal(h.ok, true); assert.equal(h.storage, 'postgres');
  assert.equal((await fetch(api.url + '/api/health/ready')).status, 200);
  assert.equal((await fetch(api.url + '/api/config')).status, 200);
  assert.ok(!fs.existsSync(DATA_DIR), 'the data directory was not created');
  assert.ok(!/EACCES|ENOTDIR|EEXIST|mkdir/i.test(api.log()), api.log());
  assert.deepEqual(fs.readdirSync(parent), ['blocker']);
});

test('filesystem mode is unchanged: it creates the data directory, the secret and serves', async t => {
  const DATA_DIR = path.join(tmp(), 'nested', 'data');
  const api = await start(t, { DATA_DIR });
  const h = await (await fetch(api.url + '/api/health')).json();
  assert.equal(h.ok, true); assert.equal(h.storage, undefined);
  assert.ok(fs.existsSync(path.join(DATA_DIR, 'secret')), 'the session secret file was created');
  assert.ok(fs.existsSync(DATA_DIR));
});

test('a deployment that requires PostgreSQL refuses to start without DATABASE_URL, with a clear message', () => {
  const DATA_DIR = path.join(tmp(), 'must-not-exist');
  for (const env of [{ REQUIRE_DATABASE: '1' }, { RENDER: 'true' }]) {
    const r = refused({ DATA_DIR, ...env });
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, /FATAL: DATABASE_URL is not set, but this deployment requires PostgreSQL/);
    assert.ok(!fs.existsSync(DATA_DIR), 'and it did not fall back to creating the data directory');
  }
});

test('the requirement is configurable: ALLOW_FILE_STORAGE=1 lets Render run on files on purpose, unset keeps local development working', async t => {
  const a = await start(t, { DATA_DIR: path.join(tmp(), 'd1'), RENDER: 'true', ALLOW_FILE_STORAGE: '1' });
  assert.equal((await (await fetch(a.url + '/api/health')).json()).ok, true);
  const b = await start(t, { DATA_DIR: path.join(tmp(), 'd2'), REQUIRE_DATABASE: '0' });
  assert.equal((await (await fetch(b.url + '/api/health')).json()).ok, true);
});

test('a missing CA still fails closed in PostgreSQL mode, and does not touch the disk either', () => {
  const DATA_DIR = path.join(tmp(), 'must-not-exist');
  const r = refused({ DATA_DIR, DATABASE_URL: 'postgres://u:SuperSecretPw@db.example.test:5432/postgres', REQUIRE_DATABASE: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FATAL: database start-up failed: DATABASE_SSL_CA/);
  assert.ok(!/SuperSecretPw/.test(r.stderr + r.stdout)); assert.ok(!fs.existsSync(DATA_DIR));
});
