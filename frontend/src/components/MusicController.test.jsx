// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'

const music = vi.hoisted(() => ({ start: vi.fn(() => Promise.resolve()), stop: vi.fn(), setVolume: vi.fn() }))
vi.mock('../lib/music.js', () => ({ music }))
import MusicController from './MusicController.jsx'

let host, root
const setS = over => act(() => useStore.setState(s => ({ S: { ...s.S, sound: true, musicAuto: undefined, active: null, ...over } })))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  music.start.mockClear(); music.stop.mockClear(); music.setVolume.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = () => act(() => root.render(<MusicController />))
const session = over => ({ id: 'a', name: 'Chest', d: '2026-10-29', entries: [{ id: '0025', sets: [] }], ...over })

describe('the workout music follows the session', () => {
  it('starts from the first song, playing, when a workout begins', () => {
    setS(); mount()
    expect(music.start).not.toHaveBeenCalled()
    setS({ active: session() })
    expect(music.start).toHaveBeenCalledTimes(1)
    expect(music.start).toHaveBeenCalledWith({ autoplay: true })
  })

  it('selects the first song but does not play it when auto-play is off or the app Sound is off', () => {
    setS({ musicAuto: false }); mount()
    setS({ active: session(), musicAuto: false })
    expect(music.start).toHaveBeenLastCalledWith({ autoplay: false })
    setS({ active: null, musicAuto: undefined })
    setS({ active: session({ id: 'b' }), sound: false })
    expect(music.start).toHaveBeenLastCalledWith({ autoplay: false })
  })

  it('stops when the workout is over, and not before', () => {
    setS({ active: session() }); mount()
    expect(music.start).toHaveBeenCalledTimes(1)
    setS({ active: session({ name: 'Chest day' }) })      // an edit to the running session is not a new one
    expect(music.start).toHaveBeenCalledTimes(1)
    expect(music.stop).not.toHaveBeenCalled()
    setS({ active: null })
    expect(music.stop).toHaveBeenCalledTimes(1)
  })

  it('stays out of the editor of a saved workout and a past workout being logged', () => {
    setS(); mount()
    setS({ active: session({ editingWorkoutId: 'w1' }) })
    setS({ active: null })
    setS({ active: session({ backfill: { replaceId: null } }) })
    expect(music.start).not.toHaveBeenCalled()
  })
})

describe('a remount in the middle of a session', () => {
  it('starts the music again: the session is not taken for one already counted', () => {
    setS({ active: session() }); mount()
    expect(music.start).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    expect(music.stop).toHaveBeenCalledTimes(1)
    root = createRoot(host)
    mount()
    expect(music.start).toHaveBeenCalledTimes(2)
  })
})

describe('the volume slider is the music volume', () => {
  it('sets the music volume from the setting, before the first song starts', () => {
    setS({ ambientVol: 0.35 }); mount()
    setS({ active: session(), ambientVol: 0.35 })
    expect(music.setVolume).toHaveBeenCalledWith(0.35)
    expect(music.setVolume.mock.invocationCallOrder[0]).toBeLessThan(music.start.mock.invocationCallOrder[0])
  })
  it('follows the slider while a song plays', () => {
    setS({ active: session(), ambientVol: 0.5 }); mount()
    setS({ ambientVol: 0.9 })
    expect(music.setVolume).toHaveBeenLastCalledWith(0.9)
    setS({ ambientVol: 0 })
    expect(music.setVolume).toHaveBeenLastCalledWith(0)
  })
  it('an unset volume is the default, 0.8', () => {
    setS({ ambientVol: undefined }); mount()
    expect(music.setVolume).toHaveBeenLastCalledWith(0.8)
  })
})
