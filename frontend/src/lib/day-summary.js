// What was finished today, read from the workouts the store already holds (S.workouts): the "workout complete" card on
// the Train screen. Nothing is kept anywhere else, so it is as current as the store (a workout is in it the moment it is
// finished, synced or not), and it follows the local calendar day the rest of the app uses (a workout is filed under the
// day it was started, `w.d`).
//
// A workout counts when it has at least one completed set. A session still under way, or thrown away, is not in
// S.workouts at all. A figure that is not there (no start or end time, no weight lifted, no record) is left out, not
// invented.
import { setsDone, doneUnits, workoutVolume } from './history.js'
import { EXIDX } from './exercises.js'
import { fmtDur, fmtNum } from './format.js'
import { getLang } from './i18n.js'

const DAY_MS = 24 * 3600 * 1000

/** The day's finished workouts, summed up; null when there is none. */
export function completedToday(S, today, index = EXIDX) {
  const list = (S?.workouts || []).filter(w => w && w.d === today && Array.isArray(w.entries) && setsDone(w) > 0)
  if (!list.length) return null
  const names = []
  const bodyParts = []
  let sets = 0, durMs = 0, volume = 0, prs = 0
  for (const w of list) {
    const name = typeof w.name === 'string' ? w.name.trim() : ''
    if (name && !names.includes(name)) names.push(name)
    for (const e of w.entries) {
      if (!e.sets?.some(s => doneUnits(s) > 0)) continue
      const bp = index[e.id]?.bp ?? e.muscleSnapshot?.bp
      if (bp && !bodyParts.includes(bp)) bodyParts.push(bp)
    }
    sets += setsDone(w)
    if (Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start && w.end - w.start < DAY_MS) durMs += w.end - w.start
    const vol = Math.round(workoutVolume(w))
    if (vol > 0) volume += vol
    if (Array.isArray(w.prs)) prs += w.prs.length
  }
  return { count: list.length, names, bodyParts, sets, durMs, volume, prs }
}

const COPY = {
  en: {
    title: 'Workout complete today!',
    one: 'Today you trained {0}. Great work! 💪', none: 'You trained today. Great work! 💪',
    set: '{0} set', sets: '{0} sets', sessions: '{0} sessions',
  },
  id: {
    title: 'Latihan hari ini selesai!',
    one: 'Hari ini kamu sudah melatih {0}. Kerja bagus! 💪', none: 'Hari ini kamu sudah berlatih. Kerja bagus! 💪',
    set: '{0} set', sets: '{0} set', sessions: '{0} sesi',
  },
  'pt-BR': {
    title: 'Treino de hoje concluído!',
    one: 'Hoje você treinou {0}. Bom trabalho! 💪', none: 'Você treinou hoje. Bom trabalho! 💪',
    set: '{0} série', sets: '{0} séries', sessions: '{0} sessões',
  },
}
const copyFor = lang => COPY[lang] || COPY[String(lang).split('-')[0]] || COPY.en

/** The words of the card: a title, a message about what was trained, and the figures that are there as chips. `label` turns a
 *  body part key into its name (lib/body-parts.js bpLabel). */
export function doneCard(summary, { unit = 'kg', label = bp => bp, lang = getLang() } = {}) {
  const c = copyFor(lang)
  const trained = summary.names.length ? summary.names.join(' + ') : summary.bodyParts.map(label).join(' + ')
  const chips = []
  if (summary.count > 1) chips.push(c.sessions.replace('{0}', String(summary.count)))
  if (summary.sets > 0) chips.push((summary.sets === 1 ? c.set : c.sets).replace('{0}', String(summary.sets)))
  if (summary.durMs >= 60000) chips.push(fmtDur(summary.durMs))
  if (summary.volume > 0) chips.push(fmtNum(summary.volume) + ' ' + unit)
  return {
    title: c.title,
    message: trained ? c.one.replace('{0}', trained) : c.none,
    parts: summary.bodyParts.map(label),
    chips,
    prs: summary.prs,
  }
}
