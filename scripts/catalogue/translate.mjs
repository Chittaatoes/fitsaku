#!/usr/bin/env node
// Translates the exercise names, descriptions and step-by-step instructions of catalogue/exercises/ into one
// language, into catalogue/i18n/<lang>.json, which `node scripts/catalogue/build.mjs` then turns into the app's
// packs. Resumable: ids already in the file are skipped, and the file is written after every batch.
//
//   ANTHROPIC_API_KEY=... node scripts/catalogue/translate.mjs --lang id                # everything missing
//   ANTHROPIC_API_KEY=... node scripts/catalogue/translate.mjs --lang id --limit 200    # the first 200 missing
//   ... --fields name,description     # only the short texts (about a quarter of the cost); steps can follow in a second run with --fields instructions
//   node scripts/catalogue/translate.mjs --lang id --dry                                # what would be done, no calls
//
// It calls the Anthropic Messages API with YOUR key, from YOUR machine; nothing is sent anywhere else, and the key is
// read from the environment only (never written to a file or printed). ANTHROPIC_MODEL picks the model.
// Roughly 2.4 MB of English text in, about as much out: a full run is a real cost on your account, so try --limit first
// and read the output (a native speaker should review it before it is released).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CAT = path.join(ROOT, 'catalogue');
const NAMES = { id: 'Indonesian (Bahasa Indonesia)', ms: 'Malay', vi: 'Vietnamese', fil: 'Filipino' };
const FIELDS = ['name', 'description', 'instructions'];
const STYLE = {
  id: 'Use "Anda" for the reader. Keep the gym words people actually say in Indonesian as they are (barbel, dumbbell, kettlebell, bench press, squat, deadlift, push-up, plank, curl, row, press, lat pulldown, cable, machine) and translate the rest (muscles, body parts, directions). Natural, short, imperative sentences.',
};

export function buildPrompt(lang, batch, fields = FIELDS) {
  return `You translate gym exercise content from English into ${NAMES[lang] || lang}. ${STYLE[lang] || ''}
Return ONLY a JSON object keyed by the same ids, each value holding only these fields: ${fields.map(f => f === 'instructions' ? '"instructions": string[]' : `"${f}": string`).join(', ')}.
Rules: ${fields.includes('instructions') ? 'keep exactly as many instruction steps, in the same order; ' : ''} do not add or drop information; no markdown; keep numbers, units and symbols (45°, 5x5) as they are; the name is a short exercise name, capitalised like a title.
Input:
${JSON.stringify(batch)}`;
}

/** Why a model answer cannot be used for `batch`, or null. */
export function problemWith(answer, batch, fields = FIELDS) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return 'not an object';
  for (const [id, src] of Object.entries(batch)) {
    const t = answer[id];
    if (!t) return `missing ${id}`;
    if (fields.includes('name') && (typeof t.name !== 'string' || !t.name.trim())) return `${id}: no name`;
    if (fields.includes('description') && (typeof t.description !== 'string' || !t.description.trim())) return `${id}: no description`;
    if (fields.includes('instructions') && (!Array.isArray(t.instructions) || t.instructions.length !== src.instructions.length || t.instructions.some(s => typeof s !== 'string' || !s.trim()))) return `${id}: instructions do not match the ${src.instructions.length} steps`;
  }
  return null;
}

async function ask(prompt, { key, model }) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; }
    if (!res.ok) throw new Error(`API answered ${res.status}`);          // the body can echo request details: not printed
    const body = await res.json();
    const text = (body.content || []).map(c => c.text || '').join('');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try { return JSON.parse(json); } catch { /* retry */ }
  }
  throw new Error('no usable answer after 4 tries');
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const lang = opt('--lang', 'id');
  const limit = +opt('--limit', 0) || Infinity;
  const size = +opt('--batch', 20);
  const only = opt('--ids', '') ? new Set(opt('--ids').split(',')) : null;
  const dry = args.includes('--dry');
  const fields = opt('--fields', FIELDS.join(',')).split(',').map(f => f.trim()).filter(f => FIELDS.includes(f));
  if (!fields.length) { console.error('--fields takes name, description and/or instructions'); process.exit(2); }
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

  const file = path.join(CAT, 'i18n', lang + '.json');
  const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = [];
  for (const f of fs.readdirSync(path.join(CAT, 'exercises')).filter(f => f.endsWith('.json')).sort()) {
    const e = JSON.parse(fs.readFileSync(path.join(CAT, 'exercises', f), 'utf8'));
    if (e.variantOf || (only && !only.has(e.id)) || !e.description || !Array.isArray(e.instructions)) continue;
    if (fields.every(f => done[e.id]?.[f] != null)) continue;
    todo.push({ id: e.id, name: e.name, description: e.description, instructions: e.instructions });
  }
  const run = todo.slice(0, limit);
  console.log(`${lang} [${fields.join(', ')}]: ${Object.keys(done).length} exercises in the file, ${todo.length} to do, doing ${run.length}${dry ? ' (dry run)' : ''}`);
  if (dry || !run.length) return;
  if (!key) { console.error('ANTHROPIC_API_KEY is not set'); process.exit(2); }

  let n = 0, failed = 0;
  for (let i = 0; i < run.length; i += size) {
    const batch = Object.fromEntries(run.slice(i, i + size).map(({ id, ...rest }) => [id, rest]));
    let answer = null, why = null;
    for (let t = 0; t < 2 && !answer; t++) {
      try { const a = await ask(buildPrompt(lang, batch, fields), { key, model }); why = problemWith(a, batch, fields); if (!why) answer = a; }
      catch (e) { why = e.message; }
    }
    if (!answer) { failed += Object.keys(batch).length; console.error(`batch at ${i} skipped: ${why}`); continue; }
    for (const id of Object.keys(batch)) {
      const t = answer[id], row = done[id] || {};
      if (fields.includes('name')) row.name = t.name.trim();
      if (fields.includes('description')) row.description = t.description.trim();
      if (fields.includes('instructions')) row.instructions = t.instructions.map(x => x.trim());
      done[id] = row;
    }
    n += Object.keys(batch).length;
    const sorted = Object.fromEntries(Object.keys(done).sort().map(k => [k, done[k]]));
    fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`  ${n}/${run.length}`);
  }
  console.log(`done: ${n} translated, ${failed} skipped. Now: node scripts/catalogue/build.mjs`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(e => { console.error(e.message); process.exit(1); });
