/* FitSaku service worker — the app shell and its hashed assets are cached at install and kept
   fresh network-first, media (img/gif) cache-first in a cache of its own. A home-screen app
   reopened without a network comes back from here with the same bundle it last ran; the state
   itself lives in localStorage. `CACHE` carries the build hash (vite.config.js rewrites it), so
   every deploy is a new worker with its own cache and the previous build's files are dropped on
   activate; the media cache (`MEDIA`) is kept across builds. */
const CACHE = 'opengym-rt-__BUILD__'
// Where the page leaves this browser's push device id (lib/push.js shareDeviceId) for the
// pushsubscriptionchange handler below, which has no localStorage to read it from. Not a build
// cache, so activate's sweep leaves it alone.
const DEVICE_CACHE = 'opengym-device'
const DEVICE_URL = '/opengym-device-id'

/* What the page tells the worker and the worker needs across builds lives in a cache of its own, which no sweep
   touches: the language the app is shown in (so a new build's install fetches that language's packs before it takes
   over) and which build caches are kept (the running one and the one before it). */
const PREFS_CACHE = 'opengym-prefs'
const BUILD_PREFIX = 'opengym-rt-'
const BUILD = CACHE.slice(BUILD_PREFIX.length)
const STAMPED = BUILD !== '__BUILD__'           // false in a dev server or a test: nothing was stamped in
const MANIFEST_URL = '/opengym-manifest'
const prefKey = n => '/opengym-pref-' + n
async function getPref(name) {
  try { const r = await (await caches.open(PREFS_CACHE)).match(prefKey(name)); return r ? JSON.parse(await r.text()) : undefined } catch { return undefined }
}
async function setPref(name, value) {
  try { await (await caches.open(PREFS_CACHE)).put(prefKey(name), new Response(JSON.stringify(value))) } catch { /* the next boot says it again */ }
}

/* The language packs, per language, for this build (scripts/sw-stamp.mjs langPacks): { de: ['./assets/de-x.js', …] }.
   Unstamped it is empty. */
const LANGS = '__LANGS__'
const langMap = () => { try { const m = JSON.parse(LANGS); return m && typeof m === 'object' && !Array.isArray(m) ? m : {} } catch { return {} } }
const langFiles = lang => { const f = langMap()[lang]; return Array.isArray(f) ? f : [] }
const goodLang = l => typeof l === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(l)

// A page is never a script or a stylesheet. A server that answers a missing file with the app's own index.html (the
// SPA fallback of Vercel's rewrite) must not get that page stored, or served, under a .js or .css name.
const isHtml = r => /text\/html/i.test((r && r.headers && typeof r.headers.get === 'function' && r.headers.get('content-type')) || '')
const goodAsset = (u, r) => !!r && r.ok && !r.redirected && !(/\.(?:js|css|mjs)(?:\?|$)/.test(String(u)) && isHtml(r))
// One file of this build into a cache, if it is really that file. False, never a throw: callers decide what a miss means.
async function fetchInto(c, u) {
  try { const r = await fetch(u, { cache: 'no-cache' }); if (!goodAsset(u, r)) return false; await c.put(u, r); return true } catch { return false }
}

/* Exercise media (img/, gif/) lives in a cache of its own that outlives builds (#281). It used to
   share the build's cache, so every update swept every animation along with the old bundle, and
   an installed app opened offline after an update showed broken tiles for exercises it had shown
   the day before. The media never changes under a given URL, so there is nothing to invalidate.

   It is bounded instead: past MEDIA_MAX_BYTES (or MEDIA_MAX_ITEMS, for a server that sends no
   Content-Length) the least recently used entries go first. The Cache API keeps entries in the
   order they were written, so a hit is written back once per worker lifetime to move it to the
   end: least recently used as far as this worker has seen, which is what "LRU-ish" means here.
   The whole catalogue is about 100 MB of stills and clips, so the cap only bites for someone who has browsed most of
   it. lib/media-prefetch.js fills this cache ahead for the exercises in the plan — in the app
   installed on the home screen only; a browser tab gets what it has shown and nothing more — and
   names it too, so a new name has to change there as well (sw-media.test.js pins the two
   together). */
