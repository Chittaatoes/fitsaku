// PostgreSQL storage for the API (Supabase, or any PostgreSQL 13+).
//
// The API is synchronous on purpose (api/server.js reads and mutates one in-memory user database
// and one document per profile). Rather than rewrite 3,000 lines around async calls, this store
// keeps the same shape:
//
//   * at boot everything durable is loaded into memory (`openPgStore`), so every read stays
//     synchronous and cheap;
//   * every write goes to PostgreSQL before the HTTP answer that reports it leaves the process:
//     profile documents are written with `putState` (awaited, compare-and-swap on the revision),
//     the other documents are queued and flushed, and `json()` in server.js waits for `flush()`
//     before it answers whenever something is queued (`dirty`);
//   * a failed write is never dropped: it stays queued and is retried, and the request that
//     depended on it is answered 503 (the client keeps its own copy and syncs again).
//
// Assumption, stated plainly: ONE API instance writes at a time (Render: one web service, no
// autoscaling). Profile documents are protected anyway by the conditional write; the user
// database document by `version` (a second writer is refused and the process exits so the
// platform restarts it on fresh data) rather than silently overwriting.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** `pool` is anything with `query(text, params)` — a `pg.Pool` or a PGlite instance. */
export async function runMigrations(pool, dir = MIGRATIONS_DIR) {
  const exec = typeof pool.exec === 'function' ? t => pool.exec(t) : t => pool.query(t);
  await exec('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select id from schema_migrations')).rows.map(r => r.id));
  const applied = [];
  for (const f of fs.readdirSync(dir).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    // One multi-statement string runs in a single implicit transaction (simple protocol), so a
    // failing migration leaves nothing half-applied and is not recorded.
    await exec(`begin;\n${sql}\ninsert into schema_migrations (id) values ('${f.replace(/'/g, "''")}');\ncommit;`);
    applied.push(f);
  }
  return applied;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * The connection settings for DATABASE_URL, with TLS that is VERIFIED or nothing.
 *
 *  - The server certificate chain is checked against an explicitly configured CA
 *    (DATABASE_SSL_CA, PEM text, or DATABASE_SSL_CA_FILE, a path): Supabase's own CA, downloaded
 *    from the dashboard (Database > Settings > SSL Configuration). The host name in DATABASE_URL
 *    is checked against the certificate by Node's default identity check (nothing overrides it).
 *  - No CA configured, an unreadable or expired one, a URL that carries its own `sslmode`
 *    (pg lets the URL override the options passed beside it), or NODE_TLS_REJECT_UNAUTHORIZED=0:
 *    startup fails with a message that names the variable, never a value.
 *  - The one way to skip TLS is DATABASE_TLS=insecure-local, and only for a loopback host outside
 *    production (NODE_ENV=production or any Render service refuses it). It cannot be inherited by
 *    a real database: a remote host never qualifies, whatever the variables say.
 * Pure: returns the settings, opens nothing, so it is testable without a database.
 */
