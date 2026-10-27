import { describe, expect, it } from 'vitest'
import { awardWorkoutXp, calculateLevel, generateQuests, levelProgress, xpToNextLevel } from './gamification.js'

const workout = (id, extra = {}) => ({ id, d: '2026-10-26', entries: [{ id: 'bench', sets: [{ w: 60, r: 8, done: true }] }], prs: [], ...extra })
const fresh = () => ({ xp: 0, level: 1, xpAwarded: {} })

describe('awardWorkoutXp', () => {
  it('awards 50 XP for a saved workout and records it against its id', () => {
    const s = fresh()
    expect(awardWorkoutXp(s, workout('a'))).toBe(50)
    expect(s.xp).toBe(50)
    expect(s.xpAwarded).toEqual({ a: 50 })
  })

  it('adds the PR bonus once per workout, however many PRs it holds', () => {
    const s = fresh()
    expect(awardWorkoutXp(s, workout('a', { prs: ['bench', 'squat'] }))).toBe(75)
    expect(s.xp).toBe(75)
  })

  it('never pays the same workout twice', () => {
    const s = fresh()
    awardWorkoutXp(s, workout('a'))
    expect(awardWorkoutXp(s, workout('a'))).toBe(0)
    expect(awardWorkoutXp(s, workout('a', { prs: ['bench'] }))).toBe(0)
    expect(s.xp).toBe(50)
  })

  it('pays two different workouts on the same day separately', () => {
    const s = fresh()
    awardWorkoutXp(s, workout('a'))
    awardWorkoutXp(s, workout('b'))
    expect(s.xp).toBe(100)
  })

  it('pays nothing for a workout with no completed work or no id', () => {
    const s = fresh()
    expect(awardWorkoutXp(s, workout('a', { entries: [] }))).toBe(0)
    expect(awardWorkoutXp(s, workout(null))).toBe(0)
    expect(awardWorkoutXp(s, null)).toBe(0)
    expect(s.xp).toBe(0)
    expect(s.xpAwarded).toEqual({})
  })

  it('moves the level across a threshold and keeps it when just short', () => {
    const s = { xp: 49, level: 1, xpAwarded: {} }
    awardWorkoutXp(s, workout('a'))          // 99 XP: one short of level 2
    expect(s.xp).toBe(99)
    expect(s.level).toBe(1)
    awardWorkoutXp(s, workout('b'))          // 149 XP
    expect(s.level).toBe(2)
  })

  it('lands exactly on a threshold as the new level, with empty progress', () => {
    const s = { xp: 50, level: 1, xpAwarded: {} }
    awardWorkoutXp(s, workout('a'))          // 100 XP
    expect(s.level).toBe(2)
    expect(levelProgress(s.xp)).toBe(0)
  })

  it('copes with a state saved before the ledger existed', () => {
    const s = { xp: 0, level: 1 }
    expect(awardWorkoutXp(s, workout('a'))).toBe(50)
    expect(s.xpAwarded.a).toBe(50)
  })
})

describe('levels', () => {
  it('reads thresholds at their boundaries', () => {
    expect([0, 99, 100, 249, 250, 2699, 2700, 99999].map(calculateLevel)).toEqual([1, 1, 2, 2, 3, 9, 10, 10])
    expect(xpToNextLevel(120)).toEqual({ current: 20, needed: 150 })
    expect(xpToNextLevel(2700)).toBeNull()
  })
})

describe('generateQuests', () => {
  const S = { routines: [{}, {}, {}], bodyweight: [], workouts: [
    { id: '1', d: '2026-10-19' }, { id: '2', d: '2026-10-26' }, { id: '3', d: '2026-10-27' }, { id: '4', d: '2026-11-02' },
  ] }
  it('counts only the sessions of the week asked for', () => {
    const q = generateQuests(S, '2026-10-26').find(x => x.id === 'weekly-sessions')
    expect(q.progress).toBe(2)
    expect(q.target).toBe(3)
    expect(q.completed).toBe(false)
  })
})
