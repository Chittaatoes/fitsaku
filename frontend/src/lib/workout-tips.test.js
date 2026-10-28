import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { shouldShowWorkoutTips, tipsCopy, tipsSeen, markTipsSeen } from './workout-tips.js'

const active = { entries: [{ id: 'bench' }] }

describe('shouldShowWorkoutTips', () => {
  it('shows for a workout under way that this device has not shown it for', () => {
    expect(shouldShowWorkoutTips({ seen: false, active })).toBe(true)
  })
  it('does not show again once seen, with no workout, or with nothing in it', () => {
    expect(shouldShowWorkoutTips({ seen: true, active })).toBe(false)
    expect(shouldShowWorkoutTips({ seen: false, active: null })).toBe(false)
    expect(shouldShowWorkoutTips({ seen: false, active: { entries: [] } })).toBe(false)
  })
  it('stays out of a past workout being edited or back-filled', () => {
    expect(shouldShowWorkoutTips({ seen: false, active: { ...active, editingWorkoutId: 'w1' } })).toBe(false)
    expect(shouldShowWorkoutTips({ seen: false, active: { ...active, backfill: true } })).toBe(false)
  })
})

describe('the copy', () => {
  it('names the three steps in Indonesian, and falls back to English', () => {
    const id = tipsCopy('id')
    expect(id.s1).toMatch(/lingkaran/)
    expect(id.s2).toMatch(/− \/ \+/)
    expect(id.s3).toMatch(/Berikutnya/)
    expect(tipsCopy('xx').ok).toBe('Got it')
  })
})

describe('remembering that it was shown', () => {
  beforeEach(() => { const m = new Map(); globalThis.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } })
  afterEach(() => { delete globalThis.localStorage })
  it('is not seen until marked, then seen', () => {
    expect(tipsSeen()).toBe(false)
    markTipsSeen()
    expect(tipsSeen()).toBe(true)
  })
  it('counts as seen where storage is unusable, so it never nags', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    expect(tipsSeen()).toBe(true)
    expect(() => markTipsSeen()).not.toThrow()
  })
})
