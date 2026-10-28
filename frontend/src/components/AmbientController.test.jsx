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
  useUI.setState({ timer: null })
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

  it('a running workout has no background sound of its own: the training beat is gone', () => {
    mount(<AmbientController />)
    setS({ active: live })
    expect(amb.play).not.toHaveBeenCalled()
    act(() => useUI.setState({ timer: { left: 0, total: 60, ready: true } }))      // a finished rest: still no beat
    expect(amb.play).not.toHaveBeenCalled()
  })

  it('plays the calm sound while a rest counts, at the chosen volume, and stops when it is over', () => {
    setS({ active: live, ambientVol: 0.8 })
    mount(<AmbientController />)
    act(() => useUI.setState({ timer: { left: 60, total: 60, endsAt: Date.now() + 60000 } }))
    expect(lastPlay()).toEqual(['rest', 0.8])
    const calls = amb.play.mock.calls.length
    act(() => useUI.setState({ timer: { left: 59, total: 60, endsAt: Date.now() + 59000 } }))   // a tick of the countdown
    expect(amb.play.mock.calls.length).toBe(calls)                                              // nothing restarts every second
    amb.stop.mockClear()
    act(() => useUI.setState({ timer: { left: 0, total: 60, ready: true } }))
    expect(amb.stop).toHaveBeenCalled()
    amb.stop.mockClear()
    act(() => useUI.setState({ timer: null }))
    expect(amb.play.mock.calls.length).toBe(calls)
  })

  it('an older profile that chose "workout + rest" gets the rest sound, and "off" stays off', () => {
    setS({ active: live, ambient: 'all' })
    mount(<AmbientController />)
    act(() => useUI.setState({ timer: { left: 30, total: 30 } }))
    expect(lastPlay()[0]).toBe('rest')
    amb.play.mockClear(); amb.stop.mockClear()
    setS({ ambient: 'off' })
    expect(amb.stop).toHaveBeenCalled()
    expect(amb.play).not.toHaveBeenCalled()
  })

  it('stays quiet with Sound off, and plays the rest sound when it is turned on', () => {
    setS({ active: live, sound: false })
    mount(<AmbientController />)
    act(() => useUI.setState({ timer: { left: 30, total: 30 } }))
    expect(amb.play).not.toHaveBeenCalled()
    setS({ sound: true })
    expect(lastPlay()[0]).toBe('rest')
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
  it('offer the rest sound on or off, with the current one chosen: no "workout" option is left', () => {
    mount(<AmbientControls />)
    expect(radios().map(r => r.textContent)).toEqual(['Off', 'Rest only'])
    expect(radios().map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true'])   // on by default
  })
  it('a profile that holds the old "all" shows the rest sound as chosen', () => {
    setS({ ambient: 'all' })
    mount(<AmbientControls />)
    expect(radios().map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true'])
  })
  it('changing them is stored in the settings, and the volume slider stays, because it is the music\'s too', () => {
    mount(<AmbientControls />)
    act(() => radios()[0].click())
    expect(useStore.getState().S.ambient).toBe('off')
    const slider = host.querySelector('input[type=range]')
    expect(slider).not.toBeNull()
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '30')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(useStore.getState().S.ambientVol).toBe(0.3)
  })
  it('say that the volume sets the music too', () => {
    mount(<AmbientControls />)
    expect(host.textContent).toContain('The volume sets the workout music and this sound.')
  })
  it('say when Sound is off in Settings, so silence is not a mystery', () => {
    setS({ sound: false })
    mount(<AmbientControls />)
    expect(host.textContent).toMatch(/Sound is off, so nothing plays/)
  })
  it('read in Indonesian', async () => {
    await setLang('id')
    mount(<AmbientControls key="id" />)
    expect(radios().map(r => r.textContent)).toEqual(['Matikan', 'Hanya istirahat'])
    expect(host.textContent).toContain('Suara latihan')
    expect(host.textContent).toContain('Volume mengatur musik latihan')
  })
})