export function dbConnectionConfig(env = process.env, now = Date.now()) {
  const raw = env.DATABASE_URL;
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error('DATABASE_URL is not a valid connection URL'); }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('DATABASE_URL must start with postgres:// or postgresql://');
  const host = url.hostname;
  // pg gives the URL's own ssl parameters precedence over the options passed beside it, so a stray
  // `?sslmode=disable` would silently switch verification off. None is accepted.
  for (const k of ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'sslcompression']) {
    if (url.searchParams.has(k)) throw new Error(`DATABASE_URL must not contain "${k}": TLS is configured only with DATABASE_SSL_CA (see docs/DEPLOYMENT.md)`);
  }
  const production = env.NODE_ENV === 'production' || !!env.RENDER || !!env.RENDER_SERVICE_ID;
  const insecureLocal = String(env.DATABASE_TLS || '').toLowerCase() === 'insecure-local';
  if (String(env.DATABASE_TLS || '') && !insecureLocal && String(env.DATABASE_TLS).toLowerCase() !== 'verify-full') {
    throw new Error('DATABASE_TLS must be unset, "verify-full" or (local development only) "insecure-local"');
  }
  const base = {
    host: LOOPBACK.has(host) ? host.replace(/^\[|\]$/g, '') : host,
    port: url.port ? +url.port : 5432,
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
  };
  if (insecureLocal) {
    if (production) throw new Error('DATABASE_TLS=insecure-local is refused in production');
    if (!LOOPBACK.has(host)) throw new Error('DATABASE_TLS=insecure-local only works for a loopback database host');
    return { ...base, ssl: false, mode: 'insecure-local' };
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate checking and is refused; remove it');
  let ca = env.DATABASE_SSL_CA ? String(env.DATABASE_SSL_CA).replace(/\\n/g, '\n') : '';
  if (!ca && env.DATABASE_SSL_CA_FILE) {
    try { ca = fs.readFileSync(env.DATABASE_SSL_CA_FILE, 'utf8'); }
    catch { throw new Error('DATABASE_SSL_CA_FILE cannot be read'); }
  }
  if (!ca.trim()) throw new Error('DATABASE_SSL_CA (or DATABASE_SSL_CA_FILE) is required: the database certificate is always verified. Download the CA certificate from the Supabase dashboard (docs/DEPLOYMENT.md)');
  const certs = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  if (!certs) throw new Error('DATABASE_SSL_CA does not contain a PEM certificate');
  for (const pem of certs) {
    let x;
    try { x = new crypto.X509Certificate(pem); } catch { throw new Error('DATABASE_SSL_CA contains a certificate that cannot be parsed'); }
    if (Date.parse(x.validTo) < now) throw new Error('DATABASE_SSL_CA contains an expired certificate; download the current one');
  }
  return { ...base, ssl: { ca: certs.join('\n'), rejectUnauthorized: true, minVersion: 'TLSv1.2' }, mode: 'verify-full' };
}