const MEDIA = 'opengym-media-v1'
const MEDIA_MAX_BYTES = 150 * 1024 * 1024
const MEDIA_MAX_ITEMS = 3000
// What an entry without a Content-Length is counted as: a little above the catalogue's average.
const MEDIA_GUESS_BYTES = 64 * 1024
// Trimming lists the whole cache, so it runs after every MEDIA_TRIM_EVERY new entries rather
// than after each one, and once when a new worker activates.
const MEDIA_TRIM_EVERY = 20
const isMediaPath = p => p.includes('/exercise-media/') || p.includes('/img/') || p.includes('/gif/')

// The code the app loads only when it needs it (the photo and video ingest, the QR reader...),
// listed by the build (vite.config.js, scripts/sw-stamp.mjs). Without it the first photo added
// offline after an update had no ingest to run. Unstamped (a dev server, a test) it is empty.
const LAZY = '__LAZY__'
const lazyAssets = () => { try { const a = JSON.parse(LAZY); return Array.isArray(a) ? a : [] } catch { return [] } }

// What the shell needs to boot without a network: index.html plus every script/style/icon it
// references. Read from the served index.html so the list follows the build, not a hand-kept
// manifest that would go stale the first time a chunk is renamed.
async function precache(into = CACHE, preHtml) {
  const c = await caches.open(into)
  const res = preHtml === undefined ? await fetch('index.html', { cache: 'no-cache' }) : { ok: true, redirected: false, text: async () => preHtml }
  // Whatever came back is not the shell: the server was restarting mid-deploy (5xx), or the
  // request was answered by something else after a redirect — an auth proxy in front (Authelia,
  // Cloudflare Access; docs/SELF_HOSTING.md) sends its login page once the session there expires.
  // Throwing fails the install, which is the only thing that keeps the build already
  // on this device, and its cache, in place; a returned-quietly install activates and sweeps.
  if (!res.ok || res.redirected) throw new Error('precache: index.html ' + res.status + (res.redirected ? ' redirected' : ''))
  const html = await res.text()
  const refs = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    .filter(u => /\.(?:js|css|png|svg|webmanifest|json)(?:\?|$)/.test(u) && !/^(?:https?:)?\/\//.test(u)))]
  // The scripts and the stylesheets ARE the app. Every sub-resource used to be best-effort, so an
  // install that got index.html and lost one chunk to a flaky connection still activated, still
  // swept the build this device came from, and the next offline open was a shell with no code:
  // a blank page. A chunk that will not cache fails the install instead, which keeps the working
  // build and its cache exactly where they are. Images, icons and the manifest stay best-effort —
  // a missing icon is not a broken app.
  const code = refs.filter(u => /\.(?:js|css)(?:\?|$)/.test(u))
  // Fetched by hand rather than with `cache.add`, for the same reason index.html is: `add` takes
  // a REDIRECT for an answer, and an auth proxy in front answers every request with its login
  // page once the session there expires. A 200 of HTML stored under the main bundle's URL is
  // worse than nothing cached at all —
  // the install would report success and then sweep the build that still worked.
  await Promise.all(code.map(async u => {
    const r = await fetch(u, { cache: 'no-cache' }).catch(e => { throw new Error('precache: ' + u + ' — ' + (e?.message || e)) })
    if (!goodAsset(u, r)) throw new Error('precache: ' + u + ' ' + r.status + (r.redirected ? ' redirected' : isHtml(r) ? ' html' : ''))
    await c.put(u, r)
  }))
  await Promise.all(refs.filter(u => !code.includes(u)).map(u => c.add(u).catch(() => {})))
  // Best effort, like the icons: a chunk missing here is fetched when it is needed, as before, and
  // must not keep a working build from installing. Fetched by hand for the same redirect reason.
  await Promise.all(lazyAssets().filter(u => !code.includes(u)).map(async u => {
    try {
      const r = await fetch(u, { cache: 'no-cache' })
      if (goodAsset(u, r)) await c.put(u, r)
    } catch { /* fetched on demand instead */ }
  }))
  // The language the app is shown in: its packs come with the build, so an offline start right after an update is
  // not missing them. Best effort, like the chunks above: one that does not come shows as "partial" in the status
  // (below) and can be fetched again, but is no reason to keep a working build from installing.
  const lang = await getPref('lang')
  if (goodLang(lang)) await Promise.all(langFiles(lang).map(u => fetchInto(c, u)))
  // What this build needs to run offline, written for the status check (and for the rule about older builds'
  // files: a file this build owns is never taken from an older build's cache).
  await c.put(MANIFEST_URL, new Response(JSON.stringify({ build: BUILD, required: ['index.html', ...code], lazy: lazyAssets().filter(u => !code.includes(u)) }), { headers: { 'content-type': 'application/json' } }))
  // The shell goes in last, so activate's guard — an index.html in THIS build's cache — means the
  // whole shell is there rather than just its first file.
  await c.put('index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
}

// The builds whose caches stay: this one and the one it replaced, newest first, remembered across workers. A page
// that is still open when an update takes over (skipWaiting, below) goes on asking for the files of the build it
// loaded; they are in the previous build's cache, and a request the network answers for a file that no longer exists
// would be the app's own index.html.
async function keptBuilds() {
  const before = await getPref('builds')
  const prev = Array.isArray(before) ? before.filter(n => typeof n === 'string' && n.startsWith(BUILD_PREFIX) && n !== CACHE) : []
  const next = [CACHE, ...prev].slice(0, 2)
  await setPref('builds', next)
  return next
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // The previous build's files are what a reopen without a network comes back from, so they go
    // only once this build's shell is really in its own cache. An install that never got the
    // shell used to take them anyway, and the app opened on the browser's error page until the
    // next load with a network.
    const c = await caches.open(CACHE)
    if (await c.match('index.html')) {
      // DEVICE_CACHE holds this browser's device id (the push re-register below needs it): not a
      // build, so an update never sweeps it. Nor does PREFS_CACHE. The build before this one stays too (see
      // keptBuilds): a page still running it keeps getting its files from there.
      const kept = await keptBuilds()
      const old = (await caches.keys()).filter(k => k !== CACHE && k !== MEDIA && k !== DEVICE_CACHE && k !== PREFS_CACHE && !kept.includes(k))
      // A build from before MEDIA existed kept its media in its own cache: move it across first,
      // so the first update to this worker does not cost what the device already had offline.
      await Promise.all(old.map(k => adoptMedia(k).catch(() => {})))
      await Promise.all(old.map(k => caches.delete(k)))
      await trimMedia().catch(() => {})
    }
    await self.clients.claim()
  })())
})

