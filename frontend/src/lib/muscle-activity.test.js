import { describe, expect, it } from 'vitest'
import {
  muscleActivity, contributions, scoreOf, decayed, activityAlpha, activityColor, cachedMuscleActivity,
  HALF_LIFE_DAYS, SCORE_K, TREND_WEEKS,
} from './muscle-activity.js'
import { MUSCLES } from './muscles.js'
import { EXDB } from './exercises-data.js'

const DAY = 24 * 3600 * 1000
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0)            // a fixed evaluation instant: nothing here reads the clock

/* Entries carry the muscle weights they were logged with (the snapshot every history entry keeps for
   custom exercises), so these tests do not depend on the catalogue's own metadata. */
const BENCH = { chest: 1, triceps: 0.4, deltoids: 0.4 }
const SQUAT = { quadriceps: 1, gluteal: 0.4, hamstring: 0.4 }
const ex = (id, weights, done, total = done) => ({
  id, exercise: { muscleWeights: weights },
  sets: Array.from({ length: total }, (_, i) => ({ w: 60, r: 8, done: i < done })),
})
const session = (id, daysAgo, entries) => ({ id, d: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10), start: NOW - daysAgo * DAY, end: NOW - daysAgo * DAY + 3600e3, entries })
const at = (workouts, muscle, now = NOW) => muscleActivity(workouts, now)[muscle]

describe('what counts', () => {
  it('a never-trained muscle has score 0, no date and no exercises', () => {
    const m = at([session('a', 1, [ex('b', BENCH, 3)])], 'calves')
    expect(m).toMatchObject({ total: 0, score: 0, sets7: 0, sets30: 0, last: null, exercises: [] })
    expect(at([], 'chest').score).toBe(0)
    expect(MUSCLES.every(k => muscleActivity([], NOW)[k].score === 0)).toBe(true)
  })

  it('one completed set creates activity for exactly the mapped muscles', () => {
    const a = muscleActivity([session('a', 0, [ex('b', BENCH, 1)])], NOW)
    expect(Object.keys(a).filter(k => a[k].score > 0).sort()).toEqual(['chest', 'deltoids', 'triceps'])
  })

  it('primary and secondary muscles contribute by their weights (1 and 0.4)', () => {
    const a = muscleActivity([session('a', 0, [ex('b', BENCH, 5)])], NOW)
    expect(a.chest.total).toBeCloseTo(5, 10)
    expect(a.triceps.total).toBeCloseTo(2, 10)
    expect(a.chest.score).toBeGreaterThan(a.triceps.score)
  })

  it('uncompleted, skipped and warm-up sets contribute nothing', () => {
    const e = ex('b', BENCH, 2, 5)                                       // 5 logged, 2 ticked
    e.sets.push({ w: 20, r: 10, done: true, warmup: true })             // a ticked warm-up
    const a = muscleActivity([session('a', 0, [e])], NOW)
    expect(a.chest.total).toBeCloseTo(2, 10)
    expect(a.chest.sets7).toBe(2)
    expect(muscleActivity([session('a', 0, [ex('b', BENCH, 0, 4)])], NOW).chest.score).toBe(0)
  })

  it('a workout with no usable time is skipped, a future one counts as today and is not amplified', () => {
    const noTime = { id: 'x', entries: [ex('b', BENCH, 3)] }
    expect(at([noTime], 'chest').total).toBe(0)
    const future = session('f', -5, [ex('b', BENCH, 4)])                // dated five days ahead
    expect(at([future], 'chest').total).toBeCloseTo(4, 10)             // 4 units, no boost above 1×
  })

  it('the same workout seen twice (duplicated records) counts once', () => {
    const w = session('dup', 2, [ex('b', BENCH, 3)])
    const once = at([w], 'chest').total
    expect(at([w, w, { ...w }], 'chest').total).toBeCloseTo(once, 12)
    expect(contributions([w, w]).filter(c => c.muscle === 'chest')).toHaveLength(1)
  })

  it('reads the catalogue for an entry with no snapshot, and ignores muscles it does not draw', () => {
    const chestEx = EXDB.find(e => e.tg === 'pectorals')
    const w = session('c', 1, [{ id: chestEx.id, sets: [{ w: 40, r: 10, done: true }] }])
    expect(at([w], 'chest').score).toBeGreaterThan(0)
    const none = session('n', 1, [{ id: 'no-such-exercise', sets: [{ done: true }] }])
    expect(() => muscleActivity([none], NOW)).not.toThrow()
  })
})