/** A pg.Pool for DATABASE_URL (see dbConnectionConfig for the TLS rules). `pg` is a dependency. */
export async function poolFromEnv(env = process.env) {
  const cfg = dbConnectionConfig(env);
  if (!cfg) return null;
  const { mode, ...conn } = cfg;
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({
    ...conn,
    max: Math.max(1, +env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
  });
  pool.tlsMode = mode;
  // An idle client dropping must not take the process down; the pool replaces it.
  pool.on('error', e => console.error('postgres pool error:', e.message));
  return pool;
}

const num = v => (v == null ? 0 : Number(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function openPgStore({ pool, log = console, onFatal = () => {}, onDbReload = () => {}, retryMs = 2000 } = {}) {
  await runMigrations(pool);

  // ---- load everything into memory ----
  const dbRow = (await pool.query("select body, version from app_documents where name = 'db'")).rows[0];
  const dbDoc = dbRow ? dbRow.body : null;
  let dbVersion = dbRow ? num(dbRow.version) : 0;

  const states = new Map();      // uid -> { text, rev, wid }
  for (const r of (await pool.query('select user_id, rev, wid, body from user_state')).rows) {
    states.set(r.user_id, { text: JSON.stringify(r.body), rev: num(r.rev), wid: r.wid });
  }
  const kv = new Map();
  for (const r of (await pool.query('select name, body from kv_documents')).rows) kv.set(r.name, r.body);
  const secrets = new Map();
  for (const r of (await pool.query('select name, value from app_secrets')).rows) secrets.set(r.name, r.value);
  const auditRows = (await pool.query('select body from audit_events order by id')).rows.map(r => r.body);

  // ---- write queue (everything but profile documents) ----
  let pendingDb = null;                 // text of the user database not yet stored
  let pendingDbHard = false;            // false while everything queued is bookkeeping (last-pull time)
  const pendingKv = new Map();          // name -> text | null (delete)
  let pendingAudit = [];                // rows to insert
  let auditOps = [];                    // { type:'deleteBefore', id } | { type:'clear' }, in order
  const pendingStateDeletes = new Set();
  let draining = null, retryTimer = null, fatal = null;
  // Whether an answer must wait for the queue: true once something a response reports is queued.
  // Bookkeeping writes (a profile's last-pull time, audit rows) are queued but never hold an answer.
  let blocking = false;

  const hasPending = () => pendingDb != null || pendingKv.size > 0 || pendingStateDeletes.size > 0 || pendingAudit.length > 0 || auditOps.length > 0;

  async function writeDb(text) {
    if (dbVersion === 0) {
      const r = await pool.query("insert into app_documents (name, body, version) values ('db', $1::jsonb, 1) on conflict (name) do nothing returning version", [text]);
      if (!r.rows.length) return false;
      dbVersion = 1; return true;
    }
    const r = await pool.query("update app_documents set body = $1::jsonb, version = version + 1, updated_at = now() where name = 'db' and version = $2 returning version", [text, dbVersion]);
    if (!r.rows.length) return false;
    dbVersion = num(r.rows[0].version); return true;
  }

  async function drainOnce() {
    if (pendingDb != null) {
      const text = pendingDb;
      const hard = pendingDbHard;
      if (!(await writeDb(text))) {
        // Another instance saved the user database since this one read it. If all this instance
        // had to say was bookkeeping (a last-pull time) nothing is lost by taking the other copy
        // instead; anything else (a sign-in, an invite, a role) must not be dropped or overwritten.
        if (!hard) {
          const row = (await pool.query("select body, version from app_documents where name = 'db'")).rows[0];
          if (row) {
            dbVersion = num(row.version);
            if (pendingDb === text) { pendingDb = null; pendingDbHard = false; }
            onDbReload(JSON.parse(JSON.stringify(row.body)));
            log.error('postgres: user database changed by another instance; took its copy (bookkeeping only)');
            return;
          }
        }
        fatal = new Error('the user database was changed by another API instance; refusing to overwrite it');
        fatal.code = 'CONFLICT';
        log.error('postgres: ' + fatal.message);
        try { onFatal(fatal); } catch { /* the hook is advisory */ }
        throw fatal;
      }
      if (pendingDb === text) { pendingDb = null; pendingDbHard = false; }
    }
    for (const [name, text] of [...pendingKv]) {
      if (text == null) await pool.query('delete from kv_documents where name = $1', [name]);
      else await pool.query('insert into kv_documents (name, body) values ($1, $2) on conflict (name) do update set body = excluded.body, updated_at = now()', [name, text]);
      if (pendingKv.get(name) === text) pendingKv.delete(name);
    }
    for (const uid of [...pendingStateDeletes]) {
      await pool.query('delete from user_state where user_id = $1', [uid]);
      pendingStateDeletes.delete(uid);
    }
    while (auditOps.length) {
      const op = auditOps[0];
      if (op.type === 'clear') await pool.query('delete from audit_events');
      else await pool.query('delete from audit_events where id < $1', [op.id]);
      auditOps.shift();
    }
    while (pendingAudit.length) {
      const batch = pendingAudit.slice(0, 200);
      for (const r of batch) await pool.query('insert into audit_events (id, ts, body) values ($1, $2, $3::jsonb) on conflict (id) do nothing', [r.id, r.ts, JSON.stringify(r)]);
      pendingAudit = pendingAudit.slice(batch.length);
    }
  }

  function scheduleRetry() {
    if (retryTimer || fatal || !hasPending()) return;
    retryTimer = setTimeout(() => { retryTimer = null; flush().catch(() => {}); }, retryMs);
    retryTimer.unref?.();
  }

  /** Resolves once everything queued so far is stored; rejects (and keeps retrying) if it cannot. */
  function flush() {
    if (fatal) return Promise.reject(fatal);
    if (!hasPending()) return Promise.resolve();
    if (!draining) {
      draining = (async () => {
        try {
          // A write queued while this one runs is picked up by the loop, not left for later.
          while (hasPending()) await drainOnce();
          blocking = false;
        } catch (e) {
          if (e !== fatal) log.error('postgres write failed, will retry:', e.message);
          scheduleRetry();
          throw e;
        } finally { draining = null; }
      })();
    }
    return draining;
  }

  return {
    mode: 'pg',
    migrationsApplied: true,
    get dirty() { return blocking && hasPending(); },
    get queued() { return hasPending(); },
    flush,
    get fatal() { return fatal; },

    // ---- user database ----
    loadDb: () => (dbDoc ? JSON.parse(JSON.stringify(dbDoc)) : null),
    saveDb(obj, { soft = false } = {}) { pendingDb = JSON.stringify(obj); if (!soft) { blocking = true; pendingDbHard = true; } flush().catch(() => {}); },

    // ---- profile documents ----
    stateText: uid => states.get(uid)?.text ?? null,
    stateUids: () => [...states.keys()],
    stateVersion: uid => { const s = states.get(uid); return s ? s.text.length + ':' + s.rev + ':' + (s.wid || '') : null; },
    /** Compare-and-swap on the revision: false when another writer got there first. */
    async putState(uid, text, { expectedRev, rev, wid }) {
      if (fatal) throw fatal;
      let attempt = 0;
      for (;;) {
        try {
          let r;
          if (expectedRev === 0 && !states.has(uid)) {
            r = await pool.query('insert into user_state (user_id, rev, wid, body) values ($1, $2, $3, $4::jsonb) on conflict (user_id) do nothing returning rev', [uid, rev, wid || null, text]);
          } else {
            r = await pool.query('update user_state set rev = $2, wid = $3, body = $4::jsonb, updated_at = now() where user_id = $1 and rev = $5 returning rev', [uid, rev, wid || null, text, expectedRev]);
          }
          if (!r.rows.length) return false;
          states.set(uid, { text, rev, wid: wid || null });
          return true;
        } catch (e) {
          // Only a connection-level failure is retried; the compare-and-swap above is idempotent
          // for the same revision, so repeating it cannot double-apply.
          if (++attempt > 2) throw e;
          await sleep(150 * attempt);
        }
      }
    },
    /** Another instance won a race: take its document into memory. */
    async reloadState(uid) {
      const r = (await pool.query('select rev, wid, body from user_state where user_id = $1', [uid])).rows[0];
      if (r) states.set(uid, { text: JSON.stringify(r.body), rev: num(r.rev), wid: r.wid }); else states.delete(uid);
      return states.get(uid)?.text ?? null;
    },
    /** Account deletion: gone from memory now, from the database before the answer leaves (json() flushes). */
    deleteStateQueued(uid) { states.delete(uid); pendingStateDeletes.add(uid); blocking = true; flush().catch(() => {}); },
    async deleteState(uid) {
      await pool.query('delete from user_state where user_id = $1', [uid]);
      states.delete(uid);
    },

    // ---- secrets (environment first; otherwise generated once and kept here) ----
    secret: name => secrets.get(name) ?? null,
    async ensureSecret(name, make) {
      if (secrets.has(name)) return secrets.get(name);
      const r = await pool.query('insert into app_secrets (name, value) values ($1, $2) on conflict (name) do nothing returning value', [name, make()]);
      // Lost the race to another instance: use the stored value, never our own.
      const v = r.rows[0]?.value ?? (await pool.query('select value from app_secrets where name = $1', [name])).rows[0].value;
      secrets.set(name, v);
      return v;
    },

    // ---- small named documents (Coach) ----
    kvGet: name => kv.get(name) ?? null,
    kvList: prefix => [...kv.keys()].filter(k => k.startsWith(prefix)),
    kvSet(name, text) { kv.set(name, text); pendingKv.set(name, text); blocking = true; flush().catch(() => {}); },
    kvDelete(name) { kv.delete(name); pendingKv.set(name, null); blocking = true; flush().catch(() => {}); },

    // ---- audit log ----
    auditRows: () => auditRows.slice(),
    auditAppend(rec) { auditRows.push(rec); pendingAudit.push(rec); flush().catch(() => {}); },
    auditKeepOnly(rows) {
      const first = rows.length ? rows[0].id : Infinity;
      auditRows.length = 0; auditRows.push(...rows);
      if (first !== Infinity) auditOps.push({ type: 'deleteBefore', id: first }); else auditOps.push({ type: 'clear' });
      flush().catch(() => {});
    },
    auditClear() { auditRows.length = 0; pendingAudit = []; auditOps.push({ type: 'clear' }); flush().catch(() => {}); },

    /** Cheap liveness of the database for /api/health/ready; the caller rate-limits it. */
    async ping() { await pool.query('select 1'); },
    async close() { try { await flush(); } catch { /* reported by flush */ } if (typeof pool.end === 'function') await pool.end(); else if (typeof pool.close === 'function') await pool.close(); },
  };
}
