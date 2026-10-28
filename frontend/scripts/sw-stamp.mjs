// What vite.config.js writes into the built public/sw.js. Kept here so the worker's tests can
// stamp a copy exactly the way a build does.

// Language, instruction and exercise-name packs: a few hundred kB each, seventeen of them, and
// the worker already keeps the one in use once it has loaded. Everything else that is split off
// and loaded on demand (the photo and video ingest, the QR reader, the local Coach) is small,
// and offline it was simply missing until the page had needed it once with a network: the first
// photo after an update, added at the gym, failed.
const PACK = /[\\/]src[\\/](?:locales|instr|exercise-names)[\\/]/
// …except the English steps: every language falls back to them, they are no longer in the main
// bundle (i18n.js loads them on the first exercise opened), and left out, a phone that had not
// opened one with a network showed no steps at all offline. exercise-desc/ is not a PACK and
// stays in the list, English descriptions included.
const KEEP = /[\\/]src[\\/]instr[\\/]en\.js$/

/** The built files the worker fetches at install besides what index.html names: every chunk and
 *  stylesheet but the packs, as './assets/…' the way index.html writes them. */
export function lazyAssets(bundle) {
  const out = []
  for (const [file, item] of Object.entries(bundle)) {
    if (!/\.(?:js|css)$/.test(file)) continue
    const ids = item.type === 'chunk' ? (item.moduleIds?.length ? item.moduleIds : Object.keys(item.modules || {})) : []
    if (ids.length && ids.every(id => PACK.test(id) && !KEEP.test(id))) continue
    out.push('./' + file)
  }
  return out.sort()
}

const PACK_FILE = /[\\/]src[\\/](?:locales|instr|exercise-names)[\\/]([^\\/]+)\.js$/

/** The language packs of the build, per language: { de: ['./assets/de-x.js', …] }. The chunks lazyAssets leaves out, by
 *  the language their modules are for (the English steps are in lazyAssets, not here). A chunk of packs for several
 *  languages is listed under each. The worker fetches the shown language's at install, and says whether they are there. */
export function langPacks(bundle) {
  const out = {}
  for (const [file, item] of Object.entries(bundle)) {
    if (!/\.js$/.test(file) || item.type !== 'chunk') continue
    const ids = item.moduleIds?.length ? item.moduleIds : Object.keys(item.modules || {})
    if (!ids.length || !ids.every(id => PACK.test(id) && !KEEP.test(id))) continue
    for (const id of ids) {
      const m = PACK_FILE.exec(id)
      if (!m) continue
      const list = (out[m[1]] ||= [])
      const url = './' + file
      if (!list.includes(url)) list.push(url)
    }
  }
  for (const k of Object.keys(out)) out[k].sort()
  return out
}

/** What of the lists the build produced is really in the output. The bundle's names are read before the build is finished,
 *  and a chunk can come out under another name (one in this repo does): a list naming a file that is not there would
 *  make the worker fetch the server's answer for a missing file, which for a single-page app is its own index.html. */
export function keepBuilt({ lazy = [], langs = {} }, exists) {
  const dropped = []
  const keep = list => list.filter(u => exists(u) || (dropped.push(u), false))
  return { lazy: keep(lazy), langs: Object.fromEntries(Object.entries(langs).map(([k, v]) => [k, keep(v)])), dropped }
}

/** The worker with its build stamp, its list and its language packs in place of the three placeholders. */
export function stampSw(source, { stamp, lazy = [], langs = {} }) {
  return source
    .replace('__BUILD__', () => stamp)
    .replace("'__LAZY__'", () => JSON.stringify(JSON.stringify(lazy)))
    .replace("'__LANGS__'", () => JSON.stringify(JSON.stringify(langs)))
}
