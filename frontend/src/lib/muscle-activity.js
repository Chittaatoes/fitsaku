// Muscle activity: how much recorded training each drawable muscle has had, with older sessions
// counting less. The map that showed it has gone from Progress; the colour scale (activityColor) is what the muscle balance map uses. It is a picture of what was logged,
// not a measurement of muscle size, growth or readiness (lib/recovery.js models fatigue; this does not).
//
// Everything is derived from the finished workouts each time (S.workouts is the only source), so
// editing or deleting a workout, a reload, or another profile's data cannot leave a stale number
// behind: there is nothing stored to correct and nothing that is decremented over time.
//
// For one muscle, every finished session i contributes
//     units_i = Σ over its exercises of  weight(muscle, exercise) × completed work sets
// (weight 1 for a primary muscle, SECONDARY for a supporting one: lib/muscles.js musclesOf, the
// attribution every other muscle view already uses), and that session's contribution fades with
//     units_i × 2^(−days_i / HALF_LIFE_DAYS)
// where days_i is the time since the session started (never negative: a session dated in the future
// counts as today, it is not amplified). The activity total is the sum over ALL sessions; there is no
// cutoff, a very old session just contributes almost nothing. The score is bounded:
//     score = 100 × (1 − e^(−total / K))
//
// Only completed, non-warm-up sets count. Reps and load are deliberately ignored: they are not
// comparable between exercises, and an attribution of "sets" is something the user can read back.

import { EXIDX } from './exercises.js'
import { workoutAt } from './history.js'
import { MUSCLES, musclesOf } from './muscles.js'
import { isWarmupRow } from './workout-model.js'

export const HALF_LIFE_DAYS = 10
/** Normalisation: the activity total at which a muscle reads 63 (1 − 1/e). 40 effective sets of
 *  recent, well-spread work: see the scenario table in lib/muscle-activity.test.js for how it reads
 *  for a new user, a light and a heavy lifter, a break and a return. */
export const SCORE_K = 40
const DAY_MS = 24 * 3600 * 1000
export const TREND_WEEKS = 6

const keyOf = w => (w?.id != null ? 'id:' + w.id : 'at:' + w?.d + '|' + w?.start)

/** The completed, non-warm-up sets of one logged exercise. */
const doneSets = e => (e?.sets || []).filter(s => s && s.done && !isWarmupRow(s)).length

/** Which muscles an entry trains, with its historical snapshot first (a custom or since-edited
 *  exercise keeps the weights it had when it was logged), as lib/muscles.js loadOf reads it. */
function weightsOfEntry(e) {
  const historical = e.exercise || e
  const source = historical?.muscleWeights ? historical : (EXIDX[e.id] || historical || e)
  return musclesOf(source)
}

/**
 * Every session's contribution to every muscle, once. Workouts are de-duplicated by id (the same
 * record seen twice counts once); one with no usable time is skipped.
 * → [{ muscle, key, at, units, sets, exId }]
 */
export function contributions(workouts) {
  const seen = new Set()
  const out = []
  for (const w of workouts || []) {
    if (!w) continue
    const key = keyOf(w)
    if (seen.has(key)) continue
    seen.add(key)
    const at = workoutAt(w)
    if (!Number.isFinite(at)) continue
    for (const e of w.entries || []) {
      const sets = doneSets(e)
      if (!sets) continue
      const weights = weightsOfEntry(e)
      for (const muscle in weights) out.push({ muscle, key, at, units: weights[muscle] * sets, sets, exId: e.id })
    }
  }
  return out
}

/** The 0–100 score for an activity total. */
export const scoreOf = (total, k = SCORE_K) => (total > 0 ? 100 * (1 - Math.exp(-total / k)) : 0)

/** A contribution of `units` made `days` ago, as it counts now. */
export const decayed = (units, days, halfLife = HALF_LIFE_DAYS) => units * Math.pow(2, -Math.max(0, days) / halfLife)

/**
 * Activity per muscle at `now` (epoch ms; always passed in, so a fixed instant gives a fixed answer).
 * → { [muscle]: { total, score, sets7, sets30, last, exercises: [{ id, sets, units }], trend: number[] } }
 * for every muscle in MUSCLES; one never trained has total 0, score 0, last null, no exercises.
 * `trend` is the completed sets per week for the last TREND_WEEKS weeks, oldest first.
 */
export function muscleActivity(workouts, now, { k = SCORE_K, halfLife = HALF_LIFE_DAYS } = {}) {
  const out = {}
  for (const m of MUSCLES) out[m] = { total: 0, score: 0, sets7: 0, sets30: 0, last: null, exercises: [], trend: new Array(TREND_WEEKS).fill(0) }
  const perEx = {}
  for (const c of contributions(workouts)) {
    const row = out[c.muscle]
    if (!row) continue
    const days = (now - c.at) / DAY_MS
    row.total += decayed(c.units, days, halfLife)
    const age = Math.max(0, days)
    if (age < 7) row.sets7 += c.sets
    if (age < 30) row.sets30 += c.sets
    const week = Math.floor(age / 7)
    if (week < TREND_WEEKS) row.trend[TREND_WEEKS - 1 - week] += c.sets
    if (row.last == null || c.at > row.last) row.last = c.at
    const ex = ((perEx[c.muscle] ||= {})[c.exId] ||= { id: c.exId, sets: 0, units: 0 })
    ex.sets += c.sets; ex.units += c.units
  }
  for (const m of MUSCLES) {
    out[m].score = scoreOf(out[m].total, k)
    out[m].exercises = Object.values(perEx[m] || {}).sort((a, b) => b.units - a.units || String(a.id).localeCompare(String(b.id)))
  }
  return out
}

/* A tiny cache: the map is drawn on every render of Progress, the calculation walks every set ever
 * logged. Keyed by the workouts array itself (a new array on any change) and the hour, so it is
 * recomputed when the data changes or the clock has moved far enough to matter, and never per frame. */
const cache = new WeakMap()
export function cachedMuscleActivity(workouts, now = Date.now()) {
  if (!workouts || typeof workouts !== 'object') return muscleActivity([], now)
  const hour = Math.floor(now / 3600000)
  const hit = cache.get(workouts)
  if (hit && hit.hour === hour) return hit.value
  const value = muscleActivity(workouts, now)
  cache.set(workouts, { hour, value })
  return value
}

/* ---- colour ---- */

/** One hue, red-orange; only its strength changes. */
export const ACTIVITY_RGB = [255, 90, 31]

/** Opacity for a 0–100 score: none at 0, then continuous and increasing. The curve is slightly
 *  concave so a first session is visible, and it never reaches full opacity, so anatomy lines
 *  stay readable on the most worked muscle. */
export const activityAlpha = score => {
  if (!(score > 0)) return 0
  const t = Math.min(1, score / 100)
  return +(0.14 + 0.78 * Math.pow(t, 0.8)).toFixed(3)
}
export const activityColor = score => {
  const a = activityAlpha(score)
  return a > 0 ? `rgba(${ACTIVITY_RGB.join(',')},${a})` : ''
}
