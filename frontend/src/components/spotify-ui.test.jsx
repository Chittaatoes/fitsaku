// @vitest-environment happy-dom
// Profile's Spotify card and the workout's music panel, against a faked REPO API. The server is
// the only thing they talk to; what they show is what it answers.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { setLang } from '../lib/i18n.js'
import SpotifyCard from './SpotifyCard.jsx'
import MusicPanel from './MusicPanel.jsx'
import { useUI } from '../store/useUI.js'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/profile' }) }))
vi.mock('../lib/api.js', async importOriginal => ({ ...await importOriginal(), api: vi.fn() }))
import { api } from '../lib/api.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** Scripted server: "METHOD /path" → value, or a function returning one, or an Error-shaped object to throw. */
let script, calls
const fail = (status, code, extra = {}) => Object.assign(new Error(code), { status, data: { code, ...extra } })
function serve(table) {
  script = table
  api.mockImplementation(async (path, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    const key = method + ' ' + path.split('?')[0]
    calls.push({ key, path, body: opts.body ? JSON.parse(opts.body) : undefined })
    if (!(key in script)) throw fail(404, 'not_found')
    const v = typeof script[key] === 'function' ? script[key](path) : script[key]
    if (v instanceof Error) throw v
    return v
  })
}
const ok = { ok: true }
const CONNECTED = { configured: true, connected: true, account: { name: 'Dewi', product: 'premium' }, scopes: [], missingScopes: [] }

let host, root
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const text = () => host.textContent
const button = label => [...host.querySelectorAll('button, a')].find(b => (b.textContent.trim() === label) || b.getAttribute('aria-label') === label)
const click = async label => { const b = button(label); expect(b, label).toBeTruthy(); await act(async () => { b.click() }); await flush() }

beforeEach(async () => {
  calls = []; nav.mockClear(); api.mockReset(); await setLang('en'); useUI.setState({ extMusic: false })
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 'u1', name: 'Dewi' } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const mount = async el => { await act(async () => { root.render(el) }); await flush() }

/* ============================== Profile card ============================== */

describe('the Spotify card', () => {
  it('says plainly when the server has no Spotify set up, and offers nothing to connect', async () => {
    serve({ 'GET /api/spotify/status': { configured: false, connected: false } })
    await mount(<SpotifyCard />)
    expect(text()).toMatch(/not set up on this server/)
    expect(button('Connect Spotify')).toBeUndefined()
  })

  it('a guest is asked to sign in and nothing is requested', async () => {
    useStore.setState({ user: null })
    serve({})
    await mount(<SpotifyCard />)
    expect(text()).toMatch(/Sign in to REPO/)
    expect(calls).toEqual([])
  })

  it('disconnected: explains the access, says REPO works without it, and Connect sends the browser to Spotify', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, configurable: true, writable: true })
    serve({
      'GET /api/spotify/status': { configured: true, connected: false },
      'POST /api/spotify/connect': { url: 'https://accounts.spotify.com/authorize?x=1' },
    })
    await mount(<SpotifyCard />)
    expect(text()).toMatch(/REPO works fully without Spotify/)
    expect(text()).toMatch(/Read your playlists/)
    await click('Connect Spotify')
    expect(assign).toHaveBeenCalledWith('https://accounts.spotify.com/authorize?x=1')
  })

  it('connected: shows the account Spotify reported, not a stored flag', async () => {
    serve({ 'GET /api/spotify/status': CONNECTED })
    await mount(<SpotifyCard />)
    expect(text()).toContain('Dewi')
    expect(text()).toMatch(/Connected · Premium/)
    expect(button('Disconnect Spotify')).toBeTruthy()
    expect(JSON.stringify(useStore.getState().S)).not.toMatch(/token|refresh/i)
  })

  it('a free account is told playback control needs Premium', async () => {
    serve({ 'GET /api/spotify/status': { ...CONNECTED, account: { name: 'Dewi', product: 'free' } } })
    await mount(<SpotifyCard />)
    expect(text()).toMatch(/needs Spotify Premium/)
  })

  it('missing permissions are named with a way to reconnect', async () => {
    serve({ 'GET /api/spotify/status': { ...CONNECTED, missingScopes: ['user-modify-playback-state'] } })
    await mount(<SpotifyCard />)
    expect(text()).toMatch(/permissions were not granted/)
    expect(button('Reconnect Spotify')).toBeTruthy()
  })

  it('a failed status request can be retried', async () => {
    let n = 0
    serve({ 'GET /api/spotify/status': () => (n++ ? CONNECTED : fail(0, 'unavailable')) })
    await mount(<SpotifyCard />)
    expect(text()).toMatch(/not reachable/)
    await click('Try again')
    expect(text()).toContain('Dewi')
  })
})