// Only a real answer is kept. A gated instance answers a lapsed session with 401, and an auth
// proxy in front with its login page, a 200 of HTML after a redirect; stored under an image's
// URL, that would stand in for the animation for good, since nothing sweeps this cache.
const realMedia = res => {
  const type = (res.headers && res.headers.get('content-type')) || ''
  return res.ok && !res.redirected && !/text\/html/i.test(type)
}

async function adoptMedia(name) {
  const from = await caches.open(name)
  const media = (await from.keys()).filter(r => { try { return isMediaPath(new URL(r.url || r, location.href).pathname) } catch { return false } })
  if (!media.length) return
  const to = await caches.open(MEDIA)
  for (const r of media) {
    if (await to.match(r)) continue
    // A build before this one kept any ok answer, a login page included. It went with that
    // build's cache; carried into this one, it would stay.
    const res = await from.match(r)
    if (res && realMedia(res)) await to.put(r, res)
  }
}

let mediaPuts = 0
// Oldest first, which after the write-backs below is least recently used first.
async function trimMedia() {
  if (!(await caches.keys()).includes(MEDIA)) return
  const c = await caches.open(MEDIA)
  const keys = await c.keys()
  const sizes = await Promise.all(keys.map(k => c.match(k).then(r => Number(r && r.headers && r.headers.get('content-length')) || MEDIA_GUESS_BYTES, () => MEDIA_GUESS_BYTES)))
  let bytes = sizes.reduce((a, b) => a + b, 0)
  let items = keys.length
  for (let i = 0; i < keys.length && (bytes > MEDIA_MAX_BYTES || items > MEDIA_MAX_ITEMS); i++) {
    await c.delete(keys[i])
    bytes -= sizes[i]; items--
  }
}

