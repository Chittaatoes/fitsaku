// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { msToNextMidnight, useLocalToday } from './use-local-today.js'

describe('msToNextMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(msToNextMidnight(new Date(2026, 9, 28, 23, 59, 0))).toBe(60000)
    expect(msToNextMidnight(new Date(2026, 9, 28, 0, 0, 0))).toBe(24 * 3600 * 1000)
  })
})

describe('useLocalToday', () => {
  let host, root
  const Show = () => <div id="d">{useLocalToday()}</div>
  beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

  it('moves to the new day at local midnight, with nothing else redrawing it', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 30))
    await act(async () => { root.render(<Show />) })
    expect(host.querySelector('#d').textContent).toBe('2026-10-28')
    await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
    expect(host.querySelector('#d').textContent).toBe('2026-10-29')
  })

  it('catches up when the app comes back to the screen after the day changed', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 20, 0, 0))
    await act(async () => { root.render(<Show />) })
    vi.setSystemTime(new Date(2026, 9, 29, 7, 0, 0))     // asleep in the background: the timer did not run
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(host.querySelector('#d').textContent).toBe('2026-10-29')
  })
})