const pl = (n, extra = {}) => ({ id: 'p' + n, uri: 'spotify:playlist:p' + n, name: 'List ' + n, image: null, owner: 'Dewi', url: 'https://open.spotify.com/playlist/p' + n, tracks: n, ...extra })

describe('choosing a workout playlist', () => {
  const open = async () => { await mount(<SpotifyCard />); await click('Choose a playlist') }

  it('lists playlists with their Spotify link, pages on request, and keeps only the chosen one\'s reference', async () => {
    serve({
      'GET /api/spotify/status': CONNECTED,
      'GET /api/spotify/playlists': path => (path.includes('offset=0') ? { items: [pl(1), pl(2)], total: 3, next: 20 } : { items: [pl(3)], total: 3, next: null }),
    })
    await open()
    expect(text()).toContain('List 1'); expect(text()).toContain('List 2')
    expect(host.querySelector('a[href="https://open.spotify.com/playlist/p1"]')).toBeTruthy()
    await click('Load more')
    expect(text()).toContain('List 3')
    expect(button('Load more')).toBeUndefined()
    expect(calls.filter(c => c.key === 'GET /api/spotify/playlists').map(c => c.path)).toEqual([
      '/api/spotify/playlists?offset=0&limit=20', '/api/spotify/playlists?offset=20&limit=20'])

    await act(async () => { [...host.querySelectorAll('.spot-item')][1].querySelector('button').click() })
    expect(useStore.getState().S.spotifyPlaylist).toEqual({ id: 'p2', uri: 'spotify:playlist:p2', name: 'List 2', image: null, url: 'https://open.spotify.com/playlist/p2' })
    expect(text()).toContain('List 2')
    expect(button('Change playlist')).toBeTruthy()
  })

  it('the choice can be cleared, and survives a language change', async () => {
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), spotifyPlaylist: { id: 'p1', uri: 'spotify:playlist:p1', name: 'Lift', image: null, url: null } } })
    serve({ 'GET /api/spotify/status': CONNECTED })
    await mount(<SpotifyCard />)
    expect(text()).toContain('Lift')
    await setLang('id')
    await mount(<SpotifyCard key="id" />)
    expect(text()).toContain('Lift')
    expect(useStore.getState().S.spotifyPlaylist.id).toBe('p1')
    await click('Hapus')
    expect(useStore.getState().S.spotifyPlaylist).toBeNull()
  })

  it('shows an honest empty state with a way to open Spotify', async () => {
    serve({ 'GET /api/spotify/status': CONNECTED, 'GET /api/spotify/playlists': { items: [], total: 0, next: null } })
    await open()
    expect(text()).toMatch(/No playlists on this Spotify account/)
    expect(host.querySelector('a[href="https://open.spotify.com"]')).toBeTruthy()
  })

  it('handles missing cover and owner, and says so when Spotify rate-limits, with a retry', async () => {
    let n = 0
    serve({
      'GET /api/spotify/status': CONNECTED,
      'GET /api/spotify/playlists': () => (n++ ? { items: [pl(1, { owner: null, tracks: null, url: null })], total: 1, next: null } : fail(429, 'rate_limited', { retryAfter: 9 })),
    })
    await open()
    expect(text()).toMatch(/limiting requests. Try again in 9 s/)
    await click('Try again')
    expect(text()).toContain('List 1')
    expect(host.querySelector('.spot-item img')).toBeNull()
  })

  it('an ended connection sends the card back to disconnected instead of looping', async () => {
    let s = 0
    serve({
      'GET /api/spotify/status': () => (s++ ? { configured: true, connected: false } : CONNECTED),
      'GET /api/spotify/playlists': fail(401, 'reauth'),
    })
    await open()
    expect(button('Connect Spotify')).toBeTruthy()
  })
})

