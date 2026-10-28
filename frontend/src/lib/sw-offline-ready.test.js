/* The worker's offline readiness (public/sw.js): the language packs that come with a build, the status that says whether
 * the app can start with no network, the repair, the reset of the app's cache, the files with a hash in their name, and
 * the one older build whose cache stays. The worker runs stamped, as a build writes it, in a stand-in environment. */
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { langPacks, stampSw } from '../../scripts/sw-stamp.mjs'

const source = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://gym.test'
const sha10 = t => createHash('sha256').update(t).digest('hex').slice(0, 10)
const js = body => new Response(body, { headers: { 'content-type': 'text/javascript' } })
const page = body => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

const indexOf = (n = 'a') => `<html><head><script src="./assets/index-${n}abcdefg.js"></script><link rel="stylesheet" href="./assets/index-${n}abcdefg.css"></head></html>`
const LANGS = { de: ['./assets/de-aaaaaaaa.js', './assets/de-bbbbbbbb.js'], id: ['./assets/id-cccccccc.js'] }
const LAZY = ['./assets/ingest-dddddddd.js', './assets/en-eeeeeeee.js']

// A browser resolves a relative key against the worker's scope; so does this.
const norm = k => { try { return new URL(String(k && k.url ? k.url : k), ORIGIN + '/').href } catch { return String(k) } }
class Cache {
  constructor() { this.m = new Map() }
  async put(req, res) { const orig = String(req && req.url ? req.url : req); this.m.set(norm(orig), { orig, res }) }
  async match(req) { const e = this.m.get(norm(req)); return e ? e.res.clone() : undefined }
  async delete(req) { return this.m.delete(norm(req)) }
  async keys() { return [...this.m.values()].map(e => e.orig) }
}
class Caches {
  constructor() { this.c = new Map() }
  async open(n) { if (!this.c.has(n)) this.c.set(n, new Cache()); return this.c.get(n) }
  async keys() { return [...this.c.keys()] }
  async delete(n) { return this.c.delete(n) }
  async match(req) { for (const c of this.c.values()) { const hit = await c.match(req); if (hit) return hit } return undefined }
}

// A device: its caches live across workers, like a browser's.
function device() {
  const caches = new Caches()
  const answers = new Map()      // url -> () => Response, what the network answers; absent = the app's own page (a 200)
  const server = { set: (k, f) => answers.set(norm(k), f), delete: k => answers.delete(norm(k)) }
  const calls = []
  const state = { offline: false }
  const fetchImpl = async u => {
    const url = String(u && u.url ? u.url : u)
    calls.push(url)
    if (state.offline) throw new TypeError('offline')
    const make = answers.get(norm(url))
    return make ? make() : page('<html>the apps own index.html</html>')
  }
  return { caches, server, calls, state, fetchImpl }
}

// A worker of build `html`, stamped the way a build stamps it, on `dev`.
function worker(dev, html, { langs = LANGS, lazy = LAZY } = {}) {
  const stamp = sha10(html)
  const listeners = {}
  const self = { addEventListener: (t, f) => { listeners[t] = f }, skipWaiting: () => {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: { update: vi.fn() } }
  const ctx = { self, caches: dev.caches, fetch: dev.fetchImpl, location: { origin: ORIGIN, href: ORIGIN + '/' }, URL, Response, TextEncoder, crypto: webcrypto, console, setTimeout, clearTimeout }
  vm.runInNewContext(stampSw(source, { stamp, lazy, langs }), ctx)
  const w = { self, stamp, cache: 'opengym-rt-' + stamp }
  const run = async (type, ev = {}) => {
    const e = { ...ev, waitUntil: p => { e._done = p }, respondWith: p => { e._res = p } }
    listeners[type](e)
    if (e._done) await e._done
    return e
  }
  w.install = () => run('install')
  w.activate = () => run('activate')
  w.ask = async (type, extra = {}) => {
    let out
    const port = { postMessage: v => { out = v } }
    await run('message', { data: { type, ...extra }, ports: [port] })
    return out
  }
  w.tell = (type, extra = {}) => run('message', { data: { type, ...extra }, ports: [] })
  w.fetch = async url => { const e = await run('fetch', { request: { url: ORIGIN + url, method: 'GET', mode: 'cors', headers: new Headers() } }); return e }
  return w
}

// What the server has for a build whose index.html is `html`: the shell, the chunks, the packs.
function publish(dev, html, { langs = LANGS, lazy = LAZY, skip = [] } = {}) {
  dev.server.set('index.html', () => page(html))
  for (const u of [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])) dev.server.set(u, () => js('code ' + u))
  for (const u of [...lazy, ...Object.values(langs).flat()]) dev.server.set(u, () => js('code ' + u))
  for (const u of skip) dev.server.delete(u)
}
const setLang = async (dev, lang) => (await dev.caches.open('opengym-prefs')).put('/opengym-pref-lang', new Response(JSON.stringify(lang)))

