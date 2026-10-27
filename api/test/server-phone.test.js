/* Phone number + 4-digit PIN sign-in (PHONE_LOGIN=1): number folding, PIN policy, register and sign in,
   that a wrong PIN says nothing about whether the number exists, the persistent lockout (it survives a
   restart), that the PIN is never stored in the clear and is useless without the server secret, invite-only
   signup, and changing the PIN. Real server.js in a child on file storage. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { normalizePhone, pinProblem, pinLockSeconds, maskPhone, pinSecret } from '../phone-pin.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8080';
let n = 0;
const ip = () => `10.9.${(n >> 8) & 255}.${++n & 255}`;

async function boot(t, { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-phone-')), env = {} } = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', TRUST_PROXY: '1', PHONE_LOGIN: '1', INVITE_ONLY: '', ...env },
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  const exited = new Promise(r => child.once('exit', r));
  t.after(() => child.kill('SIGKILL'));
  const url = `http://127.0.0.1:${await boundPort(child, () => log)}`;
  return { url, dataDir, kill: () => { child.kill('SIGKILL'); return exited; }, log: () => log };
}
async function call(api, method, p, { body, cookie, from = ip() } = {}) {
  const r = await fetch(api.url + p, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-For': from, ...(cookie ? { Cookie: cookie } : {}) },
  });
  const set = r.headers.getSetCookie?.()[0] || '';
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, body: json, cookie: set.split(';')[0], retry: r.headers.get('retry-after') };
}
const signup = (api, over = {}) => call(api, 'POST', '/api/register/phone', { body: { name: 'Ana', phone: '0812 3456 7890', pin: '4827', ...over } });
const signin = (api, phone, pin, from) => call(api, 'POST', '/api/login/phone', { body: { phone, pin }, from });

test('phone numbers fold to one form; the PIN policy and lock schedule', () => {
  for (const v of ['0812 3456 7890', '081234567890', '+62 812-3456-7890', '6281234567890', '006281234567890', '(0812) 3456 7890']) assert.equal(normalizePhone(v), '+6281234567890', v);
  assert.equal(normalizePhone('+1 415 555 2671'), '+14155552671');
  assert.equal(normalizePhone('0415552671', '61'), '+61415552671', 'the default country is configurable');
  for (const v of ['', 'abc', '12', '+0123456789', '8123456789', '0'.repeat(20), '081234-ext5', null, {}]) assert.equal(normalizePhone(v), null, String(v));
  for (const p of ['4827', '9031', '0579']) assert.equal(pinProblem(p), null, p);
  for (const p of ['0000', '1111', '1234', '4321', '0123', '9876', '1212', '2580']) assert.equal(pinProblem(p), 'pin-weak', p);
  for (const p of ['123', '12345', 'abcd', '12 4', '', undefined, 1234]) assert.equal(pinProblem(p), 'pin-format', String(p));
  assert.deepEqual([1, 4, 5, 6, 7, 10, 15].map(pinLockSeconds), [0, 0, 300, 900, 3600, 21600, 86400]);
  assert.equal(maskPhone('+6281234567890'), '+62********890');
  assert.notEqual(pinSecret('s', 'u1', '4827'), pinSecret('s', 'u2', '4827'));
  assert.notEqual(pinSecret('s1', 'u1', '4827'), pinSecret('s2', 'u1', '4827'));
});

test('the routes do not exist unless PHONE_LOGIN is on, and the config says so', async t => {
  const off = await boot(t, { env: { PHONE_LOGIN: '' } });
  assert.equal((await signup(off)).status, 404);
  assert.equal((await call(off, 'GET', '/api/config')).body.phone_login, undefined);
  const on = await boot(t);
  assert.equal((await call(on, 'GET', '/api/config')).body.phone_login, true);
});

test('register with a phone number and PIN, then sign in with any spelling of the number', async t => {
  const api = await boot(t);
  const r = await signup(api);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.user.name, 'Ana'); assert.ok(r.cookie.startsWith('gymsid='));
  assert.equal((await call(api, 'GET', '/api/me', { cookie: r.cookie })).status, 200);
  for (const v of ['081234567890', '+6281234567890', '6281234567890', '0812-3456-7890']) {
    const s = await signin(api, v, '4827');
    assert.equal(s.status, 200, v); assert.ok(s.cookie.startsWith('gymsid='));
  }
  // refusals
  assert.equal((await signup(api, { name: 'Budi' })).status, 409, 'the number is taken');
  assert.equal((await signup(api, { name: 'Budi', phone: '0899', pin: '4827' })).body.code, 'phone-invalid');
  assert.equal((await signup(api, { name: 'Budi', phone: '0899 111 2222', pin: '1234' })).body.code, 'pin-weak');
  assert.equal((await signup(api, { name: 'Budi', phone: '0899 111 2222', pin: '48' })).body.code, 'pin-format');
  assert.equal((await signup(api, { name: 'Budi', phone: '0899 111 2222', pin: undefined })).status, 400, 'no PIN');
  // a display name is not a sign-in name here, so two people may share one
  assert.equal((await signup(api, { name: 'Ana', phone: '0899 111 2222' })).status, 200);
});

test('a wrong PIN, an unknown number and a malformed request look alike; nothing says whether the number exists', async t => {
  const api = await boot(t);
  await signup(api);
  const wrong = await signin(api, '0812 3456 7890', '1357');
  const unknown = await signin(api, '0877 0000 1111', '1357');
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.body, unknown.body);
  assert.equal((await signin(api, '0812 3456 7890', '12')).status, 400);
  assert.equal((await call(api, 'POST', '/api/login/phone', { body: { phone: '0812 3456 7890' } })).status, 400);
});

test('five wrong PINs pause the account, the pause survives a restart, and the right PIN is refused meanwhile', async t => {
  let api = await boot(t);
  await signup(api);
  for (let i = 0; i < 5; i++) assert.equal((await signin(api, '0812 3456 7890', '000' + i)).status, 401);
  const paused = await signin(api, '0812 3456 7890', '4827');
  assert.equal(paused.status, 429); assert.ok(+paused.retry > 0);
  const dir = api.dataDir;
  await api.kill();
  api = await boot(t, { dataDir: dir });                                   // a restart gives no fresh allowance
  const still = await signin(api, '0812 3456 7890', '4827');
  assert.equal(still.status, 429, 'the counter is on the account record, not in memory');
  const user = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')).users[0];
  assert.equal(user.pin.n, 5); assert.ok(user.pin.until > Date.now());
});

test('a good PIN clears the count; a few slips do not pause anybody', async t => {
  const api = await boot(t);
  await signup(api);
  for (let i = 0; i < 3; i++) await signin(api, '0812 3456 7890', '9999');
  assert.equal((await signin(api, '0812 3456 7890', '4827')).status, 200);
  const user = JSON.parse(fs.readFileSync(path.join(api.dataDir, 'db.json'), 'utf8')).users[0];
  assert.equal(user.pin.n, 0);
});

test('guessing at unknown numbers is paused too, and one address cannot sweep through accounts', async t => {
  const api = await boot(t);
  const from = ip();
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await signin(api, '0877 0000 1111', '1357', from)).status);
  assert.ok(codes.includes(429), codes.join());
});

test('the PIN is never stored in the clear, and the stored value cannot be tested without the server secret', async t => {
  const api = await boot(t);
  await signup(api);
  await signup(api, { name: 'Budi', phone: '0877 1111 2222' });          // the same PIN, another account
  const raw = fs.readFileSync(path.join(api.dataDir, 'db.json'), 'utf8');
  const users = JSON.parse(raw).users;
  assert.ok(!raw.includes('4827'), 'the PIN is nowhere in the database');
  assert.ok(users.every(u => u.pin.h.startsWith('$scrypt$')));
  assert.notEqual(users[0].pin.h, users[1].pin.h);
  assert.equal(users[0].phone, '+6281234567890');
  // the bare PIN does not verify against the stored hash: it was keyed with the secret first
  const { verifyPassword } = await import('../password.js');
  assert.equal(await verifyPassword('4827', users[0].pin.h), false);
  const secret = fs.readFileSync(path.join(api.dataDir, 'secret'), 'utf8').trim();
  assert.equal(await verifyPassword(pinSecret(secret, users[0].id, '4827'), users[0].pin.h), true);
  assert.ok(!/4827|081234567890/.test(api.log()), 'neither the PIN nor the number is logged');
});

test('invite-only: no code, no account; a valid code works once', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-phone-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), 'a'.repeat(64));
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: [{ id: 'adm', name: 'Admin', admin: true, created: new Date().toISOString() }], creds: [], subs: [], invites: [{ code: 'GOODCODE', created: new Date().toISOString() }] }));
  const api = await boot(t, { dataDir, env: { INVITE_ONLY: '1' } });
  assert.equal((await signup(api)).status, 403);
  assert.equal((await signup(api, { code: 'WRONGONE' })).status, 403);
  const ok = await signup(api, { code: 'GOODCODE' });
  assert.equal(ok.status, 200);
  assert.equal((await call(api, 'GET', '/api/me', { cookie: ok.cookie })).body.user.admin, false);
  assert.equal((await signup(api, { name: 'Budi', phone: '0877 1111 2222', code: 'GOODCODE' })).status, 403, 'single use');
});

test('changing the PIN needs the current one, ends other sessions, and the old PIN stops working', async t => {
  const api = await boot(t);
  const first = await signup(api);
  const other = await signin(api, '0812 3456 7890', '4827');
  assert.equal((await call(api, 'POST', '/api/account/pin', { body: { current: '4827', pin: '2468' } })).status, 401, 'no session');
  assert.equal((await call(api, 'POST', '/api/account/pin', { cookie: first.cookie, body: { current: '1357', pin: '9031' } })).status, 401, 'wrong current');
  assert.equal((await call(api, 'POST', '/api/account/pin', { cookie: first.cookie, body: { current: '4827', pin: '1234' } })).body.code, 'pin-weak');
  const changed = await call(api, 'POST', '/api/account/pin', { cookie: first.cookie, body: { current: '4827', pin: '9031' } });
  assert.equal(changed.status, 200);
  assert.equal((await call(api, 'GET', '/api/me', { cookie: other.cookie })).status, 401, 'the other session is gone');
  assert.equal((await call(api, 'GET', '/api/me', { cookie: changed.cookie })).status, 200, 'the caller gets a fresh one');
  assert.equal((await signin(api, '0812 3456 7890', '4827')).status, 401);
  assert.equal((await signin(api, '0812 3456 7890', '9031')).status, 200);
});
