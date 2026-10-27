#!/usr/bin/env node
// Is this directory safe to turn into a Git repository and publish? Read-only: it scans files, and
// checks the .gitignore rules in a throw-away temporary repository. It never runs `git init` here,
// never stages, commits or pushes anything.
//
//   node scripts/git-readiness.mjs
//
// Exit 1 when: a secret-looking value is found in a file that would be committed, a sensitive path is
// not ignored, or a file that must be kept (licences, notices, .env.example) would be ignored.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.claude', '.agents', '.superpowers', 'data', 'coach-auth', 'uploads', 'Pods']);
const TEXT = /\.(js|jsx|mjs|cjs|ts|json|yml|yaml|md|txt|env|example|html|css|sh|ps1|toml|kt|java|swift|gradle|xml|properties|plist|nix|sql)$/i;

const PATTERNS = [
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Anthropic / OpenAI style key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['database URL with a password', /postgres(?:ql)?:\/\/[^\s:@/'"`<>]+:(?!pw\b|postgres\b|password\b|PASSWORD\b|pass\b|secret\b|x\b|\$|<|\{|\.\.\.)[^\s@/'"`<>]{4,}@(?!localhost|127\.0\.0\.1)[A-Za-z0-9.-]+/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['hex secret assigned', /\b(?:SESSION_SECRET|BOOTSTRAP_SECRET|VAPID_PRIVATE_KEY|SPOTIFY_CLIENT_SECRET|API_KEY|HEVY_API_KEY)\s*[=:]\s*['"]?[A-Za-z0-9+/_-]{24,}/],
];

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) yield* files(path.join(dir, e.name)); }
    else if (e.isFile()) yield path.join(dir, e.name);
  }
}

export function scanSecrets(root = ROOT) {
  const hits = [];
  for (const f of files(root)) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (!TEXT.test(f) || fs.statSync(f).size > 2_000_000) continue;
    if (/(^|\/)(package-lock\.json|.*\.test\.(js|jsx|mjs)|test\/|.*\.min\.js)$/i.test(rel) || /\/test\//.test(rel)) continue;     // fixtures use made-up values
    const text = fs.readFileSync(f, 'utf8');
    for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${rel}: ${name}`);
  }
  return hits;
}

export function sensitiveFilesPresent(root = ROOT) {
  const out = [];
  for (const f of files(root)) {
    const rel = path.relative(root, f).replace(/\\/g, '/');
    if (/(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(rel) || /\.(pem|key|p12|pfx|jks|keystore)$/i.test(rel) || /\.(dump|sql\.gz)$/i.test(rel) || /(^|\/)(db\.json|secret|vapid\.json|audit\.log)$/.test(rel)) out.push(rel);
  }
  return out;
}

/** `git check-ignore` in a temporary repository that holds only this .gitignore. */
export function ignoreRules(root = ROOT) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-gitcheck-'));
  const g = (...a) => execFileSync('git', a, { cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const problems = [];
  try {
    g('init', '-q');
    fs.copyFileSync(path.join(root, '.gitignore'), path.join(tmp, '.gitignore'));
    const mustIgnore = ['.env', '.env.production', 'data/db.json', 'data/state-abc.json', 'frontend/dist/index.html', 'node_modules/x/index.js',
      'catalogue/media/still/0001.webp', 'catalogue/media/clip/0001.mp4', 'server.pem', 'db.key', 'ca.crt', 'backup.dump', 'coach-auth/x.json', 'uploads/u/a.png', 'frontend/build_output.txt', 'debug.log'];
    const mustKeep = ['LICENSE', 'NOTICE.md', 'catalogue/media/NOTICE.md', '.env.example', 'README.md', 'api/migrations/001_init.sql', 'api/server.js', 'frontend/src/App.jsx', 'docs/DEPLOYMENT.md', 'render.yaml', 'frontend/vercel.json'];
    const ignored = p => { try { g('check-ignore', '-q', '--no-index', p); return true; } catch { return false; } };
    for (const p of mustIgnore) if (!ignored(p)) problems.push(`not ignored but should be: ${p}`);
    for (const p of mustKeep) if (ignored(p)) problems.push(`ignored but must be kept: ${p}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0;
  const section = (title, items) => { console.log((items.length ? 'FAIL ' : 'ok   ') + title); items.forEach(i => console.log('       ' + i)); bad += items.length; };
  const isRepo = fs.existsSync(path.join(ROOT, '.git'));
  console.log(isRepo ? 'This directory is a Git repository.' : 'This directory is not a Git repository yet (nothing here was run against Git).');
  section('no secret-looking values in files that would be committed', scanSecrets());
  const present = sensitiveFilesPresent();
  section('no credential, key, dump or runtime-data files outside ignored folders', present);
  try { section('.gitignore keeps secrets, data, build output and restricted media out, and keeps licences in', ignoreRules()); }
  catch (e) { console.log('NOT RUN .gitignore check: ' + (e.code === 'ENOENT' ? 'git is not installed' : e.message)); bad++; }
  process.exit(bad ? 1 : 0);
}