describe('langPacks: the packs of each language, as the build lists them', () => {
  const chunk = (...ids) => ({ type: 'chunk', moduleIds: ids.map(i => '/app/frontend/src/' + i) })
  it('lists a language\'s locale, steps and exercise-name chunks, and leaves the English steps to the lazy list', () => {
    const bundle = {
      'assets/index-a.js': chunk('main.jsx'),
      'assets/de-c.js': chunk('locales/de.js'),
      'assets/de-d.js': chunk('instr/de.js'),
      'assets/de-n.js': chunk('exercise-names/de.js'),
      'assets/pt-BR-p.js': chunk('locales/pt-BR.js'),
      'assets/en-g.js': chunk('instr/en.js'),
      'assets/mixed-m.js': chunk('lib/x.js', 'locales/ru.js'),
      'assets/index-f.css': { type: 'asset' },
    }
    expect(langPacks(bundle)).toEqual({ de: ['./assets/de-c.js', './assets/de-d.js', './assets/de-n.js'], 'pt-BR': ['./assets/pt-BR-p.js'] })
  })
  it('knows no pack for a derived locale: de-CH is asked about by its base, de', () => {
    expect(langPacks({ 'assets/de-c.js': chunk('locales/de.js') })['de-CH']).toBeUndefined()
  })
  it('is stamped into the worker next to the build and the lazy list', () => {
    const sw = stampSw(source, { stamp: 'abc', lazy: [], langs: { de: ['./assets/de-x.js'] } })
    expect(sw).toContain('"{\\"de\\":[\\"./assets/de-x.js\\"]}"')
  })
})

describe('the language packs come with the build', () => {
  it('an install fetches the packs of the language the page last said it shows', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    await setLang(dev, 'de')
    const w = worker(dev, html)
    await w.install()
    const c = await dev.caches.open(w.cache)
    expect(await c.keys()).toEqual(expect.arrayContaining(['./assets/de-aaaaaaaa.js', './assets/de-bbbbbbbb.js']))
    expect(await c.keys()).not.toContain('./assets/id-cccccccc.js')
    expect((await w.ask('status', { lang: 'de' })).state).toBe('ready')
  })

  it('an install with no language recorded fetches no pack, and English needs none', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    const w = worker(dev, html)
    await w.install()
    expect(dev.calls.some(u => u.includes('de-aaaaaaaa'))).toBe(false)
    expect((await w.ask('status', { lang: 'en' })).state).toBe('ready')
  })

  it('a pack that will not come is no reason to fail the install, and shows as partial until it is fetched', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html, { skip: ['./assets/de-bbbbbbbb.js'] })
    await setLang(dev, 'de')
    const w = worker(dev, html)
    await expect(w.install()).resolves.toBeDefined()
    let st = await w.ask('status', { lang: 'de' })
    expect(st).toMatchObject({ state: 'partial', shell: 0, lang: 1 })
    publish(dev, html)                       // the server has it now
    st = await w.ask('repair', { lang: 'de' })
    expect(st.state).toBe('ready')
  })

  it('a pack that comes back as the app\'s own page is not stored under the pack\'s name', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    dev.server.set('./assets/de-aaaaaaaa.js', () => page('<html>index</html>'))
    await setLang(dev, 'de')
    const w = worker(dev, html)
    await w.install()
    expect(await (await dev.caches.open(w.cache)).keys()).not.toContain('./assets/de-aaaaaaaa.js')
    expect((await w.ask('status', { lang: 'de' })).state).toBe('partial')
  })

  it('a language with no packs on record is not called ready', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    const w = worker(dev, html)
    await w.install()
    expect(await w.ask('status', { lang: 'xx' })).toMatchObject({ state: 'partial', reason: 'lang-unmapped' })
  })

  it('is told the language when it changes and fetches that language\'s packs, once', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    const w = worker(dev, html)
    await w.install()
    await w.activate()
    await w.ask('lang', { lang: 'id' })
    expect(dev.calls.filter(u => u === './assets/id-cccccccc.js')).toHaveLength(1)
    await w.ask('lang', { lang: 'id' })
    expect(dev.calls.filter(u => u === './assets/id-cccccccc.js')).toHaveLength(1)
    // and it is what the next build's install asks for
    const next = worker(dev, indexOf('b'))
    publish(dev, indexOf('b'))
    await next.install()
    expect(await (await dev.caches.open(next.cache)).keys()).toContain('./assets/id-cccccccc.js')
  })

  it('ignores a language that is not a language', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    const w = worker(dev, html)
    await w.install()
    await w.tell('lang', { lang: '../../etc' })
    expect(await (await dev.caches.open('opengym-prefs')).match('/opengym-pref-lang')).toBeUndefined()
  })
})

