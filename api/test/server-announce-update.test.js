/* "FitSaku was just updated": POST /api/announce-update sends one push per account holding a subscription,
   once per release id, and only for the caller that holds ANNOUNCE_SECRET. The subscriptions have private
   endpoints, so the send path refuses and prunes each one it would have contacted without opening a socket:
   what is left in db.json says which accounts it tried. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { updatePush } from '../push-messages.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sub = (userId, endpoint) => ({ userId, endpoint, keys: { p256dh: 'p', auth: 'a' }, created: new Date().toISOString() });

async function startServer(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-announce-'));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u1', name: 'One', created: new Date().toISOString() }, { id: 'u2', name: 'Two', created: new Date().toISOString() }],
    creds: [], invites: [], subs: [sub('u1', 'https://10.0.0.2/a'), sub('u2', 'https://10.0.0.3/b')]
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', AUDIT_LOG: '0', REMINDER_TICK_MS: '100000', ...env }
  });
  const h = { dataDir, log: '' };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  h.api = `http://127.0.0.1:${await boundPort(child, () => h.log)}`;
  h.post = (secret, id) => fetch(`${h.api}/api/announce-update`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ id })
  });
  h.db = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  return h;
}

test('the message is short and carries the update flag the worker looks for', () => {
  assert.deepEqual(updatePush('id'), { title: 'FitSaku', body: 'FitSaku baru saja diupdate', tag: 'app-update', update: true });
  assert.equal(updatePush('xx').body, 'FitSaku was just updated');
});

test('without ANNOUNCE_SECRET the route does not exist', async t => {
  const h = await startServer(t);
  assert.equal((await h.post('anything', 'abcd1234')).status, 404);
});

test('a wrong or missing secret is refused and sends nothing', async t => {
  const h = await startServer(t, { ANNOUNCE_SECRET: 'right-secret' });
  assert.equal((await h.post('', 'abcd1234')).status, 401);
  assert.equal((await h.post('wrong', 'abcd1234')).status, 401);
  assert.equal(h.db().subs.length, 2);
  assert.equal(h.db().announced, undefined);
});

test('a bad release id is refused', async t => {
  const h = await startServer(t, { ANNOUNCE_SECRET: 'right-secret' });
  assert.equal((await h.post('right-secret', 'no way!')).status, 400);
});

test('a release is announced to every account once, and a repeat is skipped', async t => {
  const h = await startServer(t, { ANNOUNCE_SECRET: 'right-secret' });
  const r = await h.post('right-secret', 'abcdef1234');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { sent: 2 });
  // both accounts were tried: their (private) endpoints were refused and pruned
  assert.equal(h.db().subs.length, 0);
  assert.equal(h.db().announced.id, 'abcdef1234');
  const again = await h.post('right-secret', 'abcdef1234');
  assert.deepEqual(await again.json(), { sent: 0, skipped: 'already announced' });
});
