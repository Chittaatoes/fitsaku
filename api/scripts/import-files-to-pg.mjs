#!/usr/bin/env node
// One-way, repeatable import of a file-backed data directory (db.json, state-*.json, ...) into
// PostgreSQL. Read-only on the source: nothing in DATA_DIR is changed or deleted.
//
//   node scripts/import-files-to-pg.mjs --data ./data                 # dry run (default): validate + counts
//   node scripts/import-files-to-pg.mjs --data ./data --apply         # write, refusing a non-empty database
//   node scripts/import-files-to-pg.mjs --data ./data --apply --force # replace what the database holds
//   add --with-secret to also import the session secret (keeps users signed in; do not use it
//   when SESSION_SECRET is set in the environment)
//
// DATABASE_URL (and DATABASE_SSL / DATABASE_SSL_CA) are read from the environment, never from
// arguments, so the connection string does not end up in shell history.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runMigrations, poolFromEnv } from '../pg-store.js';

const safeId = s => /^[a-zA-Z0-9_-]+$/.test(s);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Reads and validates the directory. Throws with every problem found, imports nothing. */
export function readDataDir(dir, { withSecret = false } = {}) {
  const problems = [];
  const out = { db: null, states: [], audit: [], kv: [], secrets: [] };
  const dbFile = path.join(dir, 'db.json');
  if (fs.existsSync(dbFile)) {
    try {
      const v = readJson(dbFile);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
      out.db = { users: [], creds: [], subs: [], invites: [], deviceLinks: [], ...v };
    } catch (e) { problems.push(`db.json: ${e.message}`); }
  } else problems.push('db.json is missing: there is nothing to import users from');
  for (const f of fs.readdirSync(dir)) {
    const m = /^state-(.+)\.json$/.exec(f);
    if (!m) continue;
    if (!safeId(m[1])) { problems.push(`${f}: unusual profile id, skipped`); continue; }
    try {
      const S = readJson(path.join(dir, f));
      if (!S || typeof S !== 'object' || Array.isArray(S)) throw new Error('not an object');
      out.states.push({ uid: m[1], rev: Number(S._rev) || 0, wid: typeof S._wid === 'string' ? S._wid : null, body: S });
    } catch (e) { problems.push(`${f}: ${e.message}`); }
  }
  if (out.db) {
    const known = new Set(out.db.users.map(u => u.id));
    for (const s of out.states) if (!known.has(s.uid)) problems.push(`state-${s.uid}.json has no user in db.json (orphan, imported anyway)`);
  }
  const auditFile = path.join(dir, 'audit.log');
  if (fs.existsSync(auditFile)) {
    for (const line of fs.readFileSync(auditFile, 'utf8').split('\n')) {
      if (!line) continue;
      try { const r = JSON.parse(line); if (r && r.id && r.ev) out.audit.push(r); } catch { /* a torn last line */ }
    }
  }
  const coach = path.join(dir, 'coach.json');
  if (fs.existsSync(coach)) { try { readJson(coach); out.kv.push({ name: 'coach.json', body: fs.readFileSync(coach, 'utf8') }); } catch (e) { problems.push(`coach.json: ${e.message}`); } }
  const coachDir = path.join(dir, 'coach');
  if (fs.existsSync(coachDir)) {
    for (const f of fs.readdirSync(coachDir)) {
      if (!f.endsWith('.json') || !safeId(f.slice(0, -5))) continue;
      try { readJson(path.join(coachDir, f)); out.kv.push({ name: 'coach/' + f, body: fs.readFileSync(path.join(coachDir, f), 'utf8') }); } catch (e) { problems.push(`coach/${f}: ${e.message}`); }
    }
  }
  const vapid = path.join(dir, 'vapid.json');
  if (fs.existsSync(vapid)) { try { readJson(vapid); out.secrets.push({ name: 'vapid', value: fs.readFileSync(vapid, 'utf8').trim() }); } catch (e) { problems.push(`vapid.json: ${e.message}`); } }
  if (withSecret && fs.existsSync(path.join(dir, 'secret'))) out.secrets.push({ name: 'session', value: fs.readFileSync(path.join(dir, 'secret'), 'utf8').trim() });
  return { data: out, problems };
}

