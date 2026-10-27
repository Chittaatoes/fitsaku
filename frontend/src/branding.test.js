// @vitest-environment happy-dom
// FitSaku's identity in the places a user or a browser reads it, and the build without the
// third-party exercise media (VITE_BUILTIN_MEDIA=0): the catalogue stays, the pictures do not.
import fs from 'node:fs'
import path from 'node:path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

describe('branding metadata', () => {
  it('names the product FitSaku in the page title, install name and manifest', () => {
    const html = read('index.html')
    expect(html).toMatch(/<title>FitSaku<\/title>/)
    expect(html).toMatch(/apple-mobile-web-app-title" content="FitSaku"/)
    const m = JSON.parse(read('public/manifest.json'))
    expect(m.name).toBe('FitSaku'); expect(m.short_name).toBe('FitSaku')
    expect(JSON.stringify(m)).not.toMatch(/openGym/i)
    expect(JSON.parse(read('capacitor.config.json')).appName).toBe('FitSaku')
    expect(read('public/sw.js')).toMatch(/data\.title \|\| 'FitSaku'/)
  })
  it('keeps the technical identifiers that existing data and exports depend on', () => {
    expect(read('src/lib/mobile.js')).toMatch(/AUTO_BACKUP_DIR = 'openGym'/)      // where existing backups live
    expect(read('src/lib/backup-media.js')).toMatch(/BACKUP_JSON = 'opengym-backup.json'/)
    expect(read('public/sw.js')).toMatch(/opengym-device/)                         // the device-id cache
    expect(read('capacitor.config.json')).toMatch(/ch\.duartesantos\.opengym/)      // the app id
  })
})

describe('build without built-in exercise media', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  const ex = { id: 'x1', n: 'push-up', img: 'a.webp', gif: 'a.mp4', bp: 'chest', eq: 'body weight' }
  const mount = async el => { const host = document.createElement('div'); document.body.appendChild(host); const r = createRoot(host); globalThis.IS_REACT_ACT_ENVIRONMENT = true; await act(async () => r.render(el)); return host }

  it('shows the neutral tile, never an <img> or <video> from the media folder', async () => {
    vi.stubEnv('VITE_BUILTIN_MEDIA', '0'); vi.resetModules()
    const { Thumb, default: Media } = await import('./components/Media.jsx')
    const thumb = await mount(React.createElement(Thumb, { ex }))
    expect(thumb.querySelector('.thumb-x')).toBeTruthy(); expect(thumb.querySelector('img')).toBeNull()
    const big = await mount(React.createElement(Media, { ex, id: 'x1' }))
    expect(big.querySelector('img,video')).toBeNull()
  })
  it('asks for none of it in the background either', async () => {
    vi.stubEnv('VITE_BUILTIN_MEDIA', '0'); vi.resetModules()
    const { planMediaUrls } = await import('./lib/media-prefetch.js')
    expect(planMediaUrls({ routines: [{ ex: [{ id: 'x1' }] }] }, 'https://fitsaku.test/', { x1: ex })).toEqual([])
  })
  it('is on by default, so the self-hosted app keeps its pictures', async () => {
    const { planMediaUrls } = await import('./lib/media-prefetch.js')
    expect(planMediaUrls({ routines: [{ ex: [{ id: 'x1' }] }] }, 'https://fitsaku.test/', { x1: ex }).length).toBeGreaterThan(0)
  })
})
