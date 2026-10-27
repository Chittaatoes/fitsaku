// @vitest-environment happy-dom
// The first-run Home Workout / Gym question inside the whole app: shown to a brand-new profile only,
// once, and never to anyone who already has data.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App.jsx'
import { DEF, freshState, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

vi.mock('./lib/sound.js', () => ({
  setPlayOnSilent: vi.fn(), setVibrate: vi.fn(), setAlarmBuzzer: vi.fn(),
  beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(),
}))
vi.mock('./lib/api.js', async importOriginal => ({
  ...await importOriginal(), api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(),
}))
vi.mock('./lib/ambient.js', () => ({ ambient: { play: vi.fn(), stop: vi.fn(), setVolume: vi.fn() } }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, original

beforeEach(() => {
  original = useStore.getState()
  localStorage.setItem('gym_guest', '1')
  window.location.hash = '#/home'
  window.scrollTo = vi.fn()
  useUI.setState({ sheets: [], work: null, timer: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  useUI.getState().stopRest(); useUI.getState().stopWork()
  useStore.setState(original); localStorage.clear()
})
const start = async S => { useStore.setState({ S, user: null, ready: true, boot: vi.fn() }); await act(async () => root.render(<App />)) }

it('a brand-new profile is asked, with no tab bar, before it sees Home', async () => {
  await start(freshState())
  expect(host.textContent).toContain('How do you want to train?')
  expect(host.querySelector('#tabbar')).toBeNull()
})

it('answering Gym leads to Home, and the question does not come back', async () => {
  await start(freshState())
  await act(async () => [...host.querySelectorAll('.wob-card')].find(c => c.textContent.includes('Gym')).click())
  expect(host.textContent).not.toContain('How do you want to train?')
  expect(useStore.getState().S.workoutOnboarded).toBe(true)
  expect(host.querySelector('#tabbar')).toBeTruthy()
  // opening the app again with the saved copy
  act(() => root.unmount()); root = createRoot(host)
  await act(async () => root.render(<App />))
  expect(host.textContent).not.toContain('How do you want to train?')
})

it('a profile saved before this feature is never asked', async () => {
  const S = structuredClone(DEF)
  await start(S)
  expect(host.textContent).not.toContain('How do you want to train?')
  expect(host.querySelector('#tabbar')).toBeTruthy()
})

it('a new-looking profile that already has workouts is not asked either', async () => {
  const S = freshState(); S.workouts = [{ id: 'w1', d: '2026-10-01', start: 1, end: 2, entries: [] }]
  await start(S)
  expect(host.textContent).not.toContain('How do you want to train?')
})
