import { readFileSync, writeFileSync, existsSync, cpSync, statSync, mkdirSync, copyFileSync, readdirSync, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { lazyAssets, langPacks, keepBuilt, stampSw } from './scripts/sw-stamp.mjs'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
// The API refuses a state-changing request that a browser sent from anywhere other than its own
// ORIGIN (the CSRF guard in api/server.js). The dev server is on a different port, so the page's
// real Origin is not ORIGIN — modern browsers get through on Sec-Fetch-Site: same-origin, and
// presenting the expected Origin here covers the ones that don't send it. Match your .env if you
// changed ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:8080'
// Exercise media: served straight from catalogue/media in dev (see catalogueMedia below), or
// proxied to a server of your choice with MEDIA_TARGET.
const media = process.env.MEDIA_TARGET
const catalogueMedia = {
  name: 'opengym-catalogue-media',
  // Dev server only: `vite build` never copies the media into dist. VITE_BUILTIN_MEDIA=0 (what the
  // FitSaku deployments set) stops even the dev server from serving the third-party files, so a
  // copy left in catalogue/media cannot be exposed by running it.
  apply: 'serve',
  configureServer(server) {
    if (media || process.env.VITE_BUILTIN_MEDIA === '0') return
    const dirs = { '/exercise-media/still/': ['still', '.webp'], '/exercise-media/clip/': ['clip', '.mp4'] }
    const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../catalogue/media')
    server.middlewares.use((req, res, next) => {
      const prefix = Object.keys(dirs).find(p => req.url.startsWith(p))
      if (!prefix) return next()
      const [dir, ext] = dirs[prefix]
      const name = decodeURIComponent(req.url.slice(prefix.length).split('?')[0])
      const file = join(root, dir, name)
      if (!/^\d{4,5}\.(webp|mp4)$/.test(name) || !name.endsWith(ext) || !existsSync(file)) { res.statusCode = 404; return res.end() }
      res.setHeader('Content-Type', ext === '.mp4' ? 'video/mp4' : 'image/webp')
      res.end(readFileSync(file))
    })
  }
}

// Personal-use build (see MEDIA_PERSONAL_USE.md): VITE_BUNDLE_MEDIA=1 copies the 180 px stills and clips from
// catalogue/media into dist/exercise-media, unmodified and with their licence notice, so a static host
// (Vercel) can serve them from the same origin. Off by default: an ordinary build ships none.
const bundleMedia = {
  name: 'fitsaku-bundle-media',
  apply: 'build',
  closeBundle() {
    if (process.env.VITE_BUNDLE_MEDIA !== '1' || process.env.VITE_BUILTIN_MEDIA === '0') return
    const src = resolve(fileURLToPath(new URL('.', import.meta.url)), '../catalogue/media')
    const out = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist/exercise-media')
    if (!existsSync(join(src, 'still'))) { console.warn('VITE_BUNDLE_MEDIA=1 but catalogue/media/still is missing: no exercise media bundled'); return }
    for (const d of ['still', 'clip', 'NOTICE.md']) if (existsSync(join(src, d))) cpSync(join(src, d), join(out, d), { recursive: true })
  }
}

// The workout's own songs (lib/music.js): assets/music/music1.mp3 … in the repository, outside frontend/. The dev server
// answers /music/<name>.mp3 from there (with byte ranges, which an audio element asks for to seek), and a build copies
// them to dist/music so any static host serves them from the app's own origin. A missing folder only means no music:
// the app plays nothing and says the song was not found.
const musicDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '../assets/music')
const MUSIC_FILE = /^music\d+\.mp3$/
const fitsakuMusic = {
  name: 'fitsaku-music',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/music\/([^/?]+\.mp3)(?:\?.*)?$/.exec(req.url || '')
      if (!m) return next()
      const name = decodeURIComponent(m[1])
      const file = join(musicDir, name)
      if (!MUSIC_FILE.test(name) || !existsSync(file)) { res.statusCode = 404; return res.end() }
      const size = statSync(file).size
      const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      res.setHeader('Content-Type', 'audio/mpeg')
      res.setHeader('Accept-Ranges', 'bytes')
      if (r && (r[1] || r[2])) {
        const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2]))
        const end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1
        if (start > end || start >= size) { res.statusCode = 416; res.setHeader('Content-Range', 'bytes */' + size); return res.end() }
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
        res.setHeader('Content-Length', String(end - start + 1))
        return createReadStream(file, { start, end }).pipe(res)
      }
      res.setHeader('Content-Length', String(size))
      createReadStream(file).pipe(res)
    })
  },
  closeBundle() {
    if (process.env.VITE_MOBILE === '1') return
    const out = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist/music')
    if (!existsSync(musicDir)) { console.warn('music: assets/music is missing, so no music is bundled'); return }
    const files = readdirSync(musicDir).filter(f => MUSIC_FILE.test(f))
    if (!files.length) { console.warn('music: assets/music holds no music<N>.mp3, so no music is bundled'); return }
    mkdirSync(out, { recursive: true })
    for (const f of files) copyFileSync(join(musicDir, f), join(out, f))
  }
}

