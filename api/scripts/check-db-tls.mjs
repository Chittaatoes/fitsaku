#!/usr/bin/env node
// Checks, from your machine or a Render shell, that the database connection is VERIFIED TLS:
//   DATABASE_URL=... DATABASE_SSL_CA="$(cat supabase-ca.pem)" node scripts/check-db-tls.mjs
// Prints the TLS mode, the certificate chain result and `select 1`. Never prints the URL or password.
import { dbConnectionConfig, poolFromEnv } from '../pg-store.js';

try {
  const cfg = dbConnectionConfig(process.env);
  if (!cfg) { console.error('DATABASE_URL is not set'); process.exit(2); }
  console.log(`host: ${cfg.host}:${cfg.port}   tls: ${cfg.mode}   verify: ${cfg.ssl ? 'chain + host name' : 'NONE (insecure-local)'}`);
  const pool = await poolFromEnv(process.env);
  const r = await pool.query("select 1 as ok, current_setting('server_version') as version, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl");
  console.log(`connected: ok=${r.rows[0].ok} server=${r.rows[0].version} encrypted=${r.rows[0].ssl}`);
  await pool.end();
  if (cfg.ssl && r.rows[0].ssl !== true) { console.error('FAIL: the session is not encrypted'); process.exit(1); }
} catch (e) {
  console.error('FAIL:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, 'postgres://<redacted>'), e.code ? `(${e.code})` : '');
  process.exit(1);
}