// A <video> asks for its clip in byte ranges. The network's 206 cannot be cached (cache.put
// refuses a partial answer), so a clip was never kept; and a whole 200 handed to a range request
// is a clip iOS Safari will not play. So the cache holds the whole file, fetched without a Range,
// and a range request is answered with a 206 cut from it. One range, the only kind a player asks
// for; anything else gets the whole file.
const rangeOf = req => (req.headers && typeof req.headers.get === 'function' && req.headers.get('range')) || ''
async function slice(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  const type = res.headers.get('content-type') || 'application/octet-stream'
  const body = await res.arrayBuffer()
  const size = body.byteLength
  let start = m && m[1] !== '' ? Number(m[1]) : NaN
  let end = m && m[2] !== '' ? Number(m[2]) : size - 1
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1 }
  if (!m || !Number.isFinite(start)) return new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } })
  if (start >= size || end < start) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } })
  end = Math.min(end, size - 1)
  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' }
  })
}

// URLs written back this worker lifetime; see MEDIA above.
const touched = new Set()
function media(e) {
  const range = rangeOf(e.request)
  return caches.open(MEDIA).then(c => c.match(e.request).then(hit => {
    if (hit) {
      if (!touched.has(e.request.url)) {
        touched.add(e.request.url)
        const copy = hit.clone()
        e.waitUntil(c.put(e.request, copy).catch(() => {}))
      }
      return range ? slice(hit, range) : hit
    }
    // The whole file for a range request: the one answer that can be kept.
    return fetch(range ? e.request.url : e.request).then(res => {
      const whole = range ? res.status === 200 : true
      if (whole && realMedia(res)) {
        touched.add(e.request.url)
        const copy = res.clone()
        e.waitUntil(c.put(e.request.url, copy).then(() => { if (++mediaPuts >= MEDIA_TRIM_EVERY) { mediaPuts = 0; return trimMedia() } }).catch(() => {}))
        if (range) return slice(res, range)
      }
      return res
    })
  }))
}

// The payload is parsed inside waitUntil: a push whose handler throws before showing anything is
// a "silent push", which Chrome counts against the site and eventually revokes. A body that is
// not JSON still shows a notification.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let data = {}
    try { data = e.data ? e.data.json() : {} } catch { data = { body: (() => { try { return e.data.text() } catch { return '' } })() } }
    // One alert per kind: a new rest-timer push replaces the last one instead of stacking
    // up in the tray (issue #172). `tag` alone should do that, but iOS keeps every one, so
    // the previous notification with the same tag is closed by hand first.
    const tag = data.tag || 'opengym'
    try { for (const n of await self.registration.getNotifications({ tag })) n.close() } catch {}
    await self.registration.showNotification(data.title || 'FitSaku', {
      body: data.body || '',
      icon: 'icon-512.png',
      badge: 'icon-180.png',
      tag,
      renotify: true
    })
    // A release announcement also tells the pages that are open, which show their own "reload" banner.
    if (data.update) {
      try { for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'fs-update' }) } catch {}
    }
  })())
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})
// The push service rotated the subscription (key change, expiry): subscribe again with the same
// server key and tell the server, so the row it holds keeps pointing at this browser. With the
// device id the page registers with: without one, this browser's rest-timer alert goes to every
// device of the account until the page's next boot sync sees the missing id and sends it again.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription || (await self.registration.pushManager.getSubscription())
    const key = e.newSubscription?.options?.applicationServerKey || old?.options?.applicationServerKey
    if (!key) return
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const deviceId = await caches.open(DEVICE_CACHE).then(c => c.match(DEVICE_URL)).then(r => r ? r.text() : undefined).catch(() => undefined)
    await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), deviceId }) }).catch(() => {})
  })())
})

/* ---------- offline readiness, repair and reset (the page asks through lib/offline-status.js) ---------- */
async function readManifest(c) {
  try { const r = await c.match(MANIFEST_URL); return r ? await r.json() : null } catch { return null }
}

/* Whether this build's own files are in its cache, each one really there and not a page standing in for it:
     'ready'    the shell, the code that loads on demand, and the language's packs;
     'partial'  the shell is complete (the app opens) but a chunk or a pack is missing, or the language has no packs
                known to this build;
     'none'     the shell is not complete, or this cache holds no record of what the build needs.
   `lang` is the language the app is shown in now (the base language of a derived locale). */
