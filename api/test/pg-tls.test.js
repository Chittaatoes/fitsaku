/* PostgreSQL TLS: the certificate is always verified, and nothing quietly relaxes that.
   Pure configuration rules (dbConnectionConfig), then live handshakes against a TLS front for a real
   PostgreSQL engine (PGlite): a good certificate works end to end, and a certificate from another CA,
   one for another host name, and a server that refuses TLS are all refused. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFileSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { dbConnectionConfig, poolFromEnv, openPgStore } from '../pg-store.js';

let openssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { openssl = false; }
const needsOpenssl = { skip: openssl ? false : 'openssl is not installed: NOT RUN' };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-tls-'));
const sh = (...a) => execFileSync('openssl', a, { cwd: tmp, stdio: 'ignore' });
function ca(name) {
  sh('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.crt', '-subj', '/CN=' + name, '-days', '2');
  return fs.readFileSync(path.join(tmp, name + '.crt'), 'utf8');
}
function leaf(name, caName, san) {
  fs.writeFileSync(path.join(tmp, name + '.ext'), 'subjectAltName=' + san + '\n');
  sh('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', name + '.key', '-out', name + '.csr', '-subj', '/CN=' + name);
  sh('x509', '-req', '-in', name + '.csr', '-CA', caName + '.crt', '-CAkey', caName + '.key', '-CAcreateserial', '-out', name + '.crt', '-days', '2', '-extfile', name + '.ext');
  return { cert: fs.readFileSync(path.join(tmp, name + '.crt')), key: fs.readFileSync(path.join(tmp, name + '.key')) };
}

const URL_OK = 'postgres://postgres:pw@db.example.supabase.test:5432/postgres';
const FAKE_CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

// ---- configuration rules ----
test('no CA configured: start-up is refused with a message that names the variable and no secret', () => {
  assert.throws(() => dbConnectionConfig({ DATABASE_URL: URL_OK }), e => /DATABASE_SSL_CA/.test(e.message) && !/pw|postgres:\/\//.test(e.message));
  assert.throws(() => dbConnectionConfig({ DATABASE_URL: URL_OK, DATABASE_SSL_CA_FILE: '/no/such/file' }), /DATABASE_SSL_CA_FILE cannot be read/);
});
test('a CA that is not a certificate, or cannot be parsed, is refused', () => {
  assert.throws(() => dbConnectionConfig({ DATABASE_URL: URL_OK, DATABASE_SSL_CA: 'hello' }), /PEM certificate/);
  assert.throws(() => dbConnectionConfig({ DATABASE_URL: URL_OK, DATABASE_SSL_CA: FAKE_CA }), /cannot be parsed/);
});
test('an expired CA is refused', needsOpenssl, () => {
  const pem = ca('exp');
  assert.throws(() => dbConnectionConfig({ DATABASE_URL: URL_OK, DATABASE_SSL_CA: pem }, Date.parse('2100-01-01')), /expired/);
});
test('a valid CA gives verification on: chain checked, TLS 1.2+, nothing overridden', needsOpenssl, () => {
  const pem = ca('good');
  const c = dbConnectionConfig({ DATABASE_URL: URL_OK, DATABASE_SSL_CA: pem });
  assert.equal(c.mode, 'verify-full'); assert.equal(c.ssl.rejectUnauthorized, true); assert.equal(c.ssl.minVersion, 'TLSv1.2');
  assert.ok(c.ssl.ca.includes('BEGIN CERTIFICATE')); assert.equal(c.host, 'db.example.supabase.test');
  assert.equal(c.ssl.checkServerIdentity, undefined, 'Node default host-name check is left in place');
  // an env-escaped PEM (\n as two characters, as some dashboards store it) works too
  assert.equal(dbConnectionConfig({ DATABASE_URL: URL_OK, DATABASE_SSL_CA: pem.replace(/\n/g, '\\n') }).mode, 'verify-full');
});
test('nothing in the URL or environment can relax it', needsOpenssl, () => {
  const pem = ca('good2'); const env = { DATABASE_URL: URL_OK, DATABASE_SSL_CA: pem };
  for (const q of ['sslmode=disable', 'sslmode=require', 'sslmode=no-verify', 'ssl=false', 'sslrootcert=system', 'uselibpqcompat=true']) {
    assert.throws(() => dbConnectionConfig({ ...env, DATABASE_URL: URL_OK + '?' + q }), /must not contain/, q);
  }
  assert.throws(() => dbConnectionConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /NODE_TLS_REJECT_UNAUTHORIZED/);
  assert.throws(() => dbConnectionConfig({ ...env, DATABASE_TLS: 'off' }), /DATABASE_TLS must be/);
  assert.throws(() => dbConnectionConfig({ ...env, DATABASE_TLS: 'insecure-local' }), /loopback/, 'a remote host never qualifies');
});
test('insecure-local exists for a local database only and is refused in production', () => {
  const local = { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db', DATABASE_TLS: 'insecure-local' };
  assert.equal(dbConnectionConfig(local).ssl, false);
  assert.throws(() => dbConnectionConfig({ ...local, NODE_ENV: 'production' }), /refused in production/);
  assert.throws(() => dbConnectionConfig({ ...local, RENDER: 'true' }), /refused in production/);
  assert.throws(() => dbConnectionConfig({ ...local, RENDER_SERVICE_ID: 'srv-1' }), /refused in production/);
  // and without the explicit flag even localhost is verified, not skipped
  assert.throws(() => dbConnectionConfig({ DATABASE_URL: local.DATABASE_URL }), /DATABASE_SSL_CA/);
});
test('no DATABASE_URL means file storage, not a default database', () => { assert.equal(dbConnectionConfig({}), null); });

// ---- live handshakes ----
async function tlsFront(t, { cert, key }, { refuse = false } = {}) {
  const pg = new PGlite();
  const back = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1', maxConnections: 10 });
  await back.start();
  const backPort = back.server?.address?.()?.port;
  const ctx = tls.createSecureContext({ cert, key });
  const front = net.createServer(sock => {
    sock.once('data', () => {
      if (refuse) { sock.end('N'); return; }                         // "I do not speak TLS"
      sock.write('S');
      const secure = new tls.TLSSocket(sock, { isServer: true, secureContext: ctx });
      secure.on('error', () => {});
      const up = net.connect(backPort, '127.0.0.1');
      up.on('error', () => secure.destroy());
      secure.pipe(up); up.pipe(secure);
    });
    sock.on('error', () => {});
  });
  await new Promise(r => front.listen(0, '127.0.0.1', r));
  t.after(() => { front.close(); back.stop().catch(() => {}); });
  return front.address().port;
}
const envFor = (port, caPem) => ({ DATABASE_URL: `postgres://postgres:pw@127.0.0.1:${port}/postgres`, DATABASE_SSL_CA: caPem });

test('a certificate from the configured CA for this host: connection verified, migrations and writes work', needsOpenssl, async t => {
  const caPem = ca('trusted'); const server = leaf('srv-ok', 'trusted', 'IP:127.0.0.1');
  const port = await tlsFront(t, server);
  const pool = await poolFromEnv(envFor(port, caPem)); t.after(() => pool.end().catch(() => {}));
  assert.equal(pool.tlsMode, 'verify-full');
  const store = await openPgStore({ pool, log: { error() {}, log() {} } });
  assert.equal(await store.putState('u1', JSON.stringify({ _rev: 1, workouts: [] }), { expectedRev: 0, rev: 1 }), true);
  assert.equal((await pool.query('select count(*)::int as n from user_state')).rows[0].n, 1);
  const tlsUsed = (await pool.query('select 1 as ok')).rows[0].ok; assert.equal(tlsUsed, 1);
});
test('a certificate from a different CA is refused', needsOpenssl, async t => {
  ca('other'); const server = leaf('srv-other', 'other', 'IP:127.0.0.1'); const trusted = ca('trusted-b');
  const port = await tlsFront(t, server);
  const pool = await poolFromEnv(envFor(port, trusted)); t.after(() => pool.end().catch(() => {}));
  await assert.rejects(pool.query('select 1'), e => /self.signed|unable to verify|issuer|certificate/i.test(e.message + e.code));
});
test('a certificate for a different host name is refused even when the CA is trusted', needsOpenssl, async t => {
  const caPem = ca('trusted-c'); const server = leaf('srv-name', 'trusted-c', 'DNS:db.somewhere-else.test');
  const port = await tlsFront(t, server);
  const pool = await poolFromEnv(envFor(port, caPem)); t.after(() => pool.end().catch(() => {}));
  await assert.rejects(pool.query('select 1'), e => /altname|hostname|does not match|IP: 127.0.0.1/i.test(e.message + e.code));
});
test('a server that refuses TLS is not talked to in plaintext', needsOpenssl, async t => {
  const caPem = ca('trusted-d'); const server = leaf('srv-n', 'trusted-d', 'IP:127.0.0.1');
  const port = await tlsFront(t, server, { refuse: true });
  const pool = await poolFromEnv(envFor(port, caPem)); t.after(() => pool.end().catch(() => {}));
  await assert.rejects(pool.query('select 1'), /does not support SSL/i);
});
test('start-up of the real server fails with a clear, secret-free message when TLS is misconfigured', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['server.js'], {
    cwd: path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..'),
    env: { ...process.env, PORT: '0', DATA_DIR: tmp, DATABASE_URL: 'postgres://postgres:SuperSecretPw@db.example.supabase.test:5432/postgres', DATABASE_SSL_CA: '', DATABASE_SSL_CA_FILE: '', DATABASE_TLS: '' },
    encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /FATAL: database start-up failed: DATABASE_SSL_CA/);
  assert.ok(!/SuperSecretPw/.test(r.stderr + r.stdout));
});
