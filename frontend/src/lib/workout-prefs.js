// The "how do you train" preference, on top of the equipment system that already exists (lib/equipment.js:
// profiles, the active profile, S.equipFilterOn). Nothing here is a second inventory or a second filter:
//
//   Home Workout  = an equipment profile of what you have at home, active, with the filter on
//   Gym           = the filter off: the whole catalogue, as before
//
// S.workoutMode records the choice ('home' | 'gym' | null for "never chosen", which is every profile that
// existed before this and behaves exactly as it always did). S.workoutOnboarded is `false` only for a profile
// that is brand new and has not answered yet (store/useStore.js freshState); `undefined` (every saved
// profile) never shows the first-run questions. S.homeEquipId names the profile onboarding made, so
// switching between Home and Gym later reuses it instead of piling up copies.
//
// Turning the filter off never changes the mode and never touches the equipment list.

import { newProfile } from './equipment.js'

export const WORKOUT_MODES = ['home', 'gym']
export const modeOf = S => (WORKOUT_MODES.includes(S?.workoutMode) ? S.workoutMode : null)
// Asked only of a brand-new profile that has not answered. A profile that already holds anything of its own
// (a sign-in that merged an existing account into a fresh copy, an import) is never asked, whatever the flag says.
export const needsWorkoutOnboarding = S => S?.workoutOnboarded === false && !modeOf(S)
  && !(S.workouts || []).length && !(S.routines || []).length && !(S.equipProfiles || []).length && !(S.customEx || []).length

/** The Home profile onboarding made, if it still exists (it may have been deleted in Settings since). */
export const homeProfileOf = S => (S?.equipProfiles || []).find(p => p.id === S?.homeEquipId) || null

/** The Home profile, created when there is none; with `equipment` given, its list is set to it. */
export function ensureHomeProfile(s, name, equipment) {
  s.equipProfiles = s.equipProfiles || []
  let p = homeProfileOf(s)
  if (!p) {
    p = newProfile(name)
    s.equipProfiles.push(p)
    s.homeEquipId = p.id
  }
  if (Array.isArray(equipment)) p.equipment = [...new Set(equipment)]
  return p
}

/** First-run answer: 'home' (with the equipment ticked, possibly none), 'gym', or null for "not now". */
export function applyWorkoutPrefs(s, { mode, equipment = [], homeName = 'Home' } = {}) {
  s.workoutOnboarded = true
  if (mode === 'gym') {
    s.workoutMode = 'gym'
    s.equipFilterOn = false
  } else if (mode === 'home') {
    const p = ensureHomeProfile(s, homeName, equipment)
    s.workoutMode = 'home'
    s.activeEquipId = p.id
    s.equipFilterOn = true
  }
}

/** Settings → Workout style: switching keeps the equipment list, and Home reuses its profile. */
export function setWorkoutMode(s, mode, homeName = 'Home') {
  if (mode === 'gym') { s.workoutMode = 'gym'; s.equipFilterOn = false; return }
  if (mode === 'home') {
    const p = homeProfileOf(s) || (s.equipProfiles || []).find(x => x.id === s.activeEquipId) || null
    const home = p || ensureHomeProfile(s, homeName)
    s.homeEquipId = home.id
    s.workoutMode = 'home'
    s.activeEquipId = home.id
    s.equipFilterOn = true
  }
}

/** The "match exercises to my equipment" switch: only the filter, never the mode or the equipment. */
export function setHomeFilter(s, on, homeName = 'Home') {
  if (on) {
    const have = (s.equipProfiles || []).some(p => p.id === s.activeEquipId)
    if (!have) {
      const p = (s.equipProfiles || [])[0] || ensureHomeProfile(s, homeName)
      s.activeEquipId = p.id
    }
    s.equipFilterOn = true
  } else {
    s.equipFilterOn = false
  }
}