describe('the readiness status', () => {
  it('is none where the cache holds no record of the build', async () => {
    const dev = device()
    const w = worker(dev, indexOf('a'))
    expect(await w.ask('status', { lang: 'en' })).toMatchObject({ state: 'none', reason: 'manifest' })
  })

  it('is none when a file of the shell is gone, and partial when only a chunk loaded on demand is', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    const w = worker(dev, html)
    await w.install()
    const c = await dev.caches.open(w.cache)
    await c.delete('./assets/ingest-dddddddd.js')
    expect(await w.ask('status', { lang: 'en' })).toMatchObject({ state: 'partial', lazy: 1, shell: 0 })
    await c.delete('./assets/index-aabcdefg.js')
    expect((await w.ask('status', { lang: 'en' })).state).toBe('none')
  })

  it('does not count a page standing in for a script', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    const w = worker(dev, html)
    await w.install()
    await (await dev.caches.open(w.cache)).put('./assets/index-aabcdefg.js', page('<html>login</html>'))
    expect((await w.ask('status', { lang: 'en' })).state).toBe('none')
  })

  it('a shell file that will not cache fails the install, so no status is ever claimed for it', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html, { skip: ['./assets/index-aabcdefg.js'] })
    await expect(worker(dev, html).install()).rejects.toThrow()
  })

  it('a script answered with the app\'s own page fails the install', async () => {
    const dev = device(), html = indexOf('a')
    publish(dev, html)
    dev.server.set('./assets/index-aabcdefg.js', () => page('<html>index</html>'))
    await expect(worker(dev, html).install()).rejects.toThrow()
  })
})