// Optional web analytics (Umami). Injected only when BOTH vars are set at build time,
// so a plain `npm run build` — and every self-hosted install — stays telemetry-free.
// Set for the public instance: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'opengym-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

// The service worker's cache is named after the build (public/sw.js carries a `__BUILD__`
// placeholder): a deploy is then a new worker with its own cache, and the previous build's
// shell and chunks are dropped on activate instead of piling up under one fixed name. The
// stamp is a hash of the built index.html — it changes exactly when the bundle does.
// The directory is the one this build wrote to (`--outDir` included), not a fixed ./dist/: a
// build into a private outDir left `__BUILD__` unstamped in its sw.js.
// The worker also gets the build's code that loads on demand (`__LAZY__`, scripts/sw-stamp.mjs),
// so it is there offline before the page has ever needed it.
let outDir = fileURLToPath(new URL('./dist/', import.meta.url))
let lazy = []
let langs = {}
const swStamp = {
  name: 'opengym-sw-stamp',
  apply: 'build',
  configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
  generateBundle(_, bundle) { lazy = lazyAssets(bundle); langs = langPacks(bundle) },
  closeBundle() {
    const html = join(outDir, 'index.html'), sw = join(outDir, 'sw.js')
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    const built = keepBuilt({ lazy, langs }, u => existsSync(join(outDir, u.replace(/^\.\//, ''))))
    if (built.dropped.length) console.warn('sw: not in the build output, left out of the lists stamped into the worker:', built.dropped.join(', '))
    writeFileSync(sw, stampSw(readFileSync(sw, 'utf8'), { stamp, lazy: built.lazy, langs: built.langs }))
  }
}

// The phone flavour says so in its index.html. A web build that ran into the same dist/ between
// the mobile build and `cap sync` (two builds in one worktree) shipped the web shell inside an
// APK: no Android-only settings, a service worker, the passkey login. scripts/check-mobile-bundle.mjs
// reads this tag in the synced copy after `cap sync` and fails the build without it.
const flavor = {
  name: 'opengym-flavor',
  transformIndexHtml() {
    if (process.env.VITE_MOBILE !== '1') return
    return [{ tag: 'meta', attrs: { name: 'opengym-flavor', content: 'mobile' }, injectTo: 'head' }]
  }
}

// The version people are asked for in #install-help and on every bug report. Read from
// package.json so it cannot drift from the release it was built in, and inlined at build
// time so no runtime fetch is involved.
//
// APP_BUILD, when the build sets it, is appended as "1.3.8+<build>". A packaged build carries a
// version its package.json cannot know — every image built between two releases reports the same
// number, so the one question a bug report turns on, "which build were you running?", had no
// answer from inside the app. Unset (the ordinary case, and every upstream build) it changes
// nothing: the string is exactly package.json's version.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const appVersion = process.env.APP_BUILD ? `${pkgVersion}+${process.env.APP_BUILD}` : pkgVersion

export default defineConfig({
  // __BUILD_ID__: when this bundle was built (UTC, to the minute), shown in Settings > About and the viewport readout, so a
  // phone can say which deploy it is actually running.
  define: { __APP_VERSION__: JSON.stringify(appVersion), __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')) },
  plugins: [react(), umami, flavor, swStamp, catalogueMedia, bundleMedia, fitsakuMusic],
  base: './',
  server: {
    // The Coach's core (payload, validator, prompts, HTTP adapters) lives in ../api/coach/core
    // and is imported by the phone build. vite build and vitest already reach it; the dev
    // server needs to be told the workspace is wider than frontend/.
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      ...(media ? {
        '/exercise-media': { target: media, changeOrigin: true }
      } : {})
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
