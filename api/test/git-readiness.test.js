/* scripts/git-readiness.mjs: it must actually find what it claims to look for. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSecrets, sensitiveFilesPresent, ignoreRules } from '../../scripts/git-readiness.mjs';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-ready-'));
const put = (d, rel, text) => { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

test('secret-looking values in committed files are found, placeholders and test fixtures are not', () => {
  const d = dir();
  put(d, 'a.js', 'const k = "-----BEGIN PRIVATE KEY-----"');
  put(d, 'b.yml', 'url: postgres://app:Xk29fjs82hfs@db.abcdefgh.supabase.co:5432/postgres');
  put(d, 'c.env', 'SESSION_SECRET=' + 'a1b2c3d4'.repeat(6));
  put(d, 'ok.md', 'DATABASE_URL=postgres://user:password@host/db and postgres://postgres:pw@127.0.0.1:5432/db');
  put(d, 'test/x.test.js', 'const k = "-----BEGIN PRIVATE KEY-----"');
  const hits = scanSecrets(d).join('\n');
  assert.match(hits, /a\.js: private key/); assert.match(hits, /b\.yml: database URL/); assert.match(hits, /c\.env: hex secret/);
  assert.ok(!/ok\.md|x\.test/.test(hits), hits);
});

test('credential and runtime-data files are reported; .env.example is not', () => {
  const d = dir();
  for (const f of ['.env', '.env.production', 'server.pem', 'api/db.json', 'x.dump']) put(d, f, 'x');
  put(d, '.env.example', 'x');
  const found = sensitiveFilesPresent(d);
  assert.deepEqual(found.sort(), ['.env', '.env.production', 'api/db.json', 'server.pem', 'x.dump']);
});

test('this repository\'s .gitignore ignores secrets, data, build output and restricted media, and keeps notices', () => {
  assert.deepEqual(ignoreRules(), []);
});
