// @vitest-environment happy-dom
// The tab bar is the floating pill with REPO's four destinations: Home, Train, Progress, Profile.
// It is fixed on screen and re-renders on every store write — once a second for the whole of a
// rest. Its buttons must survive that: a component declared inside the render body is a new
// function each time, which React reads as a different type and rebuilds from scratch.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const nav = vi.fn()
let pathname = '/home'
vi.mock('react-router-dom', () => ({
  useNavigate: () => nav,
  useLocation: () => ({ pathname }),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, originalUser

beforeEach(() => {
  nav.mockClear()
  pathname = '/home'
  const store = useStore.getState()
  originalS = store.S
  originalUser = store.user
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useStore.setState({ S: originalS, user: originalUser })
})

const tabs = () => [...host.querySelectorAll('#tabbar button')]
const lit = () => tabs().map(b => b.getAttribute('aria-current') === 'page')

describe('the tab bar across a store write', () => {
  it('keeps the very same buttons instead of rebuilding them every tick', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    const before = tabs()
    expect(before).toHaveLength(4)

    // What a rest does once a second: S is replaced, so everything reading it re-renders.
    act(() => { useStore.getState().update(s => { s.restSec = 91 }, false) })

    const after = tabs()
    expect(after).toHaveLength(before.length)
    after.forEach((el, i) => expect(el).toBe(before[i]))
  })

  it('lights the destination for the route it is on, legacy routes included', () => {
    const cases = [
      ['/home', [true, false, false, false]],
      ['/train', [false, true, false, false]],
      ['/train/new', [false, true, false, false]],
      ['/plan', [false, true, false, false]],
      ['/library', [false, true, false, false]],
      ['/stats', [false, false, true, false]],
      ['/history', [false, false, true, false]],
      ['/settings', [false, false, false, true]],
      ['/coach-chat', [false, false, false, true]],
    ]
    for (const [path, expected] of cases) {
      pathname = path
      act(() => { root.render(<TabBar key={path} onStart={() => {}} />) })
      expect(lit(), path).toEqual(expected)
      expect(tabs().map(b => b.classList.contains('active')), path).toEqual(expected)
    }
  })

  it('follows a change of state: a running session marks the Train pill without moving the lit tab', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    expect(tabs()[1].classList.contains('rec')).toBe(false)
    act(() => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0, start: Date.now() } }, false) })
    expect(tabs()[1].classList.contains('rec')).toBe(true)
    expect(lit()).toEqual([true, false, false, false])
  })

  it('goes to each destination on tap', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    act(() => { tabs()[0].click() })
    act(() => { tabs()[1].click() })
    act(() => { tabs()[2].click() })
    act(() => { tabs()[3].click() })
    expect(nav.mock.calls.map(c => c[0])).toEqual(['/home', '/train', '/progress', '/profile'])
  })
})

// Settings → "Show connection status" off (#369, #330): a stuck sync shows as a dot on Home, and
// the tab's name says it. The pill has no visible text, so its aria-label always names it.
describe('the connection dot on Home', () => {
  const home = () => tabs()[0]
  it('is there for a sync problem only while the banner is switched off', () => {
    const original = useStore.getState().sync
    try {
      useStore.setState({ sync: { status: 'error', lastError: { status: 502 }, pending: true } })
      act(() => { root.render(<TabBar onStart={() => {}} />) })
      expect(home().querySelector('.pill-dot')).toBeNull()
      expect(home().getAttribute('aria-label')).toBe('Home')
      act(() => { useStore.getState().update(s => { s.connStatus = false }, false) })
      expect(home().querySelector('.pill-dot')).not.toBeNull()
      expect(home().getAttribute('aria-label')).toBe('Home, Connection problem')
      act(() => { useStore.setState({ sync: { status: 'ok', lastError: null, pending: false } }) })
      expect(home().querySelector('.pill-dot')).toBeNull()
      expect(home().getAttribute('aria-label')).toBe('Home')
    } finally { useStore.setState({ sync: original }) }
  })
})

describe('the tab icons and labels', () => {
  const icon = el => el.querySelector('svg')?.getAttribute('data-icon')
  it('names every destination and uses one icon per concept', () => {
    act(() => { root.render(<TabBar onStart={() => {}} />) })
    expect(tabs().map(icon)).toEqual(['house', 'dumbbell', 'chart', 'person'])
    expect(tabs().map(b => b.getAttribute('aria-label'))).toEqual(['Home', 'Train', 'Progress', 'Profile'])
  })

  it('shows a minimized session’s running time, still named Resume', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(2026, 9, 5, 18, 0, 0))
      act(() => { useStore.getState().update(s => { s.active = { id: 'a', entries: [], cur: 0, start: Date.now() - 754_000 } }, false) })
      act(() => { root.render(<TabBar onStart={() => {}} />) })
      const train = tabs()[1]
      expect(train.textContent).toBe('12:34')
      expect(train.getAttribute('aria-label')).toBe('Resume')
      act(() => { vi.advanceTimersByTime(2000) })
      expect(train.textContent).toBe('12:36')
      expect(tabs()[1]).toBe(train)   // the same button, only its text ticks
      act(() => { train.click() })
      expect(nav).toHaveBeenLastCalledWith('/workout')

      // a past workout being edited has no clock running
      act(() => { useStore.getState().update(s => { s.active.editingWorkoutId = 'w1' }, false) })
      expect(tabs()[1].getAttribute('aria-label')).toBe('Train')
      expect(tabs()[1].textContent).toBe('')
    } finally { vi.useRealTimers() }
  })
})