describe('fading with a ten-day half-life', () => {
  it('a session contributes half after exactly 10 days, a quarter after 20', () => {
    const fresh = at([session('a', 0, [ex('b', BENCH, 4)])], 'chest').total
    expect(at([session('a', 10, [ex('b', BENCH, 4)])], 'chest').total).toBeCloseTo(fresh / 2, 10)
    expect(at([session('a', 20, [ex('b', BENCH, 4)])], 'chest').total).toBeCloseTo(fresh / 4, 10)
    expect(decayed(8, HALF_LIFE_DAYS)).toBeCloseTo(4, 12)
  })

  it('sessions add up, each at its own age', () => {
    const w = [session('a', 0, [ex('b', BENCH, 4)]), session('b', 10, [ex('b', BENCH, 4)]), session('c', 20, [ex('b', BENCH, 4)])]
    expect(at(w, 'chest').total).toBeCloseTo(4 + 2 + 1, 10)
  })

  it('an older session is worth less than a recent one with the same sets', () => {
    expect(at([session('old', 25, [ex('b', BENCH, 5)])], 'chest').score)
      .toBeLessThan(at([session('new', 3, [ex('b', BENCH, 5)])], 'chest').score)
  })

  it('there is no cutoff: a year-old session still contributes, a little', () => {
    const a = at([session('a', 365, [ex('b', BENCH, 10)])], 'chest')
    expect(a.total).toBeGreaterThan(0)
    expect(a.total).toBeCloseTo(10 * Math.pow(2, -36.5), 20)
    expect(at([session('a', 90, [ex('b', BENCH, 10)])], 'chest').total).toBeGreaterThan(a.total)
  })

  it('the score always stays within 0–100, however much is logged', () => {
    const huge = Array.from({ length: 400 }, (_, i) => session('s' + i, i % 30, [ex('b', BENCH, 30)]))
    const a = muscleActivity(huge, NOW)
    for (const m of MUSCLES) { expect(a[m].score).toBeGreaterThanOrEqual(0); expect(a[m].score).toBeLessThanOrEqual(100) }
    expect(scoreOf(1e9)).toBeLessThanOrEqual(100)
    expect(scoreOf(0)).toBe(0); expect(scoreOf(-5)).toBe(0)
  })

  it('is deterministic for a fixed dataset and instant, and moves only with the instant', () => {
    const w = [session('a', 2, [ex('b', BENCH, 4)]), session('b', 9, [ex('s', SQUAT, 5)])]
    expect(muscleActivity(w, NOW)).toEqual(muscleActivity(JSON.parse(JSON.stringify(w)), NOW))
    expect(at(w, 'chest', NOW + 10 * DAY).total).toBeCloseTo(at(w, 'chest').total / 2, 10)
  })
})

/* The calibration the constant K was chosen against: how a score reads for the people the feature
   is for. Each scenario is a realistic week-by-week history for the chest, the muscle most programs
   hit hardest (a typical session: 4 sets of presses + 3 incline, i.e. 7 primary sets). */
describe('calibration: K = ' + SCORE_K, () => {
  const press = n => ex('p', BENCH, n)
  const history = (perWeek, weeks, sets = 7, endDaysAgo = 0) => {
    const w = []
    for (let wk = 0; wk < weeks; wk++) for (let s = 0; s < perWeek; s++) w.push(session(`w${wk}-${s}`, endDaysAgo + wk * 7 + s * (7 / perWeek), [press(sets)]))
    return w
  }
  const score = w => at(w, 'chest').score

  it('a brand-new user reads zero everywhere', () => {
    expect(muscleActivity([], NOW).chest.score).toBe(0)
  })
  it('one completed workout is clearly visible but far from the top', () => {
    const s = score([session('one', 0, [press(7)])])
    expect(s).toBeGreaterThan(10); expect(s).toBeLessThan(30)
  })
  it('2–4 sessions a week sit in the middle and rise with frequency', () => {
    const two = score(history(2, 8)), three = score(history(3, 8)), four = score(history(4, 8))
    expect(two).toBeGreaterThan(35); expect(two).toBeLessThan(70)
    expect(three).toBeGreaterThan(two); expect(four).toBeGreaterThan(three)
    expect(four).toBeLessThan(95)
  })
  it('months of frequent training do not saturate: a heavy week and a light week still differ', () => {
    const months = score(history(4, 26)), light = score(history(1, 26))
    expect(months).toBeLessThan(95)
    expect(months - light).toBeGreaterThan(30)
  })
  it('stopping fades it smoothly: weeks off lower the score step by step, never to a cliff', () => {
    const trained = history(3, 12)
    const s0 = at(trained, 'chest', NOW).score
    const s2 = at(trained, 'chest', NOW + 14 * DAY).score
    const s4 = at(trained, 'chest', NOW + 28 * DAY).score
    const s8 = at(trained, 'chest', NOW + 56 * DAY).score
    expect(s0).toBeGreaterThan(s2); expect(s2).toBeGreaterThan(s4); expect(s4).toBeGreaterThan(s8)
    expect(s4).toBeGreaterThan(5)                    // four weeks off still shows
    expect(s8).toBeGreaterThan(0); expect(s8).toBeLessThan(s0 / 4)
  })
  it('a return after a break builds back from where it was', () => {
    const before = history(3, 10, 7, 42)             // trained until six weeks ago
    const returning = [...before, session('back', 1, [press(7)])]
    expect(score(returning)).toBeGreaterThan(score(before))
    expect(score(returning)).toBeLessThan(score(history(3, 10)))
  })
  it('the colour keeps these cases visibly different', () => {
    const levels = [score([session('one', 0, [press(7)])]), score(history(2, 8)), score(history(4, 26))].map(activityAlpha)
    expect(levels[1] - levels[0]).toBeGreaterThan(0.1)
    expect(levels[2] - levels[1]).toBeGreaterThan(0.05)
  })
})

