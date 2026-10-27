// The asset audit (scripts/audit-public-artifacts.mjs): it passes on the repository's real deployment
// inputs and on a clean build folder, and FAILS when restricted exercise media is present in a folder
// that would be published or when a deployment input would start shipping it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { auditDir, auditInputs, personalMedia, restrictedHashes } from '../../scripts/audit-public-artifacts.mjs'

const ROOT = path.resolve(__dirname, '..', '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fitsaku-audit-'))
const put = (dir, rel, data = 'x') => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data) }

describe('deployment inputs', () => {
  it('keep the restricted media out of every public path in this repository', () => {
    expect(auditInputs(ROOT)).toEqual([])
  })
  // A strict-mode checkout (no MEDIA_PERSONAL_USE.md): the files as they must look when the media is excluded.
  const withChange = (file, mutate) => {
    const root = tmp()
    for (const f of ['web/Dockerfile', '.dockerignore', '.gitignore', 'frontend/vercel.json', 'frontend/vite.config.js', 'render.yaml', 'api/Dockerfile']) put(root, f, fs.readFileSync(path.join(ROOT, f), 'utf8'))
    put(root, '.gitignore', fs.readFileSync(path.join(root, '.gitignore'), 'utf8') + '\ncatalogue/media/still/\ncatalogue/media/clip/\n')
    put(root, 'frontend/vercel.json', JSON.stringify({ build: { env: { VITE_BUILTIN_MEDIA: '0' } } }))
    put(root, file, mutate(fs.readFileSync(path.join(root, file), 'utf8')))
    return auditInputs(root)
  }
  it('are clean in strict mode too (no personal-use record)', () => {
    expect(withChange('.dockerignore', t => t)).toEqual([])
  })
  it('in personal-use mode require the notice, the bundling flag and a build that bundles', () => {
    expect(personalMedia(ROOT)).toBe(true)
    const root = tmp()
    for (const f of ['web/Dockerfile', '.dockerignore', 'frontend/vite.config.js', 'render.yaml', 'api/Dockerfile', 'frontend/vercel.json', 'catalogue/media/NOTICE.md']) put(root, f, fs.readFileSync(path.join(ROOT, f), 'utf8'))
    put(root, 'MEDIA_PERSONAL_USE.md', 'x')
    expect(auditInputs(root)).toEqual([])
    put(root, 'frontend/vercel.json', JSON.stringify({ build: { env: { VITE_BUILTIN_MEDIA: '0' } } }))
    expect(auditInputs(root).join()).toMatch(/personal-use mode/)
    fs.rmSync(path.join(root, 'catalogue/media/NOTICE.md'))
    expect(auditInputs(root).join()).toMatch(/NOTICE\.md: missing/)
  })
  it('fail when the web image copies the media unconditionally', () => {
    expect(withChange('web/Dockerfile', t => t + '\nCOPY catalogue/media/ /usr/share/nginx/html/exercise-media/\n').join()).toMatch(/outside the optional media-1 stage/)
  })
  it('fail when the media default is switched on, or the ignore lines are removed', () => {
    expect(withChange('web/Dockerfile', t => t.replace('ARG INCLUDE_EXERCISE_MEDIA=0', 'ARG INCLUDE_EXERCISE_MEDIA=1')).join()).toMatch(/must default to 0/)
    expect(withChange('.dockerignore', t => t.replace('catalogue/media/clip', '')).join()).toMatch(/\.dockerignore/)
    expect(withChange('.gitignore', t => t.replace(/^catalogue\/media\/still\/$/m, '')).join()).toMatch(/\.gitignore/)
    expect(withChange('frontend/vercel.json', () => JSON.stringify({ build: { env: { VITE_BUILTIN_MEDIA: '1' } } })).join()).toMatch(/vercel\.json/)
  })
})

describe('a folder that would be published', () => {
  it('passes when it holds no restricted media', () => {
    const d = tmp(); put(d, 'index.html', '<html>'); put(d, 'assets/app.js', 'x'); put(d, 'exercise-media/NOTICE.md', 'licence notice')
    expect(auditDir(d, new Set())).toEqual([])
  })
  it('fails on an exercise-media path, a numeric still or clip, and any video or animation', () => {
    for (const rel of ['exercise-media/anything.bin', 'a/still/0001.webp', 'clip/12345.mp4', 'x/demo.mp4', 'y/loop.gif', 'z/a.webm']) {
      const d = tmp(); put(d, rel)
      expect(auditDir(d, new Set()), rel).not.toEqual([])
    }
  })
  it('in personal-use mode allows the media in exercise-media/still|clip only, and still refuses it anywhere else', () => {
    const d = tmp(); put(d, 'exercise-media/still/0001.webp'); put(d, 'exercise-media/clip/0001.mp4'); put(d, 'exercise-media/NOTICE.md')
    expect(auditDir(d, new Set(), { allowMedia: true })).toEqual([])
    expect(auditDir(d, new Set()).length).toBeGreaterThan(0)
    const e = tmp(); put(e, 'assets/0001.mp4'); put(e, 'exercise-media/other/0001.webp'); put(e, 'x/demo.gif')
    expect(auditDir(e, new Set(), { allowMedia: true }).length).toBe(3)
  })
  it('fails on a renamed copy of a restricted image, found by its hash', () => {
    const data = Buffer.alloc(4096, 7)
    const hash = require('node:crypto').createHash('sha256').update(data).digest('hex')
    const d = tmp(); put(d, 'assets/innocent-name.webp', data)
    expect(auditDir(d, new Set([hash])).join()).toMatch(/identical to a restricted exercise image/)
  })
  it('is clean for the real production build output when one exists', () => {
    const dist = path.join(ROOT, 'frontend', 'dist')
    if (!fs.existsSync(dist)) return
    expect(auditDir(dist, restrictedHashes(ROOT), { allowMedia: personalMedia(ROOT) })).toEqual([])
  }, 120000)      // hashes every restricted file present in a full checkout (hundreds of MB)
})
