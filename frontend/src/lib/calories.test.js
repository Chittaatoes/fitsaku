import { describe, expect, it } from 'vitest'
import { workoutKcal, kcalOfDay, kcalLastDays, kcalBetween, weightKgFor, kcalUnit, STRENGTH_MET, DEFAULT_WEIGHT_KG, SET_MINUTES } from './calories.js'

const set = (done = true) => ({ w: 20, r: 10, done })
const workout = (over = {}) => ({
  id: 'w' + Math.random(), d: '2026-10-29', name: 'Shoulder',
  start: 1_000_000, end: 1_000_000 + 60 * 60000,                // one hour
  entries: [{ id: '0025', sets: [set(), set(), set()] }], ...over,
})
const S = (over = {}) => ({ unit: 'kg', bodyweight: [{ d: '2026-10-01', w: 80 }], workouts: [], ...over })

describe('workoutKcal', () => {
  it('is MET x kg x hours: an hour at 80 kg is 4.5 x 80', () => {
    const r = workoutKcal(workout(), S())
    expect(r.kcal).toBe(Math.round(STRENGTH_MET * 80 * 1))
    expect(r).toMatchObject({ minutes: 60, met: STRENGTH_MET, weightKg: 80, timeKnown: true, weightKnown: true })
  })
  it('scales with the time', () => {
    expect(workoutKcal(workout({ end: 1_000_000 + 30 * 60000 }), S()).kcal).toBe(Math.round(STRENGTH_MET * 80 * 0.5))
  })
  it('has no figure for a workout with no completed set', () => {
    expect(workoutKcal(workout({ entries: [{ id: '0025', sets: [set(false)] }] }), S())).toBeNull()
    expect(workoutKcal(workout({ entries: [] }), S())).toBeNull()
    expect(workoutKcal(null, S())).toBeNull()
  })
  it('counts a workout with no usable times by its sets, and says the time is not known', () => {
    for (const times of [{ start: undefined, end: undefined }, { start: 5000, end: 1000 }, { start: 0, end: 10 * 3600 * 1000 }, { start: 0, end: 1000 }]) {
      const r = workoutKcal(workout(times), S())
      expect(r.timeKnown).toBe(false)
      expect(r.minutes).toBe(Math.round(3 * SET_MINUTES))
      expect(r.kcal).toBe(Math.round(STRENGTH_MET * 80 * (3 * SET_MINUTES) / 60))
    }
  })
  it('uses the weight logged with the session first, in pounds too', () => {
    expect(workoutKcal(workout({ bw: 90 }), S()).weightKg).toBe(90)
    expect(workoutKcal(workout({ bw: 200 }), S({ unit: 'lb' })).weightKg).toBeCloseTo(90.7, 1)
  })
  it('without one, the latest weigh-in on or before the day, then the latest at all, then 70 kg and says so', () => {
    const log = [{ d: '2026-09-01', w: 75 }, { d: '2026-10-20', w: 78 }, { d: '2026-11-15', w: 90 }]
    expect(weightKgFor(S({ bodyweight: log }), { d: '2026-10-29' })).toEqual({ kg: 78, known: true })
    expect(weightKgFor(S({ bodyweight: log }), { d: '2026-08-01' })).toEqual({ kg: 90, known: true })    // nothing before it: the latest
    expect(weightKgFor(S({ bodyweight: [] }), { d: '2026-10-29' })).toEqual({ kg: DEFAULT_WEIGHT_KG, known: false })
    expect(workoutKcal(workout(), S({ bodyweight: [] })).weightKnown).toBe(false)
  })
})

describe('what the days add up to', () => {
  const W = [
    workout({ id: 'a', d: '2026-10-29' }),
    workout({ id: 'b', d: '2026-10-29', name: 'Chest', end: 1_000_000 + 30 * 60000 }),
    workout({ id: 'c', d: '2026-10-27' }),
    workout({ id: 'd', d: '2026-09-01' }),
    workout({ id: 'e', d: '2026-10-29', entries: [{ id: '0025', sets: [set(false)] }] }),      // nothing done: no figure
  ]
  it('a day: the workouts of that day, each with its figure, and their total', () => {
    const r = kcalOfDay(S({ workouts: W }), '2026-10-29')
    expect(r.count).toBe(2)
    expect(r.items.map(i => i.w.id)).toEqual(['a', 'b'])
    expect(r.kcal).toBe(Math.round(4.5 * 80) + Math.round(4.5 * 80 * 0.5))
    expect(r.minutes).toBe(90)
    expect(r.rough).toBe(false)
  })
  it('no workout that day: null, not zero', () => {
    expect(kcalOfDay(S({ workouts: W }), '2026-10-28')).toBeNull()
    expect(kcalOfDay(S(), '2026-10-29')).toBeNull()
  })
  it('the last 7 days include today and the six before, not the eighth', () => {
    const s = S({ workouts: W })
    expect(kcalLastDays(s, '2026-10-29', 7).count).toBe(3)
    expect(kcalLastDays(s, '2026-10-27', 1).count).toBe(1)
    expect(kcalLastDays(s, '2026-10-29', 30).count).toBe(3)
    expect(kcalLastDays(s, '2026-10-29', 60).count).toBe(4)
  })
  it('across a month boundary', () => {
    const s = S({ workouts: [workout({ d: '2026-10-31' }), workout({ d: '2026-11-01' })] })
    expect(kcalBetween(s, '2026-10-31', '2026-11-01').count).toBe(2)
    expect(kcalLastDays(s, '2026-11-02', 3).count).toBe(2)
  })
  it('is marked rough when a figure rests on a guess: no known time or no known weight', () => {
    expect(kcalOfDay(S({ workouts: [workout({ start: undefined })] }), '2026-10-29').rough).toBe(true)
    expect(kcalOfDay(S({ bodyweight: [], workouts: [workout()] }), '2026-10-29').rough).toBe(true)
  })
})

describe('kcalUnit', () => {
  it('is kkal in Indonesian and kcal elsewhere', () => {
    expect(kcalUnit('id')).toBe('kkal')
    expect(kcalUnit('en')).toBe('kcal')
    expect(kcalUnit('de')).toBe('kcal')
  })
})