async function offlineStatus(lang) {
  const c = await caches.open(CACHE)
  const man = await readManifest(c)
  if (!man || man.build !== BUILD) return { state: 'none', build: BUILD, shell: -1, lazy: 0, lang: 0, reason: 'manifest' }
  const missing = async list => {
    const out = []
    for (const u of list || []) { const r = await c.match(u); if (!r || !goodAsset(u, r)) out.push(u) }
    return out
  }
  const shell = await missing(man.required)
  const lazy = await missing(man.lazy)
  const files = goodLang(lang) && lang !== 'en' ? langFiles(lang) : []
  const langMissing = await missing(files)
  // A language with no packs on record is not "available": the build is asked about, not assumed.
  const unmapped = STAMPED && goodLang(lang) && lang !== 'en' && files.length === 0
  const state = shell.length ? 'none' : (lazy.length || langMissing.length || unmapped) ? 'partial' : 'ready'
  return { state, build: BUILD, shell: shell.length, lazy: lazy.length, lang: langMissing.length + (unmapped ? 1 : 0), reason: unmapped ? 'lang-unmapped' : undefined }
}

// Fetches what a status says is missing, apart from index.html (that is a reset's job: it is checked against the
// build). Whatever does not come stays missing and the status says so.
async function offlineRepair(lang) {
  const c = await caches.open(CACHE)
  const man = await readManifest(c)
  if (man && man.build === BUILD) {
    const want = [...(man.required || []).filter(u => u !== 'index.html'), ...(man.lazy || []), ...(goodLang(lang) && lang !== 'en' ? langFiles(lang) : [])]
    for (const u of want) { const r = await c.match(u); if (!r || !goodAsset(u, r)) await fetchInto(c, u) }
  }
  return offlineStatus(lang)
}

async function sha10(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 10)
}

/* Builds this worker's cache again from the network. Nothing is deleted until a whole new build is in a cache beside
   the old one, and only the app's own build caches (BUILD_PREFIX) are ever deleted: not the media, the device id, the
   preferences, and nothing of the page's (localStorage, IndexedDB), which a worker cannot reach anyway.
   Refused, with the old cache untouched, when the server cannot be reached, or when it serves a build other than the one
   this worker belongs to (the worker is then asked to update, and the rebuilt cache would carry the wrong lists). */
async function offlineReset(lang) {
  let res
  try { res = await fetch('index.html', { cache: 'no-cache' }) } catch { return { ok: false, error: 'offline' } }
  if (!res.ok || res.redirected) return { ok: false, error: 'offline' }
  const html = await res.text()
  if (STAMPED && (await sha10(html)) !== BUILD) {
    try { self.registration.update() } catch { /* the page's own check runs too */ }
    return { ok: false, error: 'newer' }
  }
  const staging = CACHE + '-reset'
  try {
    if (goodLang(lang)) await setPref('lang', lang)
    await caches.delete(staging)
    await precache(staging, html)
  } catch {
    await caches.delete(staging).catch(() => {})
    return { ok: false, error: 'failed' }
  }
  try {
    const s = await caches.open(staging)
    for (const k of (await caches.keys())) if (k.startsWith(BUILD_PREFIX) && k !== staging) await caches.delete(k)
    const c = await caches.open(CACHE)
    for (const req of await s.keys()) { const r = await s.match(req); if (r) await c.put(req, r) }   // index.html was written last, so it is copied last
    await caches.delete(staging)
    await setPref('builds', [CACHE])
  } catch {
    return { ok: false, error: 'failed' }
  }
  return { ok: true, ...(await offlineStatus(lang)) }
}

self.addEventListener('message', e => {
  const d = e.data || {}
  const port = e.ports && e.ports[0]
  const reply = v => { try { if (port) port.postMessage(v) } catch { /* the page went away */ } }
  const task = fn => e.waitUntil(fn().then(reply, () => reply({ ok: false, error: 'failed' })))
  if (d.type === 'lang') {
    if (!goodLang(d.lang)) return
    task(async () => {
      await setPref('lang', d.lang)
      const c = await caches.open(CACHE)
      for (const u of langFiles(d.lang)) { const r = await c.match(u); if (!r || !goodAsset(u, r)) await fetchInto(c, u) }
      return { ok: true }
    })
  } else if (d.type === 'status') task(() => offlineStatus(d.lang))
  else if (d.type === 'repair') task(() => offlineRepair(d.lang))
  else if (d.type === 'reset') task(() => offlineReset(d.lang))
})

/* The files with a content hash in their name (assets/index-AbC123xY.js): the name is the content, so a copy in the
   cache is the file, whenever it was stored. Looked up in this build's cache first. An older build's cache is asked
   only about a file this build does not own, for the page that is still running that build; and only a real file is
   ever kept (goodAsset: a page standing in for a script is neither stored nor trusted). */
