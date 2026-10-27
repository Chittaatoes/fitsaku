#!/usr/bin/env node
// Fails (exit 1) when the third-party exercise media (Gym visual stills and clips, licensed to the
// openGym app only, see NOTICE.md) is present in something that would be published.
//
//   node scripts/audit-public-artifacts.mjs                    # the repository's own deployment inputs + frontend/dist
//   node scripts/audit-public-artifacts.mjs --dir some/folder  # any built output (repeatable)
//   node scripts/audit-public-artifacts.mjs --docker-image fitsaku-web:local   # a locally built image (needs docker)
//
// What counts as restricted media, in a scanned folder or image:
//   - any file under a folder named exercise-media, still or clip with a numeric name (0001.webp, 12345.mp4);
//   - any file whose SHA-256 equals one of the files in catalogue/media/still or /clip (when they are present locally);
//   - any .mp4 / .webm / .gif (the built-in clips were mp4; a public build ships no video at all).
// It also checks the deployment inputs (Dockerfiles, .dockerignore, .gitignore, vercel.json, render.yaml,
// the Vite dev middleware) so a change that would start shipping the media is caught before a build.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NUMERIC_MEDIA = /(^|[\\/])(still|clip)[\\/]\d{3,6}\.(webp|mp4|png|jpg|gif)$/i;
const MEDIA_DIR = /(^|[\\/])exercise-media[\\/]/i;
const VIDEO_EXT = /\.(mp4|webm|gif)$/i;

/** Personal-use mode: MEDIA_PERSONAL_USE.md exists, so the owner has recorded a non-commercial use that the media notice allows. */
export const personalMedia = (root = ROOT) => fs.existsSync(path.join(root, 'MEDIA_PERSONAL_USE.md'));

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else if (e.isFile()) yield p;
  }
}

/** Hashes of the restricted files present in this checkout (empty when they are not). */
export function restrictedHashes(root = ROOT) {
  const set = new Set();
  for (const sub of ['still', 'clip']) {
    const dir = path.join(root, 'catalogue', 'media', sub);
    if (fs.existsSync(dir)) for (const f of walk(dir)) set.add(sha(f));
  }
  return set;
}

/** Problems found in one built folder. */
export function auditDir(dir, hashes = restrictedHashes(), { allowMedia = false } = {}) {
  const problems = [];
  if (!fs.existsSync(dir)) return [`${dir}: does not exist`];
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f);
    if (/(^|[\\/])NOTICE\.md$/i.test(rel)) continue;                  // the licence notice is meant to travel
    // Personal-use mode: the media is allowed in exactly one place, exercise-media/still|clip, unmodified.
    if (allowMedia && /^exercise-media[\\/](still|clip)[\\/]\d{3,6}\.(webp|mp4)$/i.test(rel)) continue;
    if (MEDIA_DIR.test(rel) || NUMERIC_MEDIA.test(rel)) problems.push(`${rel}: exercise media path`);
    else if (VIDEO_EXT.test(rel)) problems.push(`${rel}: video/animation file in a public artifact`);
    else if (hashes.size && /\.(webp|png|jpg|jpeg)$/i.test(rel) && fs.statSync(f).size > 1024 && hashes.has(sha(f))) problems.push(`${rel}: identical to a restricted exercise image`);
  }
  return problems;
}

