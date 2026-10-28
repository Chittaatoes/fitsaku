// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

// A player stand-in: it plays and pauses, which is what the controller asks of it and reads back.
const music = vi.hoisted(() => {
  const o = {
    state: { playing: false },
    start: vi.fn(({ autoplay = true } = {}) => { o.state = { playing: autoplay }; return Promise.resolve() }),
    stop: vi.fn(() => { o.state = { playing: false } }),
    pause: vi.fn(() => { o.state = { playing: false } }),
    play: vi.fn(() => { o.state = { playing: true }; return Promise.resolve() }),
    setVolume: vi.fn(),
  }
  return o
})
vi.mock('../lib/music.js', () => ({ music }))
import MusicController from './MusicController.jsx'

let host, root
const setS = over => act(() => useStore.setState(s => ({ S: { ...s.S, sound: true, musicAuto: undefined, active: null, ...over } })))
const setTimer = timer => act(() => useUI.setState({ timer }))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  for (const f of [music.start, music.stop, music.pause, music.play, music.setVolume]) f.mockClear()
  music.state = { playing: false }
  useUI.setState({ timer: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = () => act(() => root.render(<MusicController />))
const session = over => ({ id: 'a', name: 'Chest', d: '2026-10-29', entries: [{ id: '0025', sets: [] }], ...over })
const REST = { left: 60, total: 60, endsAt: Date.now() + 60000 }

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
    setTimer(REST)
    setTimer(null)
    setS({ active: null })
    setS({ active: session({ backfill: { replaceId: null } }) })
    expect(music.start).not.toHaveBeenCalled()
    expect(music.pause).not.toHaveBeenCalled()
  })
})

describe('the music gives way to the rest sound, and takes the workout back after it', () => {
  it('a set done starts a rest: the music pauses; the rest is over: it carries on', () => {
    setS({ active: session() }); mount()
    expect(music.state.playing).toBe(true)
    setTimer(REST)
    expect(music.pause).toHaveBeenCalledTimes(1)
    expect(music.state.playing).toBe(false)
    setTimer({ ...REST, left: 59 })                                    // a tick of the countdown: nothing more happens
    expect(music.pause).toHaveBeenCalledTimes(1)
    expect(music.play).not.toHaveBeenCalled()
    setTimer({ left: 0, total: 60, ready: true })                      // "Ready": the rest is over
    expect(music.play).toHaveBeenCalledTimes(1)
    expect(music.state.playing).toBe(true)
  })

  it('also when the rest is skipped or ends by taking the timer away', () => {
    setS({ active: session() }); mount()
    setTimer(REST)
    setTimer(null)
    expect(music.play).toHaveBeenCalledTimes(1)
  })

  it('every rest in the workout does the same, and the song is not restarted: it is played on', () => {
    setS({ active: session() }); mount()
    for (let i = 0; i < 3; i++) { setTimer(REST); setTimer(null) }
    expect(music.pause).toHaveBeenCalledTimes(3)
    expect(music.play).toHaveBeenCalledTimes(3)
    expect(music.start).toHaveBeenCalledTimes(1)
  })

  it('a paused rest and the switch-sides gap are training: the music does not give way', () => {
    setS({ active: session() }); mount()
    setTimer({ left: 40, total: 60, paused: true })
    setTimer({ left: 8, total: 10, kind: 'switch' })
    expect(music.pause).not.toHaveBeenCalled()
  })

  it('music the person paused stays paused through the rest', () => {
    setS({ active: session() }); mount()
    act(() => { music.state = { playing: false } })                    // paused by hand
    setTimer(REST)
    setTimer(null)
    expect(music.pause).not.toHaveBeenCalled()
    expect(music.play).not.toHaveBeenCalled()
  })

  it('with the music switched off for the workout there is nothing to give way, and nothing is started after the rest', () => {
    setS({ active: session(), musicAuto: false }); mount()
    setTimer(REST)
    setTimer(null)
    expect(music.pause).not.toHaveBeenCalled()
    expect(music.play).not.toHaveBeenCalled()
  })

  it('a workout that ends in the middle of a rest does not bring the music back', () => {
    setS({ active: session() }); mount()
    setTimer(REST)
    setS({ active: null })
    setTimer(null)
    expect(music.play).not.toHaveBeenCalled()
  })

  it('with the app Sound off the rest has no sound to hand over to: the music is left alone', () => {
    setS({ active: session(), sound: false }); mount()
    act(() => { music.state = { playing: true } })                     // started by hand
    setTimer(REST)
    expect(music.pause).not.toHaveBeenCalled()
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