/* ============================== Workout music panel ============================== */

describe('the workout music panel', () => {
  const PLAYING = {
    active: true, playing: true, device: { id: 'd1', name: 'Phone', type: 'Smartphone' }, context: 'spotify:playlist:p1',
    track: { name: 'Song', artists: ['A', 'B'], image: 'https://i/x.jpg', url: 'https://open.spotify.com/track/t' },
  }
  const withPlaylist = () => useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), spotifyPlaylist: { id: 'p1', uri: 'spotify:playlist:p1', name: 'Lift', image: null, url: 'https://open.spotify.com/playlist/p1' } } })
  const openPanel = async () => { await mount(<MusicPanel />); await act(async () => { host.querySelector('.musicpanel-bar').click() }); await flush() }

  it('is folded, shows the chosen playlist, and asks Spotify for nothing until opened', async () => {
    withPlaylist(); serve({})
    await mount(<MusicPanel />)
    expect(text()).toContain('Lift')
    expect(calls).toEqual([])
  })

  it('offers connecting when Spotify is not connected, without leaving the workout', async () => {
    serve({ 'GET /api/spotify/status': { configured: true, connected: false } })
    await openPanel()
    expect(text()).toMatch(/Your workout works without it/)
    await click('Connect Spotify')
    expect(nav).toHaveBeenCalledWith('/profile')
  })

  it('says so when the server has no Spotify, and for a guest', async () => {
    serve({ 'GET /api/spotify/status': { configured: false, connected: false } })
    await openPanel()
    expect(text()).toMatch(/not set up on this server/)
    act(() => root.unmount()); root = createRoot(host)
    useStore.setState({ user: null }); calls.length = 0
    await mount(<MusicPanel />); await act(async () => { host.querySelector('.musicpanel-bar').click() }); await flush()
    expect(text()).toMatch(/Sign in to REPO/)
    expect(calls).toEqual([])
  })

  it('shows what Spotify reports is playing, with a link, and the controls', async () => {
    withPlaylist()
    serve({ 'GET /api/spotify/status': CONNECTED, 'GET /api/spotify/player': PLAYING })
    await openPanel()
    expect(text()).toContain('Song'); expect(text()).toContain('A, B'); expect(text()).toContain('on Phone')
    expect(host.querySelector('a[href="https://open.spotify.com/track/t"]')).toBeTruthy()
    expect(button('Pause')).toBeTruthy(); expect(button('Next track')).toBeTruthy(); expect(button('Previous track')).toBeTruthy()
  })

  it('pausing sends the command and then reads the real state back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let playing = true
    serve({
      'GET /api/spotify/status': CONNECTED,
      'GET /api/spotify/player': () => ({ ...PLAYING, playing }),
      'POST /api/spotify/player/pause': () => { playing = false; return ok },
    })
    await openPanel()
    await act(async () => { button('Pause').click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(calls.map(c => c.key).slice(-2)).toEqual(['POST /api/spotify/player/pause', 'GET /api/spotify/player'])
    expect(button('Resume')).toBeTruthy()
  })

  it('starting the playlist is explicit, targets the active device, and nothing starts on its own', async () => {
    withPlaylist()
    serve({
      'GET /api/spotify/status': CONNECTED,
      'GET /api/spotify/player': { active: true, playing: false, device: { id: 'd1', name: 'Phone', type: 'Smartphone' }, track: null },
      'POST /api/spotify/player/play': ok,
    })
    await openPanel()
    expect(calls.some(c => c.key === 'POST /api/spotify/player/play')).toBe(false)
    await click('Play this playlist')
    expect(calls.find(c => c.key === 'POST /api/spotify/player/play').body).toEqual({ context_uri: 'spotify:playlist:p1', device_id: 'd1' })
  })

  it('no active device: says so, lists the devices, and moves playback to the one chosen', async () => {
    withPlaylist()
    serve({
      'GET /api/spotify/status': CONNECTED,
      'GET /api/spotify/player': { active: false },
      'GET /api/spotify/devices': { devices: [{ id: 'd9', name: 'Kitchen', type: 'Speaker', active: false, restricted: false }] },
      'POST /api/spotify/player/transfer': ok,
    })
    await openPanel()
    expect(text()).toMatch(/Nothing is playing on Spotify/)
    await click('Choose a device')
    await click('Kitchen')
    expect(calls.find(c => c.key === 'POST /api/spotify/player/transfer').body).toEqual({ device_id: 'd9', play: true })
  })

  it('Premium required is explained, not reported as success', async () => {
    withPlaylist()
    serve({
      'GET /api/spotify/status': { ...CONNECTED, account: { name: 'D', product: 'free' } },
      'GET /api/spotify/player': { active: true, playing: false, device: { id: 'd1', name: 'Phone', type: 'x' }, track: null },
      'POST /api/spotify/player/play': fail(403, 'premium'),
    })
    await openPanel()
    await click('Play this playlist')
    expect(text()).toMatch(/needs Spotify Premium/)
  })

  it('a rate limit pauses commands without asking Spotify again', async () => {
    withPlaylist()
    serve({
      'GET /api/spotify/status': CONNECTED,
      'GET /api/spotify/player': { active: true, playing: true, device: { id: 'd1', name: 'P', type: 'x' }, track: PLAYING.track },
      'POST /api/spotify/player/next': fail(429, 'rate_limited', { retryAfter: 30 }),
    })
    await openPanel()
    await click('Next track')
    expect(text()).toMatch(/limiting requests/)
    const before = calls.length
    await click('Next track')
    expect(calls.length).toBe(before)
  })

  it('an unreachable Spotify changes only what the panel says', async () => {
    serve({ 'GET /api/spotify/status': fail(0, 'unavailable') })
    await openPanel()
    expect(text()).toMatch(/not reachable/)
  })

  it('an ended connection turns into an offer to connect again', async () => {
    serve({ 'GET /api/spotify/status': CONNECTED, 'GET /api/spotify/player': fail(401, 'reauth') })
    await openPanel()
    expect(text()).toMatch(/Your Spotify connection ended/)
    expect(button('Connect Spotify')).toBeTruthy()
  })


  it('tells the built-in workout sound to stay quiet while Spotify plays, and lets it back when it pauses', async () => {
    let playing = true
    serve({ 'GET /api/spotify/status': CONNECTED, 'GET /api/spotify/player': () => ({ ...PLAYING, playing }) })
    await openPanel()
    expect(useUI.getState().extMusic).toBe(true)
    playing = false
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    // the panel reads the state again on its poll or after a command: simulate the poll
    await act(async () => { host.querySelector('.musicpanel-bar').click() })
    await act(async () => { host.querySelector('.musicpanel-bar').click() }); await flush()
    expect(useUI.getState().extMusic).toBe(false)
  })

  it('shows the built-in sound controls even when Spotify is not connected', async () => {
    serve({ 'GET /api/spotify/status': { configured: true, connected: false } })
    await openPanel()
    expect(host.querySelector('.amb')).toBeTruthy()
    expect(text()).toContain('Workout sound')
  })

  it('is in Indonesian when the language is, and the playlist is untouched', async () => {
    withPlaylist(); await setLang('id')
    serve({ 'GET /api/spotify/status': CONNECTED, 'GET /api/spotify/player': PLAYING })
    await mount(<MusicPanel />)
    expect(text()).toContain('Musik'); expect(text()).toContain('Lift')
    await act(async () => { host.querySelector('.musicpanel-bar').click() }); await flush()
    expect(button('Jeda')).toBeTruthy()
    expect(text()).toContain('Playlist latihan')
    expect(useStore.getState().S.spotifyPlaylist.id).toBe('p1')
  })
})