/** Problems with the files that decide what gets published. */
export function auditInputs(root = ROOT) {
  const problems = [];
  const read = f => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };
  const need = (file, test, msg) => { const t = read(file); if (t == null) problems.push(`${file}: missing`); else if (!test(t)) problems.push(`${file}: ${msg}`); };

  const personal = personalMedia(root);
  if (personal) {
    need('catalogue/media/NOTICE.md', t => /Gym visual/i.test(t), 'the licence notice must be present to travel with the media');
    need('frontend/vercel.json', t => JSON.parse(t).build?.env?.VITE_BUNDLE_MEDIA === '1' && JSON.parse(t).build?.env?.VITE_BUILTIN_MEDIA !== '0', 'personal-use mode: build.env.VITE_BUNDLE_MEDIA must be "1" and VITE_BUILTIN_MEDIA not "0"');
    need('frontend/vite.config.js', t => /VITE_BUNDLE_MEDIA/.test(t) && /exercise-media/.test(t), 'the build must bundle the media (VITE_BUNDLE_MEDIA)');
  }
  need('web/Dockerfile', t => /ARG INCLUDE_EXERCISE_MEDIA=0/.test(t), 'INCLUDE_EXERCISE_MEDIA must default to 0');
  // Every COPY of the media directory must sit in the optional stage `media-1`, which is not built unless asked for.
  need('web/Dockerfile', t => t.split(/^FROM /m).every(stage => !/^\s*COPY\s+catalogue\/media\/?\s/m.test(stage) || /^scratch AS media-1/.test(stage)), 'copies catalogue/media outside the optional media-1 stage');
  need('web/Dockerfile', t => /ARG VITE_BUILTIN_MEDIA=0/.test(t) && /VITE_BUILTIN_MEDIA="?\$\{?VITE_BUILTIN_MEDIA/.test(t), 'the frontend build must default to VITE_BUILTIN_MEDIA=0');
  need('.dockerignore', t => /catalogue\/media\/still/.test(t) && /catalogue\/media\/clip/.test(t), 'must exclude catalogue/media/still and /clip from build contexts');
  if (!personal) {
    need('.gitignore', t => /^catalogue\/media\/still\//m.test(t) && /^catalogue\/media\/clip\//m.test(t), 'must keep the restricted media out of a public repository');
    need('frontend/vercel.json', t => JSON.parse(t).build?.env?.VITE_BUILTIN_MEDIA === '0', 'build.env.VITE_BUILTIN_MEDIA must be "0"');
  }
  need('frontend/vite.config.js', t => /VITE_BUILTIN_MEDIA/.test(t) && /configureServer/.test(t) && /apply: 'serve'/.test(t), 'the dev media middleware must be dev-only and honour VITE_BUILTIN_MEDIA=0');
  need('render.yaml', t => !/catalogue\/media|exercise-media/.test(t) && /rootDir: api/.test(t), 'the API service must be built from api/ only');
  need('api/Dockerfile', t => !/catalogue\/media/.test(t), 'the API image must not copy media');
  return problems;
}

/** Files inside a locally built image (needs docker). */
export function auditImage(image) {
  const out = execFileSync('docker', ['run', '--rm', '--entrypoint', 'find', image, '/usr/share/nginx/html', '-type', 'f'], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean)
    .filter(f => (MEDIA_DIR.test(f) && !/NOTICE\.md$/i.test(f)) || NUMERIC_MEDIA.test(f) || VIDEO_EXT.test(f))
    .map(f => `${f}: restricted media inside the image`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const dirs = args.flatMap((a, i) => (a === '--dir' ? [args[i + 1]] : []));
  const images = args.flatMap((a, i) => (a === '--docker-image' ? [args[i + 1]] : []));
  const report = [];
  const run = (label, problems) => { report.push({ label, problems }); };
  run('deployment inputs', auditInputs());
  const targets = dirs.length ? dirs : (fs.existsSync(path.join(ROOT, 'frontend', 'dist')) ? [path.join(ROOT, 'frontend', 'dist')] : []);
  for (const d of targets) run('folder ' + d + (personalMedia() ? ' (personal-use mode)' : ''), auditDir(d, restrictedHashes(), { allowMedia: personalMedia() }));
  for (const i of images) run('image ' + i, auditImage(i));
  let bad = 0;
  for (const r of report) { console.log((r.problems.length ? 'FAIL ' : 'ok   ') + r.label); r.problems.slice(0, 20).forEach(p => console.log('       ' + p)); bad += r.problems.length; }
  if (!targets.length) console.log('note: no built folder given and frontend/dist does not exist; only the inputs were checked');
  process.exit(bad ? 1 : 0);
}
