// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setLang } from '../lib/i18n.js'

const amb = vi.hoisted(() => ({ play: vi.fn(() => true), stop: vi.fn(), setVolume: vi.fn() }))
vi.mock('../lib/ambient.js', () => ({ ambient: amb }))
import AmbientController from './AmbientController.jsx'
import AmbientControls from './AmbientControls.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const live = { id: 'a', entries: [], cur: 0, start: Date.now() }
const setS = patch => act(() => useStore.setState({ S: { ...useStore.getState().S, ...patch } }))
const lastPlay = () => amb.play.mock.calls.at(-1)

beforeEach(async () => {
  amb.play.mockClear(); amb.stop.mockClear(); amb.setVolume.mockClear()
  await setLang('en')
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), sound: true } })
  useUI.setState({ timer: null, extMusic: false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = el => act(() => root.render(el))

describe('the controller follows the workout', () => {
  it('is silent with no workout', () => {
    mount(<AmbientController />)
    expect(amb.play).not.toHaveBeenCalled()
    expect(amb.stop).toHaveBeenCalled()
  })

  it('starts the training sound when a workout starts, at the chosen volume, and stops when it ends', () => {
    setS({ ambientVol: 0.8 })
    mount(<AmbientController />)
    setS({ active: live })
    expect(lastPlay()).toEqual(['workout', 0.8])
    amb.stop.mockClear()
    setS({ active: null })
    expect(amb.stop).toHaveBeenCalled()
  })

  it('switches to the calm sound while a rest counts, and back when it is over', () => {
    setS({ active: live })
    mount(<AmbientController />)
    expect(lastPlay()[0]).toBe('workout')
    act(() => useUI.setState({ timer: { left: 60, total: 60, endsAt: Date.now() + 60000 } }))
    expect(lastPlay()[0]).toBe('rest')
    const calls = amb.play.mock.calls.length
    act(() => useUI.setState({ timer: { left: 59, total: 60, endsAt: Date.now() + 59000 } }))   // a tick of the countdown
    expect(amb.play.mock.calls.length).toBe(calls)                                              // nothing restarts every second
    act(() => useUI.setState({ timer: { left: 0, total: 60, ready: true } }))
    expect(lastPlay()[0]).toBe('workout')
    act(() => useUI.setState({ timer: null }))
    expect(lastPlay()[0]).toBe('workout')
  })

  it('"rest only" is quiet during sets and plays during rests', () => {
    setS({ active: live, ambient: 'rest' })
    mount(<AmbientController />)
    expect(amb.play).not.toHaveBeenCalled()
    act(() => useUI.setState({ timer: { left: 30, total: 30 } }))
    expect(lastPlay()[0]).toBe('rest')
    act(() => useUI.setState({ timer: null }))
    expect(amb.stop).toHaveBeenCalled()
  })

  it('stays quiet with Sound off, and starts when it is turned on', () => {
    setS({ active: live, sound: false })
    mount(<AmbientController />)
    expect(amb.play).not.toHaveBeenCalled()
    setS({ sound: true })
    expect(lastPlay()[0]).toBe('workout')
  })

  it('goes quiet while Spotify plays from the panel, and forgets that when the workout ends', () => {
    setS({ active: live })
    mount(<AmbientController />)
    amb.stop.mockClear()
    act(() => useUI.setState({ extMusic: true }))
    expect(amb.stop).toHaveBeenCalled()
    act(() => useUI.setState({ extMusic: false }))
    expect(lastPlay()[0]).toBe('workout')
    act(() => useUI.setState({ extMusic: true }))
    setS({ active: null })
    expect(useUI.getState().extMusic).toBe(false)
  })

  it('follows the volume slider and stops when the app unmounts', () => {
    setS({ active: live })
    mount(<AmbientController />)
    setS({ ambientVol: 0.2 })
    expect(amb.setVolume).toHaveBeenLastCalledWith(0.2)
    act(() => root.render(null))
    expect(amb.stop).toHaveBeenLastCalledWith(0.2)
  })
})

describe('the controls', () => {
  const radios = () => [...host.querySelectorAll('[role=radio]')]
  it('offer off, rest only, workout + rest, with the current one chosen', () => {
    mount(<AmbientControls />)
    expect(radios().map(r => r.textContent)).toEqual(['Off', 'Rest only', 'Workout + rest'])
    expect(radios().map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])   // the default is both
  })
  it('changing them is stored in the settings, and the volume slider goes only when it is off', () => {
    mount(<AmbientControls />)
    act(() => radios()[1].click())
    expect(useStore.getState().S.ambient).toBe('rest')
    const slider = host.querySelector('input[type=range]')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '30')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStore.getState().S.ambientVol).toBe(0.3)
    act(() => radios()[0].click())
    expect(host.querySelector('input[type=range]')).toBeNull()
  })
  it('say when Sound is off in Settings, so silence is not a mystery', () => {
    setS({ sound: false })
    mount(<AmbientControls />)
    expect(host.textContent).toMatch(/Sound is off, so nothing plays/)
  })
  it('read in Indonesian', async () => {
    await setLang('id')
    mount(<AmbientControls key="id" />)
    expect(radios().map(r => r.textContent)).toEqual(['Matikan', 'Hanya istirahat', 'Latihan + istirahat'])
    expect(host.textContent).toContain('Suara latihan')
  })
})
