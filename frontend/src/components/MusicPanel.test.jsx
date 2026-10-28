// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { setLang } from '../lib/i18n.js'

// A player stand-in with the real one's shape: the panel only reads state and calls actions.
const mm = vi.hoisted(() => {
  const subs = new Set()
  const o = {
    state: { index: 0, playing: false, blocked: false, error: false },
    subscribe: f => { subs.add(f); return () => subs.delete(f) },
    set(p) { o.state = { ...o.state, ...p }; subs.forEach(f => f()) },
    toggle: vi.fn(() => o.set({ playing: !o.state.playing })),
    next: vi.fn(() => o.set({ index: (o.state.index + 1) % 4, playing: true })),
    prev: vi.fn(() => o.set({ index: (o.state.index + 3) % 4, playing: true })),
  }
  return o
})
vi.mock('../lib/music.js', () => ({ music: mm, TRACKS: [1, 2, 3, 4].map(n => ({ id: 'music' + n, n, src: 'music/music' + n + '.mp3' })) }))
import MusicPanel from './MusicPanel.jsx'

let host, root
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await setLang('en')
  mm.state = { index: 0, playing: false, blocked: false, error: false }
  mm.toggle.mockClear(); mm.next.mockClear(); mm.prev.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => useStore.setState(s => ({ S: { ...s.S, musicAuto: undefined, sound: true, ambient: 'all' } })))
  act(() => root.render(<MusicPanel />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const btn = label => host.querySelector('button[aria-label="' + label + '"]')
const text = () => host.textContent

describe('the workout music card', () => {
  it('is one small row: the song (music1 by default), previous, play, next, and the sound settings button', () => {
    expect(text()).toContain('Music 1')
    expect(text()).toContain('1 / 4')
    for (const l of ['Previous track', 'Play', 'Next track', 'Workout sound settings']) expect(btn(l)).not.toBeNull()
    expect(host.querySelector('.mp-set')).toBeNull()                   // the settings stay folded
  })

  it('next and previous step the songs, and the play button pauses what plays', () => {
    act(() => btn('Next track').click())
    expect(mm.next).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Music 2')
    expect(btn('Pause')).not.toBeNull()                                // it is playing now
    act(() => btn('Pause').click())
    expect(mm.toggle).toHaveBeenCalledTimes(1)
    act(() => btn('Previous track').click())
    expect(mm.prev).toHaveBeenCalledTimes(1)
    expect(text()).toContain('Music 1')
  })

  it('the settings button opens the workout sound options and the auto-play switch, and closes them again', () => {
    act(() => btn('Workout sound settings').click())
    const set = host.querySelector('.mp-set')
    expect(set).not.toBeNull()
    expect(set.textContent).toContain('Workout sound')
    expect(set.textContent).toContain('Rest only')
    expect(set.textContent).not.toContain('Workout + rest')           // the training beat is gone
    expect(set.querySelector('input[type=range]')).not.toBeNull()     // the volume: the music's
    expect(set.textContent).toContain('Play music in a workout')
    act(() => btn('Workout sound settings').click())
    expect(host.querySelector('.mp-set')).toBeNull()
  })

  it('the options change the workout sound setting, and the switch the music auto-play', () => {
    act(() => btn('Workout sound settings').click())
    const chip = [...host.querySelectorAll('.amb-opts .chip')].find(c => c.textContent === 'Off')
    act(() => chip.click())
    expect(useStore.getState().S.ambient).toBe('off')
    const sw = host.querySelector('button[role="switch"][aria-label="Play music in a workout"]')
    expect(sw.getAttribute('aria-checked')).toBe('true')               // on unless turned off
    act(() => sw.click())
    expect(useStore.getState().S.musicAuto).toBe(false)
  })

  it('says when the browser is waiting for a touch, and when a song is missing', () => {
    act(() => mm.set({ blocked: true }))
    expect(text()).toContain('Tap to start the music')
    act(() => mm.set({ blocked: false, error: true }))
    expect(text()).toContain('Song not found')
  })

  it('speaks Indonesian', async () => {
    await act(async () => { await setLang('id') })
    expect(btn('Pengaturan suara latihan')).not.toBeNull()
  })
})
