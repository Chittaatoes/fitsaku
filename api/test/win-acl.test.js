/* The Windows access-list check: what counts as "broad", the real Windows listing, and the start-up
   warning. The listing and the warning need Windows (they read NTFS access lists), so they run
   there; the classification is plain logic and runs everywhere. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isBroadSid, broadAccess, accessSids } from '../win-acl.js';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { skip: process.platform !== 'win32' ? 'reads NTFS access lists: Windows only' : false };

test('which identities count as broad', () => {
  for (const sid of ['S-1-1-0', 'S-1-5-11', 'S-1-5-32-545', 'S-1-5-32-546', 'S-1-5-7', 'S-1-5-21-111-222-333-513', 'S-1-5-21-111-222-333-514'])
    assert.equal(isBroadSid(sid), true, sid);
  for (const sid of ['S-1-5-18', 'S-1-5-32-544', 'S-1-5-21-111-222-333-1001', 'S-1-5-21-111-222-333-500', 'S-1-3-0', ''])
    assert.equal(isBroadSid(sid), false, sid);
});

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acl-test-'));
const grantBroad = dir => execFileSync('icacls', [dir, '/grant', '*S-1-5-11:(OI)(CI)R'], { stdio: 'ignore' });

test('Windows: a private folder lists no broad group, and one granted to Authenticated Users does', win, async t => {
  const dir = mkdir(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'f.json'); fs.writeFileSync(file, '{}', { mode: 0o600 });
  assert.deepEqual(await broadAccess(file), [], 'a file in the user\'s own temp folder inherits a private list');
  assert.ok((await accessSids(file)).includes('S-1-5-18'), 'SYSTEM is listed: SIDs come back, not localised names');
  grantBroad(dir);
  const after = path.join(dir, 'g.json'); fs.writeFileSync(after, '{}');
  assert.deepEqual([...new Set(await broadAccess(after))], ['S-1-5-11'], 'a new file inherits the broad grant, and it is reported');
});

test('Windows: a failing listing is an error, never "nothing broad"', win, async () => {
  await assert.rejects(accessSids(path.join(os.tmpdir(), 'does-not-exist-' + Date.now())));
  await assert.rejects(broadAccess('x', { run: (c, a, o, cb) => cb(new Error('boom'), '') }));
});

async function bootLog(dataDir) {
  const child = spawn(process.execPath, ['server.js'], { cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', AUDIT_LOG: '0' } });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  try { await boundPort(child, () => log); await new Promise(r => setTimeout(r, 2500)); } finally { child.kill('SIGKILL'); }
  return log;
}

test('Windows: the server warns once at start when its data folder is open to a broad group, and says nothing when it is not', win, async t => {
  const priv = mkdir(), open = mkdir();
  t.after(() => { for (const d of [priv, open]) fs.rmSync(d, { recursive: true, force: true }); });
  grantBroad(open);
  const quiet = await bootLog(priv);
  assert.ok(!/can be used by other Windows accounts/.test(quiet), quiet);
  const loud = await bootLog(open);
  assert.equal((loud.match(/can be used by other Windows accounts/g) || []).length, 1, loud);
  assert.match(loud, /icacls /);
  assert.ok(!/secret|[0-9a-f]{64}/i.test(loud.replace(/session secret/g, '')), 'the warning names no secret');
});
