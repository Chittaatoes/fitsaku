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

  it('the old on/off choice is gone: whatever an older profile holds, the rest sound plays', () => {
    setS({ active: live, ambient: 'off' })
    mount(<AmbientController />)
    act(() => useUI.setState({ timer: { left: 30, total: 30 } }))
    expect(lastPlay()[0]).toBe('rest')
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
  const sw = () => host.querySelector('button[role="switch"]')
  const slide = v => {
    const slider = host.querySelector('input[type=range]')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, v)
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  it('are the volume and the switch for the music: no on/off choice for the sound is left', () => {
    mount(<AmbientControls />)
    expect(host.querySelectorAll('[role=radio]')).toHaveLength(0)
    expect(host.querySelector('input[type=range]')).not.toBeNull()
    expect(sw().getAttribute('aria-checked')).toBe('true')            // on unless turned off
    expect(host.textContent).toContain('Play music in a workout')
  })
  it('the slider sets the volume that the music and the rest sound share, and the switch the music', () => {
    mount(<AmbientControls />)
    slide('30')
    expect(useStore.getState().S.ambientVol).toBe(0.3)
    act(() => sw().click())
    expect(useStore.getState().S.musicAuto).toBe(false)
    expect(sw().getAttribute('aria-checked')).toBe('false')
  })
  it('say how the music and the rest sound take turns', () => {
    mount(<AmbientControls />)
    expect(host.textContent).toContain('stops when a set is done')
    expect(host.textContent).toContain('The volume sets both.')
  })
  it('the compact one, in the music card, has the slider and the switch but not the long note', () => {
    mount(<AmbientControls compact />)
    expect(host.querySelector('input[type=range]')).not.toBeNull()
    expect(host.querySelector('.amb-note')).toBeNull()
  })
  it('say when Sound is off in Settings, so silence is not a mystery', () => {
    setS({ sound: false })
    mount(<AmbientControls />)
    expect(host.textContent).toMatch(/Sound is off, so nothing plays/)
  })
  it('read in Indonesian', async () => {
    await setLang('id')
    mount(<AmbientControls key="id" />)
    expect(host.textContent).toContain('Suara latihan')
    expect(host.textContent).toContain('Putar musik saat latihan')
    expect(host.textContent).toContain('Volume mengatur keduanya.')
  })
})