describe('files with a content hash in their name', () => {
  const HASHED = '/assets/other-12345678.js'

  async function ready(dev, html) {
    publish(dev, html)
    const w = worker(dev, html)
    await w.install(); await w.activate()
    dev.calls.length = 0
    return w
  }

  it('come from the cache without the network, and are stored when they have to be fetched', async () => {
    const dev = device(), html = indexOf('a')
    const w = await ready(dev, html)
    const c = await dev.caches.open(w.cache)
    await c.put('./assets/index-aabcdefg.js', js('cached'))
    const hit = await w.fetch('/assets/index-aabcdefg.js')
    expect(await (await hit._res).text()).toBe('cached')
    expect(dev.calls).toEqual([])
    dev.server.set(ORIGIN + HASHED, () => js('fresh'))
    const miss = await w.fetch(HASHED)
    expect(await (await miss._res).text()).toBe('fresh')
    expect(await c.keys()).toContain(ORIGIN + HASHED)
  })

  it('are never stored when the server answers with the app\'s own page, which is still what the page gets', async () => {
    const dev = device(), html = indexOf('a')
    const w = await ready(dev, html)
    const e = await w.fetch('/assets/gone-87654321.js')
    expect((await e._res).headers.get('content-type')).toMatch(/html/)
    expect(await (await dev.caches.open(w.cache)).keys()).not.toContain(ORIGIN + '/assets/gone-87654321.js')
  })

  it('are looked for in the previous build\'s cache only when this build does not own them', async () => {
    const dev = device()
    // the build before: a cache of its own, remembered as the one to keep
    const before = worker(dev, indexOf('a'))
    publish(dev, indexOf('a'))
    await before.install(); await before.activate()
    await (await dev.caches.open(before.cache)).put(ORIGIN + '/assets/old-onlyold1.js', js('old code'))
    await (await dev.caches.open(before.cache)).put('./assets/index-babcdefg.js', js('OLD COPY of a file the new build owns'))
    const html = indexOf('b')
    publish(dev, html)
    const now = worker(dev, html)
    await now.install(); await now.activate()
    dev.calls.length = 0
    // a file only the old build had: served from the old cache, no network
    const old = await now.fetch('/assets/old-onlyold1.js')
    expect(await (await old._res).text()).toBe('old code')
    expect(dev.calls).toEqual([])
    // a file the new build owns, missing from its cache: the network, never the old build's copy of the same name
    await (await dev.caches.open(now.cache)).delete('./assets/ingest-dddddddd.js')
    await (await dev.caches.open(before.cache)).put('./assets/ingest-dddddddd.js', js('stale ingest'))
    const mine = await now.fetch('/assets/ingest-dddddddd.js')
    expect(await (await mine._res).text()).toBe('code ./assets/ingest-dddddddd.js')
  })

  it('are told apart by their names: a dash inside the hash and a bundler’s extra characters count, a short tail does not', async () => {
    const dev = device(), html = indexOf('a')
    const w = await ready(dev, html)
    const store = await dev.caches.open(w.cache)
    const served = async path => {
      await store.put(ORIGIN + path, js('cached'))
      dev.server.set(ORIGIN + path, () => js('fresh'))
      dev.calls.length = 0
      const e = await w.fetch(path)
      return { body: await (await e._res).text(), network: dev.calls.length }
    }
    expect(await served('/assets/en-BZEO-2l9.js')).toEqual({ body: 'cached', network: 0 })     // 'BZEO-2l9' is the hash
    expect(await served('/assets/fr-CeG6qRZC2.js')).toEqual({ body: 'cached', network: 0 })    // eight characters and a 2 for a name clash
    expect(await served('/assets/de-abc.js')).toEqual({ body: 'fresh', network: 1 })           // not hashed: network first, as before
    expect(await served('/assets/sub/x-12345678.js')).toEqual({ body: 'fresh', network: 1 })    // only files directly under assets/
  })

  it('leave the workout songs to the browser: no cache, no answer from the worker', async () => {
    const dev = device(), html = indexOf('a')
    const w = await ready(dev, html)
    const e = await w.fetch('/music/music1.mp3')
    expect(e._res).toBeUndefined()
    expect(await (await dev.caches.open(w.cache)).keys()).not.toContain(ORIGIN + '/music/music1.mp3')
  })

  it('leave /api/ alone, and a name that is not a hash is the old network-first way', async () => {
    const dev = device(), html = indexOf('a')
    const w = await ready(dev, html)
    const api = await w.fetch('/api/data')
    expect(api._res).toBeUndefined()
    const plain = await w.fetch('/assets/de-abc.js')
    expect(plain._res).toBeDefined()
  })
})

describe('which build caches stay', () => {
  it('keeps the build before this one, drops the one before that, and never touches the media, the device id or the preferences', async () => {
    const dev = device()
    await (await dev.caches.open('opengym-media-v1')).put('/exercise-media/x.webp', new Response('img'))
    await (await dev.caches.open('opengym-device')).put('/opengym-device-id', new Response('dev1234abcd'))
    const builds = []
    for (const n of ['a', 'b', 'c']) {
      const html = indexOf(n)
      publish(dev, html)
      const w = worker(dev, html)
      await w.install(); await w.activate()
      builds.push(w.cache)
    }
    const keys = await dev.caches.keys()
    expect(keys).not.toContain(builds[0])
    expect(keys).toEqual(expect.arrayContaining([builds[1], builds[2], 'opengym-media-v1', 'opengym-device', 'opengym-prefs']))
  })
})