const ASSETS_DIR = (() => { try { return new URL('assets/', location.href).pathname } catch { return '/assets/' } })()
// Eight characters of hash (which may include a '-'), plus up to two the bundler adds to tell two chunks of one name apart.
const HASHED = /^[^/]+-[A-Za-z0-9_-]{8,10}\.(?:js|css|woff2?)$/
const isHashedAsset = p => p.startsWith(ASSETS_DIR) && HASHED.test(p.slice(ASSETS_DIR.length))
const pathOf = u => { try { return new URL(u, location.href).pathname } catch { return String(u) } }

async function ownedPaths() {
  const man = await readManifest(await caches.open(CACHE))
  if (!man || man.build !== BUILD) return null
  const owned = new Set([...(man.required || []), ...(man.lazy || [])].map(pathOf))
  for (const files of Object.values(langMap())) for (const u of files) owned.add(pathOf(u))
  return owned
}

async function hashedAsset(e) {
  const req = e.request
  const cur = await caches.open(CACHE)
  const hit = await cur.match(req)
  if (hit) return hit
  const path = new URL(req.url).pathname
  const owned = await ownedPaths()
  if (owned && !owned.has(path)) {
    const before = await getPref('builds')
    for (const name of Array.isArray(before) ? before : []) {
      if (name === CACHE) continue
      const old = await caches.open(name)
      const prev = await old.match(req)
      if (prev && goodAsset(req.url, prev)) return prev
    }
  }
  const res = await fetch(req)
  if (goodAsset(req.url, res)) e.waitUntil(cur.put(req, res.clone()).catch(() => {}))
  return res
}

// The API sits next to the app, wherever the app is served: /api/ at the site root, /myGym/api/
// under a subpath (#238). Matching '/api/' alone let a subpath deployment's data answers into
// the network-first branch below, which cached them and handed an old document back as a 200
// once the network was gone — the page then took it for the server's word. The Cache API ignores
// the API's own `Cache-Control: no-store`, so the worker has to know to stay out of the way.
const API = (() => { try { return new URL('api/', location.href).pathname } catch { return '/api/' } })()

// How long a request for the app itself waits on the network before a cached copy answers it.
const NET_WAIT_MS = 3000

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith(API)) return    // never cache auth/data

  // The workout's songs (/music/music1.mp3 …): a few MB each, asked for in byte ranges by the audio element. Left to the
  // browser and the network: a cached copy would be one more 14 MB in every build's cache.
  if (/\/music\/[^/]+\.mp3$/.test(url.pathname)) return

  if (isMediaPath(url.pathname)) {
    e.respondWith(media(e))
    return
  }
  if (isHashedAsset(url.pathname)) {
    e.respondWith(hashedAsset(e))
    return
  }
  // Network first; the copy for the cache is cloned before the response is handed to the page —
  // cloning later, once the page has started reading the body, throws and caches nothing, which
  // is why the shell never used to survive an offline reload.
  // A dead radio does not reject fetch() quickly — it just never settles — so a cold-launch of
  // the installed app with no network stayed on a blank screen forever, with the cache fallback
  // never getting a chance to run (issue #274). So a request the network has not answered within
  // NET_WAIT_MS is answered from the cache, when the cache has it. Nothing is aborted: an abort
  // that fires once the headers are in errors the body the page is still reading, and on a slow
  // connection a locale pack or a chunk that was on its way failed outright, every start again,
  // since a body that never finishes is never cached either (and AbortSignal.timeout, which the
  // abort used, does not exist before iOS 16: the handler threw before it answered at all, the
  // cache fallback with it). A request the cache cannot answer keeps waiting for the network, as
  // it always did; and the network's answer, whenever it comes, still refreshes the cache.
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(hit =>
    hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
  e.respondWith(new Promise(resolve => {
    const slow = setTimeout(() => fromCache().then(hit => { if (hit) resolve(hit) }, () => {}), NET_WAIT_MS)
    fetch(e.request).then(res => {
      clearTimeout(slow)
      if (goodAsset(e.request.url, res)) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}) }
      resolve(res)
    }, () => {
      clearTimeout(slow)
      resolve(fromCache())
    })
  }))
})