const count = async (pool, table) => Number((await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n);

export async function importFiles({ dir, pool, apply = false, force = false, withSecret = false, log = console.log }) {
  const { data, problems } = readDataDir(dir, { withSecret });
  const fatal = problems.filter(p => !/orphan|skipped/.test(p));
  const report = {
    source: { users: data.db?.users.length ?? 0, credentials: data.db?.creds.length ?? 0, subscriptions: data.db?.subs.length ?? 0, invites: data.db?.invites.length ?? 0,
      states: data.states.length, workouts: data.states.reduce((n, s) => n + (Array.isArray(s.body.workouts) ? s.body.workouts.length : 0), 0), audit: data.audit.length, coach: data.kv.length },
    problems, applied: false,
  };
  if (fatal.length) { report.error = 'source has problems; nothing imported'; return report; }
  if (!apply) { log('dry run: nothing written'); return report; }
  await runMigrations(pool);
  const existing = { users_db: await count(pool, 'app_documents'), states: await count(pool, 'user_state') };
  if ((existing.users_db || existing.states) && !force) {
    report.error = `the database already holds data (${existing.states} profile documents); re-run with --force to replace it`;
    return report;
  }
  if (force) for (const t of ['user_state', 'app_documents', 'audit_events', 'kv_documents']) await pool.query(`delete from ${t}`);
  await pool.query("insert into app_documents (name, body) values ('db', $1::jsonb) on conflict (name) do update set body = excluded.body, version = app_documents.version + 1", [JSON.stringify(data.db)]);
  for (const s of data.states) {
    await pool.query('insert into user_state (user_id, rev, wid, body) values ($1,$2,$3,$4::jsonb) on conflict (user_id) do update set rev = excluded.rev, wid = excluded.wid, body = excluded.body, updated_at = now()', [s.uid, s.rev, s.wid, JSON.stringify(s.body)]);
  }
  for (const r of data.audit) await pool.query('insert into audit_events (id, ts, body) values ($1,$2,$3::jsonb) on conflict (id) do nothing', [r.id, r.ts || 0, JSON.stringify(r)]);
  for (const k of data.kv) await pool.query('insert into kv_documents (name, body) values ($1,$2) on conflict (name) do update set body = excluded.body', [k.name, k.body]);
  for (const s of data.secrets) await pool.query('insert into app_secrets (name, value) values ($1,$2) on conflict (name) do update set value = excluded.value', [s.name, s.value]);

  // Consistency check against what is now in the database, not against what was meant to go in.
  const dbDoc = (await pool.query("select body from app_documents where name = 'db'")).rows[0].body;
  const after = { users: dbDoc.users.length, credentials: dbDoc.creds.length, states: await count(pool, 'user_state'), audit: await count(pool, 'audit_events') };
  const mismatches = [];
  if (after.users !== report.source.users) mismatches.push(`users ${report.source.users} -> ${after.users}`);
  if (after.credentials !== report.source.credentials) mismatches.push(`credentials ${report.source.credentials} -> ${after.credentials}`);
  if (after.states !== report.source.states) mismatches.push(`profile documents ${report.source.states} -> ${after.states}`);
  const stored = (await pool.query('select coalesce(sum(jsonb_array_length(case when jsonb_typeof(body->\'workouts\') = \'array\' then body->\'workouts\' else \'[]\'::jsonb end)),0)::int as n from user_state')).rows[0].n;
  if (Number(stored) !== report.source.workouts) mismatches.push(`workouts ${report.source.workouts} -> ${stored}`);
  report.applied = true; report.after = after; report.mismatches = mismatches;
  if (mismatches.length) report.error = 'row counts differ after the import: ' + mismatches.join('; ');
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const opt = n => args.includes(n);
  const dir = path.resolve(args[args.indexOf('--data') + 1] || process.env.DATA_DIR || './data');
  const pool = await poolFromEnv();
  if (!pool) { console.error('DATABASE_URL is not set'); process.exit(2); }
  try {
    const report = await importFiles({ dir, pool, apply: opt('--apply'), force: opt('--force'), withSecret: opt('--with-secret') });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.error ? 1 : 0;
  } finally { await pool.end(); }
}