describe('resetting the app\'s cache', () => {
  async function installed(letter = 'a') {
    const dev = device(), html = indexOf(letter)
    publish(dev, html)
    await (await dev.caches.open('opengym-media-v1')).put('/exercise-media/x.webp', new Response('img'))
    await (await dev.caches.open('opengym-device')).put('/opengym-device-id', new Response('dev1234abcd'))
    await setLang(dev, 'de')
    const w = worker(dev, html)
    await w.install(); await w.activate()
    return { dev, w, html }
  }

  it('rebuilds the build cache from the network, and touches only the app\'s own build caches', async () => {
    const { dev, w } = await installed()
    const old = await dev.caches.open('opengym-rt-someolderbuild')
    await old.put('index.html', page('old'))
    await (await dev.caches.open(w.cache)).delete('./assets/ingest-dddddddd.js')       // a damaged cache
    const r = await w.ask('reset', { lang: 'de' })
    expect(r).toMatchObject({ ok: true, state: 'ready' })
    const keys = await dev.caches.keys()
    expect(keys).not.toContain('opengym-rt-someolderbuild')
    expect(keys.filter(k => k.endsWith('-reset'))).toEqual([])           // the staging copy is gone
    expect(keys).toEqual(expect.arrayContaining([w.cache, 'opengym-media-v1', 'opengym-device', 'opengym-prefs']))
    expect(await (await (await dev.caches.open('opengym-device')).match('/opengym-device-id')).text()).toBe('dev1234abcd')
    expect(await (await dev.caches.open('opengym-media-v1')).keys()).toEqual(['/exercise-media/x.webp'])
    expect(await (await dev.caches.open(w.cache)).keys()).toContain('./assets/ingest-dddddddd.js')
  })

  it('writes the record of what the build needs again, for the build it belongs to', async () => {
    const { dev, w } = await installed()
    await (await dev.caches.open(w.cache)).put('/opengym-manifest', new Response(JSON.stringify({ build: 'stale', required: ['nothing.js'], lazy: [] })))
    expect((await w.ask('status', { lang: 'de' })).state).toBe('none')
    expect((await w.ask('reset', { lang: 'de' })).ok).toBe(true)
    const man = await (await (await dev.caches.open(w.cache)).match('/opengym-manifest')).json()
    expect(man.build).toBe(w.stamp)
    expect(man.required).toContain('index.html')
    expect((await w.ask('status', { lang: 'de' })).state).toBe('ready')
  })

  it('is refused offline, with the cache exactly as it was', async () => {
    const { dev, w } = await installed()
    const before = await (await dev.caches.open(w.cache)).keys()
    dev.state.offline = true
    expect(await w.ask('reset', { lang: 'de' })).toEqual({ ok: false, error: 'offline' })
    expect(await (await dev.caches.open(w.cache)).keys()).toEqual(before)
    expect(await dev.caches.keys()).not.toContain(w.cache + '-reset')
  })

  it('is refused when the server serves another build than this worker\'s, and the worker is asked to update', async () => {
    const { dev, w } = await installed('a')
    publish(dev, indexOf('b'))
    const before = await (await dev.caches.open(w.cache)).keys()
    expect(await w.ask('reset', { lang: 'de' })).toEqual({ ok: false, error: 'newer' })
    expect(w.self.registration.update).toHaveBeenCalled()
    expect(await (await dev.caches.open(w.cache)).keys()).toEqual(before)
  })

  it('a rebuild that fails leaves the old cache in place, says so, and does not claim to be ready', async () => {
    const { dev, w } = await installed()
    const before = await (await dev.caches.open(w.cache)).keys()
    dev.server.delete('./assets/index-aabcdefg.js')
    const r = await w.ask('reset', { lang: 'de' })
    expect(r).toEqual({ ok: false, error: 'failed' })
    expect(await (await dev.caches.open(w.cache)).keys()).toEqual(before)
    expect(await dev.caches.keys()).not.toContain(w.cache + '-reset')
  })

  it('a repair of a cache that is complete fetches nothing and answers ready', async () => {
    const { dev, w } = await installed()
    dev.calls.length = 0
    expect((await w.ask('repair', { lang: 'de' })).state).toBe('ready')
    expect(dev.calls).toEqual([])
  })
})
