import { describe, expect, it } from 'vitest'
import { mergeStates, sinceReset } from './sync-merge.js'
import { mergeXpLedger, xpFromLedger } from './xp.js'

const w = (id, start) => ({ id, d: '2026-10-26', start, end: start + 1000, entries: [] })
const state = (ledger, workouts, ts) => ({
  _ts: ts, workouts, xpAwarded: ledger,
  ...xpFromLedger(ledger),
})

describe('XP across two devices', () => {
  it('adds up workouts each device finished on its own', () => {
    const phone = state({ a: 50 }, [w('a', 1)], 10)
    const desktop = state({ b: 75 }, [w('b', 2)], 20)
    for (const [x, y] of [[phone, desktop], [desktop, phone]]) {
      const m = mergeStates(x, y)
      expect(m.xpAwarded).toEqual({ a: 50, b: 75 })
      expect(m.xp).toBe(125)
      expect(m.level).toBe(2)
    }
  })

  it('counts a workout both devices know about once', () => {
    const phone = state({ a: 50, b: 25 }, [w('a', 1)], 10)
    const desktop = state({ a: 50 }, [w('a', 1)], 20)
    const m = mergeStates(phone, desktop)
    expect(m.xp).toBe(75)
  })

  it('does not trust a stored total the ledger does not back', () => {
    const phone = { ...state({ a: 50 }, [w('a', 1)], 10), xp: 9999, level: 10 }
    const desktop = state({}, [], 20)
    const m = mergeStates(phone, desktop)
    expect(m.xp).toBe(50)
    expect(m.level).toBe(1)
  })

  it('keeps XP earned while signed out when signing in (prefer)', () => {
    const guest = state({ g: 50 }, [w('g', 1)], 10)
    const account = state({ s: 50, t: 50 }, [w('s', 2), w('t', 3)], 5)
    const m = mergeStates(guest, account, { prefer: 'b' })
    expect(m.xp).toBe(150)
    expect(m.level).toBe(2)
  })

  it('is the same whichever copy is merged first, and merging again changes nothing', () => {
    const a = state({ a: 50, c: 25 }, [w('a', 1), w('c', 3)], 10)
    const b = state({ b: 50, c: 25 }, [w('b', 2), w('c', 3)], 20)
    const ab = mergeStates(a, b), ba = mergeStates(b, a)
    expect(ab.xp).toBe(ba.xp)
    expect(mergeStates(ab, b).xp).toBe(ab.xp)
    expect(mergeStates(ab, a).xp).toBe(ab.xp)
  })

  it('merges states from before the ledger existed without inventing XP', () => {
    const m = mergeStates({ _ts: 1, workouts: [w('a', 1)] }, { _ts: 2, workouts: [] })
    expect(m.xp).toBe(0)
    expect(m.level).toBe(1)
  })

  it('a reset takes the XP of the workouts it removed', () => {
    const s = state({ old: 50, fresh: 50 }, [w('old', 1), w('fresh', 9000)], 10)
    const r = sinceReset(s, 5000)
    expect(r.xpAwarded).toEqual({ fresh: 50 })
    expect(r.xp).toBe(50)
  })
})

describe('xp ledger helpers', () => {
  it('drops malformed entries and takes the larger of a shared id', () => {
    expect(mergeXpLedger({ a: 50, bad: 'x', neg: -5 }, { a: 75, b: NaN })).toEqual({ a: 75 })
    expect(xpFromLedger(null)).toEqual({ xp: 0, level: 1 })
    expect(xpFromLedger({ a: 100 })).toEqual({ xp: 100, level: 2 })
  })
})
