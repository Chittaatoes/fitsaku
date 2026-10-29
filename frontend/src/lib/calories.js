// Estimated calories burned by a finished workout, and what the days add up to. An estimate from the usual formula,
//
//     kcal = MET × body weight (kg) × hours
//
// not a measurement: FitSaku has no heart rate for a workout done in the app. The pieces:
//   - MET 4.5 for lifting, between the Compendium of Physical Activities' "resistance training, general" (3.5) and
//     "vigorous effort" (6.0). One figure for every workout: the app does not rate how hard a session was.
//   - hours: the time the session took (start to end). A workout that carries no usable times (an imported one, a
//     past one logged by hand) is counted at SET_MINUTES per completed set, and says so.
//   - body weight: the weight logged with the session, else the latest weigh-in on or before that day, else the latest
//     at all, else DEFAULT_WEIGHT_KG, and says so.
// A workout with no completed set has no figure at all (null), never a zero that reads as a measurement.
import { setsDone } from './history.js'
import { LB_TO_KG } from './recovery.js'
import { getLang } from './i18n.js'

export const STRENGTH_MET = 4.5
export const DEFAULT_WEIGHT_KG = 70
export const SET_MINUTES = 2.5
const MIN_MS = 60 * 1000
const MAX_MS = 6 * 3600 * 1000

const toKg = (w, unit) => (unit === 'lb' ? w * LB_TO_KG : w)

/** { kg, known }: the weight to use for a workout, in kg, and whether it is the person's own. */
export function weightKgFor(S, w) {
  const unit = S?.unit
  if (Number.isFinite(w?.bw) && w.bw > 0) return { kg: toKg(w.bw, unit), known: true }
  const log = (S?.bodyweight || []).filter(b => b && b.w > 0 && b.d).slice().sort((a, b) => String(a.d).localeCompare(String(b.d)))
  if (log.length) {
    const upTo = log.filter(b => !w?.d || b.d <= w.d)
    const pick = upTo.length ? upTo[upTo.length - 1] : log[log.length - 1]
    return { kg: toKg(pick.w, unit), known: true }
  }
  return { kg: DEFAULT_WEIGHT_KG, known: false }
}

/** The estimate for one finished workout, or null when it has no completed set. */
export function workoutKcal(w, S) {
  if (!w || !Array.isArray(w.entries)) return null
  const sets = setsDone(w)
  if (!(sets > 0)) return null
  const ms = Number.isFinite(w.start) && Number.isFinite(w.end) ? w.end - w.start : NaN
  const timed = ms >= MIN_MS && ms <= MAX_MS
  const minutes = timed ? ms / MIN_MS : sets * SET_MINUTES
  const { kg, known } = weightKgFor(S, w)
  return {
    kcal: Math.round(STRENGTH_MET * kg * minutes / 60),
    minutes: Math.round(minutes), met: STRENGTH_MET, weightKg: Math.round(kg * 10) / 10,
    timeKnown: timed, weightKnown: known,
  }
}

const addDays = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** What the workouts started between two local days (inclusive) add up to: { kcal, count, minutes, items }; null when none
 *  has a figure. `items` are [{ w, est }] in the order stored. */
export function kcalBetween(S, fromIso, toIso) {
  const items = []
  let kcal = 0, minutes = 0, estimated = false
  for (const w of S?.workouts || []) {
    if (!w || !(w.d >= fromIso && w.d <= toIso)) continue
    const est = workoutKcal(w, S)
    if (!est) continue
    items.push({ w, est })
    kcal += est.kcal; minutes += est.minutes
    if (!est.timeKnown || !est.weightKnown) estimated = true
  }
  return items.length ? { kcal, count: items.length, minutes, items, rough: estimated } : null
}
export const kcalOfDay = (S, iso) => kcalBetween(S, iso, iso)
/** The `days` days up to and including `iso`. */
export const kcalLastDays = (S, iso, days) => kcalBetween(S, addDays(iso, 1 - days), iso)

const UNIT = { en: 'kcal', id: 'kkal', 'pt-BR': 'kcal' }
/** The word for the unit in the app's language (kilocalories; "kkal" in Indonesian). */
export const kcalUnit = (lang = getLang()) => UNIT[lang] || UNIT[String(lang).split('-')[0]] || UNIT.en