describe('editing, deleting and reloading', () => {
  const base = [session('a', 1, [ex('b', BENCH, 4)]), session('b', 3, [ex('b', BENCH, 3)])]
  it('deleting a workout removes exactly its contribution', () => {
    const without = base.filter(w => w.id !== 'b')
    expect(at(base, 'chest').total).toBeCloseTo(at(without, 'chest').total + decayed(3, 3), 10)
  })
  it('correcting a set (unticking one) lowers the score; adding one raises it', () => {
    const edited = JSON.parse(JSON.stringify(base)); edited[0].entries[0].sets[3].done = false
    expect(at(edited, 'chest').total).toBeLessThan(at(base, 'chest').total)
    const added = JSON.parse(JSON.stringify(base)); added[0].entries[0].sets.push({ w: 60, r: 8, done: true })
    expect(at(added, 'chest').total).toBeGreaterThan(at(base, 'chest').total)
  })
  it('the same stored workouts give the same result after a reload (JSON round trip)', () => {
    const reloaded = JSON.parse(JSON.stringify(base))
    expect(muscleActivity(reloaded, NOW)).toEqual(muscleActivity(base, NOW))
  })
  it('the cache follows the data and is never stale: a new array is recomputed, the same one is reused', () => {
    const a = cachedMuscleActivity(base, NOW)
    expect(cachedMuscleActivity(base, NOW)).toBe(a)
    const next = base.filter(w => w.id !== 'b')
    expect(cachedMuscleActivity(next, NOW)).not.toBe(a)
    expect(cachedMuscleActivity(next, NOW).chest.total).toBeLessThan(a.chest.total)
    expect(cachedMuscleActivity(base, NOW + 2 * 3600e3)).not.toBe(a)       // the hour moved on
    expect(() => cachedMuscleActivity(undefined, NOW)).not.toThrow()
  })
})

describe('what the details show', () => {
  const w = [
    session('a', 2, [ex('b', BENCH, 4), ex('f', { chest: 1, deltoids: 0.4 }, 3)]),
    session('b', 20, [ex('b', BENCH, 5)]),
    session('c', 40, [ex('b', BENCH, 6)]),
  ]
  const a = muscleActivity(w, NOW)
  it('counts completed sets in the last 7 and 30 days', () => {
    expect(a.chest.sets7).toBe(7)
    expect(a.chest.sets30).toBe(12)
  })
  it('knows the most recent session', () => {
    expect(a.chest.last).toBe(NOW - 2 * DAY)
    expect(a.triceps.last).toBe(NOW - 2 * DAY)
  })
  it('lists the exercises that fed it, biggest first, with their sets', () => {
    expect(a.chest.exercises.map(e => [e.id, e.sets])).toEqual([['b', 15], ['f', 3]])
    expect(a.triceps.exercises.map(e => e.id)).toEqual(['b'])
  })
  it('gives sets per week for the last six weeks, oldest first', () => {
    expect(a.chest.trend).toHaveLength(TREND_WEEKS)
    // 40 days ago is week 5 back (35–42 days), 20 days ago week 2 (14–21), 2 days ago this week
    expect(a.chest.trend).toEqual([6, 0, 0, 5, 0, 7])
    expect(muscleActivity([session('old', 50, [ex('b', BENCH, 9)])], NOW).chest.trend.every(v => v === 0)).toBe(true)   // beyond six weeks: not in the trend
  })
})

describe('colour', () => {
  it('score 0 has no fill; above it the opacity rises continuously and stays below 1', () => {
    expect(activityAlpha(0)).toBe(0); expect(activityColor(0)).toBe('')
    let last = 0
    for (let s = 1; s <= 100; s++) { const a = activityAlpha(s); expect(a).toBeGreaterThanOrEqual(last); last = a }
    expect(activityAlpha(1)).toBeGreaterThan(0.1)
    expect(activityAlpha(100)).toBeLessThan(1)
    // continuous: no step between neighbouring scores bigger than a few percent
    for (let s = 1; s < 100; s++) expect(activityAlpha(s + 1) - activityAlpha(s)).toBeLessThan(0.05)
  })
  it('is always the one red-orange hue', () => {
    for (const s of [1, 20, 60, 100]) expect(activityColor(s)).toMatch(/^rgba\(255,90,31,0\.\d+\)$/)
  })
})
