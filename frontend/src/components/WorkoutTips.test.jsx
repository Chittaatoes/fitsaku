// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutTipsOnce } from './WorkoutTips.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

let root, container
const setActive = active => act(async () => { useStore.setState({ S: { ...useStore.getState().S, active } }) })
const mount = async () => { await act(async () => { root.render(React.createElement(WorkoutTipsOnce)) }) }
const tick = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [] })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.useRealTimers()
})

describe('the first-workout guide', () => {
  it('opens once, in the middle of the screen, when a workout is first on screen, and is remembered', async () => {
    await setActive({ entries: [{ id: 'bench', sets: [] }] })
    await mount()
    expect(useUI.getState().sheets).toHaveLength(0)
    await tick(1000)
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    expect(sheets[0].kind).toBe('center')
    expect(localStorage.getItem('fs_workout_tips_v1')).toBe('1')
    // closed and the workout opened again: not shown again
    await act(async () => { useUI.setState({ sheets: [] }) })
    await act(async () => { root.unmount() }); root = createRoot(container)
    await mount()
    await tick(1500)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('does not open for a past workout being edited, or when something else is already open', async () => {
    await setActive({ entries: [{ id: 'bench', sets: [] }], editingWorkoutId: 'w1' })
    await mount()
    await tick(1500)
    expect(useUI.getState().sheets).toHaveLength(0)
    await setActive({ entries: [{ id: 'bench', sets: [] }] })
    useUI.setState({ sheets: [{ id: 'x', kind: 'sheet', render: () => null }] })
    await tick(1500)
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(localStorage.getItem('fs_workout_tips_v1')).toBeNull()
  })
})
