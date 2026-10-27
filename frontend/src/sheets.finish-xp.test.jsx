// @vitest-environment happy-dom
// XP at the real finish: the store write that saves a workout is the one that awards it, once.
// Regression for the redesign dropping the award (a finished workout left XP at 0).
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { finishWorkout, finishWorkoutNow } from './sheets.jsx'
import { generateQuests } from './lib/gamification.js'
import { EXDB } from './lib/exercises-data.js'

const clone = v => JSON.parse(JSON.stringify(v))
const S = () => useStore.getState().S
const mounted = []

function install(sets, { id = 'w1', d = '2026-10-26', backfill } = {}) {
  const st = clone(DEF)
  st.routines = [{ id: 'r1', name: 'R', exercises: [] }]
  st.active = {
    id, d, start: Date.now() - 20 * 60000, routineId: null, name: 'Core', bw: null, cur: 0,
    ...(backfill ? { backfill } : {}),
    entries: [{ id: EXDB[0].id, target: { mode: 'reps', sets: sets.length, reps: 5, weight: 40 }, sets }],
  }
  useStore.setState({ S: st, user: null })
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [], timer: null, work: null })
})
afterEach(() => {
  mounted.splice(0).forEach(r => act(() => r.unmount()))
  document.body.innerHTML = ''
})

describe('XP at workout finish', () => {
  it('a completed workout awards 50 XP, saves it, and advances the quest in the same write', () => {
    install([{ w: 40, r: 5, done: true }])
    expect(S().xp).toBe(0)
    act(() => finishWorkout())
    expect(S().workouts).toHaveLength(1)
    // 50 for the session, +25 when it set a weight PR (a first-ever lift does).
    expect(S().xp).toBe(S().workouts[0].prs.length ? 75 : 50)
    expect(S().xpAwarded.w1).toBe(S().xp)
    expect(S().level).toBe(1)
    const q = generateQuests(S(), '2026-10-26').find(x => x.id === 'weekly-sessions')
    expect(q.progress).toBe(1)
  })

  it('a retried finish (no active workout left) adds nothing', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkout())
    const xp = S().xp
    act(() => { finishWorkoutNow(); finishWorkout() })
    expect(S().xp).toBe(xp)
    expect(S().workouts).toHaveLength(1)
  })

  it('a workout id already in the ledger is not paid again, even if finished again', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkout())
    const xp = S().xp
    // The same session id comes back (a restored copy, a replayed watch finish).
    const again = clone(DEF)
    Object.assign(again, { xp, level: S().level, xpAwarded: clone(S().xpAwarded) })
    again.active = { id: 'w1', d: '2026-10-26', start: Date.now() - 1000, routineId: null, name: 'Core', bw: null, cur: 0,
      entries: [{ id: EXDB[0].id, target: { mode: 'reps', sets: 1, reps: 5, weight: 40 }, sets: [{ w: 40, r: 5, done: true }] }] }
    useStore.setState({ S: again })
    act(() => finishWorkoutNow())
    expect(S().xp).toBe(xp)
  })

  it('a workout with no completed set earns nothing', () => {
    install([{ w: 40, r: 5 }])
    act(() => finishWorkoutNow())
    expect(S().xp).toBe(0)
    expect(S().xpAwarded).toEqual({})
  })

  it('an unfinished (still active) or discarded workout earns nothing', () => {
    install([{ w: 40, r: 5, done: true }])
    expect(S().xp).toBe(0)
    expect(S().active).not.toBeNull()
    useStore.getState().update(s => { s.active = null })   // discard: active dropped, never finished
    expect(S().xp).toBe(0)
    expect(S().workouts).toHaveLength(0)
  })

  it('a workout logged into the past earns nothing', () => {
    install([{ w: 40, r: 5, done: true }], { backfill: {} })
    act(() => finishWorkoutNow())
    expect(S().xp).toBe(0)
  })

  it('opening the finish summary again does not alter XP', () => {
    install([{ w: 40, r: 5, done: true }])
    act(() => finishWorkout())
    const xp = S().xp
    const sheet = useUI.getState().sheets.at(-1)
    for (let i = 0; i < 2; i++) {
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      mounted.push(root)
      act(() => root.render(sheet.render(() => {})))
    }
    expect(S().xp).toBe(xp)
  })

  it('crossing a level threshold sets the level and survives a reload from localStorage', async () => {
    install([{ w: 40, r: 5, done: true }])
    useStore.setState({ S: { ...S(), xp: 60, level: 1 } })
    act(() => finishWorkout())
    const earned = S().xpAwarded.w1
    expect(S().xp).toBe(60 + earned)
    expect(S().level).toBe(2)

    vi.resetModules()
    const reloaded = await import('./store/useStore.js')
    expect(reloaded.useStore.getState().S.xp).toBe(60 + earned)
    expect(reloaded.useStore.getState().S.level).toBe(2)
    expect(reloaded.useStore.getState().S.xpAwarded.w1).toBe(earned)
  })
})
