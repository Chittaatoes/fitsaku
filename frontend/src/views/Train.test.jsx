// @vitest-environment happy-dom
// The "Today's Workout" card on the Train screen: the day's plan with its start button until a workout is finished today,
// then a card that says what was done (views/Train.jsx, lib/day-summary.js).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { todayISO, isoOf } from '../lib/format.js'
import { setLang } from '../lib/i18n.js'
import Train from './Train.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({ startFlow: vi.fn() }))

const routines = [{ id: 'sh', name: 'Shoulder', emoji: null, ex: [{ id: '0025' }, { id: '0026' }] }]
let host, root

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await setLang('en')
  localStorage.clear()
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const setS = (over = {}) => act(() => useStore.setState(s => ({
  S: { ...s.S, routines, week: { [new Date().getDay()]: ['sh'] }, dayPlan: {}, workouts: [], active: null, queue: null, rotation: null, scheduleMode: null, unit: 'kg', ...over }, user: null,
})))
const mount = () => act(() => root.render(<Train />))
const doneCard = () => host.querySelector('.train-done')
const startBtn = () => host.querySelector('.train-go')
const shoulderToday = (over = {}) => ({
  id: 'w1', d: todayISO(), name: 'Shoulder', start: Date.now() - 3600000, end: Date.now() - 600000, routineIds: ['sh'], routineId: 'sh',
  entries: [{ id: '0025', sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }] }], prs: [], ...over,
})

describe('Today\'s Workout on the Train screen', () => {
  it('with nothing finished today it is the plan with its start button, as ever', () => {
    setS()
    mount()
    expect(doneCard()).toBeNull()
    expect(startBtn()).not.toBeNull()
    expect(host.textContent).toContain('Today\'s Workout')
  })

  it('a Shoulder workout finished today turns it into the "done" card, with no start button', () => {
    setS({ workouts: [shoulderToday()] })
    mount()
    expect(doneCard()).not.toBeNull()
    expect(host.textContent).toContain('Workout complete today!')
    expect(host.textContent).toContain('Today you trained Shoulder.')
    expect(host.textContent).toMatch(/2 sets/)
    expect(startBtn()).toBeNull()
    expect(host.querySelector('.train-today .btn.primary')).toBeNull()
  })

  it('changes at once when the workout is finished, with the screen already open', () => {
    setS()
    mount()
    expect(doneCard()).toBeNull()
    act(() => useStore.setState(s => ({ S: { ...s.S, workouts: [...s.S.workouts, shoulderToday()] } })))   // what finishing does: the store, not the server
    expect(doneCard()).not.toBeNull()
    expect(startBtn()).toBeNull()
  })

  it('a workout not yet synced is as good as a synced one: only the store is asked', () => {
    setS({ workouts: [shoulderToday()] })
    act(() => useStore.setState(s => ({ sync: { ...s.sync, status: 'pending', pending: true, offline: true } })))
    mount()
    expect(doneCard()).not.toBeNull()
  })

  it('two workouts today: both names, once each, and the count of sessions', () => {
    setS({ workouts: [shoulderToday(), shoulderToday({ id: 'w2', name: 'Chest' }), shoulderToday({ id: 'w3', name: 'Shoulder' })] })
    mount()
    expect(host.textContent).toContain('Today you trained Shoulder + Chest.')
    expect(host.textContent).toContain('3 sessions')
  })

  it('yesterday\'s workout, a session under way and a set-less workout are not "done today"', () => {
    const y = new Date(); y.setDate(y.getDate() - 1)
    setS({ workouts: [shoulderToday({ d: isoOf(y) }), shoulderToday({ id: 'w5', entries: [{ id: '0025', sets: [{ w: 20, r: 10, done: false }] }] })] })
    mount()
    expect(doneCard()).toBeNull()
    expect(startBtn()).not.toBeNull()
    // a workout under way is in S.active, not in S.workouts, and the card goes on following the live session's own path
    setS({ workouts: [shoulderToday()], active: { id: 'a', name: 'Shoulder', d: todayISO(), entries: [{ id: '0025', sets: [] }] } })
    mount()
    expect(doneCard()).toBeNull()
    expect(host.querySelector('.train-live')).not.toBeNull()
  })

  it('shows no figure that is not there', () => {
    setS({ workouts: [shoulderToday({ start: undefined, end: undefined, entries: [{ id: '0025', sets: [{ r: 10, done: true }] }], prs: undefined })] })
    mount()
    const chips = [...host.querySelectorAll('.train-done-chips span')].map(e => e.textContent)
    expect(chips.some(c => /kg|min|PR/.test(c))).toBe(false)
    expect(chips).toContain('1 set')
  })

  it('goes back to the plan when the day changes, and says it in Indonesian', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 30))
    const today = todayISO()
    await setLang('id')
    setS({ workouts: [shoulderToday({ d: today })], week: { 0: ['sh'], 1: ['sh'], 2: ['sh'], 3: ['sh'], 4: ['sh'], 5: ['sh'], 6: ['sh'] } })
    mount()
    expect(host.textContent).toContain('Latihan hari ini selesai!')
    await act(async () => { await vi.advanceTimersByTimeAsync(31000) })
    expect(doneCard()).toBeNull()
    expect(startBtn()).not.toBeNull()
  })
})
