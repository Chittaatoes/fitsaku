// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { DEF, freshState, restartedState } from '../store/useStore.js'
import {
  applyWorkoutPrefs, setWorkoutMode, setHomeFilter, ensureHomeProfile, homeProfileOf, modeOf, needsWorkoutOnboarding, WORKOUT_MODES,
} from './workout-prefs.js'
import { activeProfile, exAvailable, profileEquipment } from './equipment.js'
import { EXDB } from './exercises-data.js'

const clone = v => JSON.parse(JSON.stringify(v))
const fresh = () => freshState()
const kept = S => EXDB.filter(e => exAvailable(S, e)).length

describe('who is asked', () => {
  it('a brand-new profile is asked once', () => {
    expect(fresh().workoutOnboarded).toBe(false)
    expect(needsWorkoutOnboarding(fresh())).toBe(true)
    expect(needsWorkoutOnboarding(restartedState({ lang: 'id' }))).toBe(true)      // after "reset everything"
  })
  it('a profile saved before this existed is never asked: the flag is not in DEF', () => {
    expect('workoutOnboarded' in DEF).toBe(false)
    expect(needsWorkoutOnboarding(clone(DEF))).toBe(false)
    expect(modeOf(DEF)).toBeNull()
    expect(DEF.equipFilterOn).toBe(false)                // an existing profile still sees every exercise
  })
  it('a new profile that already holds something (a sign-in merged an account into it) is not asked either', () => {
    for (const patch of [{ workouts: [{ id: 'w' }] }, { routines: [{ id: 'r' }] }, { equipProfiles: [{ id: 'p', equipment: [] }] }, { customEx: [{ id: 'c' }] }])
      expect(needsWorkoutOnboarding({ ...fresh(), ...patch })).toBe(false)
  })
  it('after answering, never again', () => {
    for (const answer of [{ mode: 'gym' }, { mode: 'home', equipment: [] }, { mode: null }]) {
      const s = fresh(); applyWorkoutPrefs(s, answer)
      expect(needsWorkoutOnboarding(s)).toBe(false)
      expect(s.workoutOnboarded).toBe(true)
    }
  })
})

describe('first-run answers', () => {
  it('Home Workout with equipment: a Home profile, active, filter on', () => {
    const s = fresh(); applyWorkoutPrefs(s, { mode: 'home', equipment: ['dumbbell', 'bench'], homeName: 'Home' })
    expect(s.workoutMode).toBe('home')
    expect(s.equipFilterOn).toBe(true)
    const p = activeProfile(s)
    expect(p.name).toBe('Home')
    expect(p.equipment).toEqual(['dumbbell', 'bench'])
    expect(homeProfileOf(s).id).toBe(p.id)
    expect(s.equipProfiles).toHaveLength(1)
  })
  it('Home Workout with no equipment, or skipped: still Home Workout, body-weight exercises only', () => {
    const none = fresh(); applyWorkoutPrefs(none, { mode: 'home', equipment: [] })
    const skipped = fresh(); applyWorkoutPrefs(skipped, { mode: 'home' })
    for (const s of [none, skipped]) {
      expect(s.workoutMode).toBe('home'); expect(s.equipFilterOn).toBe(true)
      expect(activeProfile(s).equipment).toEqual([])
    }
    expect(kept(none)).toBeGreaterThan(1500); expect(kept(none)).toBeLessThan(EXDB.length / 2)
  })
  it('Gym: the whole catalogue, no profile made, nothing filtered', () => {
    const s = fresh(); applyWorkoutPrefs(s, { mode: 'gym' })
    expect(s.workoutMode).toBe('gym'); expect(s.equipFilterOn).toBe(false)
    expect(s.equipProfiles).toEqual([]); expect(kept(s)).toBe(EXDB.length)
  })
  it('"Not now": nothing changes except that it is not asked again', () => {
    const s = fresh(); applyWorkoutPrefs(s, { mode: null })
    expect(modeOf(s)).toBeNull(); expect(s.equipFilterOn).toBe(false); expect(kept(s)).toBe(EXDB.length)
  })
  it('only the two modes exist', () => { expect(WORKOUT_MODES).toEqual(['home', 'gym']); expect(modeOf({ workoutMode: 'nonsense' })).toBeNull() })
})

describe('changing it afterwards', () => {
  const homeUser = (equipment = ['dumbbell']) => { const s = fresh(); applyWorkoutPrefs(s, { mode: 'home', equipment }); return s }

  it('the filter switch changes only the filter: off shows everything, the mode and equipment stay, on restores the match', () => {
    const s = homeUser(); const matched = kept(s)
    setHomeFilter(s, false)
    expect(kept(s)).toBe(EXDB.length)
    expect(s.workoutMode).toBe('home')
    expect(homeProfileOf(s).equipment).toEqual(['dumbbell'])
    setHomeFilter(s, true)
    expect(kept(s)).toBe(matched)
  })
  it('Gym then Home again: the equipment list is still there, no second Home profile is made', () => {
    const s = homeUser(['dumbbell', 'kettlebell'])
    setWorkoutMode(s, 'gym'); expect(kept(s)).toBe(EXDB.length); expect(s.workoutMode).toBe('gym')
    setWorkoutMode(s, 'home')
    expect(s.workoutMode).toBe('home'); expect(s.equipFilterOn).toBe(true)
    expect(s.equipProfiles).toHaveLength(1)
    expect(activeProfile(s).equipment).toEqual(['dumbbell', 'kettlebell'])
  })
  it('equipment added later shows more exercises; removed shows fewer', () => {
    const s = homeUser(['dumbbell']); const base = kept(s)
    homeProfileOf(s).equipment.push('kettlebell'); expect(kept(s)).toBeGreaterThan(base)
    homeProfileOf(s).equipment = []; expect(kept(s)).toBeLessThan(base)
  })
  it('an existing profile that turns Home Workout on gets a profile only if it has none, and keeps its own', () => {
    const s = clone(DEF); s.equipProfiles = [{ id: 'mine', name: 'Garage', equipment: ['barbell'], accV: 2 }]; s.activeEquipId = 'mine'
    setWorkoutMode(s, 'home')
    expect(s.equipProfiles).toHaveLength(1); expect(activeProfile(s).id).toBe('mine'); expect(s.homeEquipId).toBe('mine')
    const bare = clone(DEF); setWorkoutMode(bare, 'home')
    expect(bare.equipProfiles).toHaveLength(1); expect(activeProfile(bare).equipment).toEqual([])
  })
  it('a deleted Home profile leaves nothing invalid behind: nothing is hidden, and turning it on again makes a usable one', () => {
    const s = homeUser(['dumbbell'])
    s.equipProfiles = []; s.activeEquipId = null                         // deleted in Settings
    expect(homeProfileOf(s)).toBeNull(); expect(activeProfile(s)).toBeNull()
    expect(kept(s)).toBe(EXDB.length)
    setHomeFilter(s, true)
    expect(activeProfile(s)).toBeTruthy(); expect(s.equipFilterOn).toBe(true)
  })
  it('ensureHomeProfile reuses the one it made and can replace its list', () => {
    const s = clone(DEF)
    const a = ensureHomeProfile(s, 'Home', ['band']); const b = ensureHomeProfile(s, 'Home')
    expect(b.id).toBe(a.id); expect(s.equipProfiles).toHaveLength(1)
    ensureHomeProfile(s, 'Home', ['band', 'band', 'barbell'])
    expect(a.equipment).toEqual(['band', 'barbell'])
  })
})

describe('it survives a restart', () => {
  it('everything it stores is plain data that round-trips through the saved copy', () => {
    const s = fresh(); applyWorkoutPrefs(s, { mode: 'home', equipment: ['dumbbell'] })
    localStorage.setItem('x', JSON.stringify(s))
    const back = Object.assign(clone(DEF), JSON.parse(localStorage.getItem('x')))      // how loadState merges a saved copy
    expect(back.workoutMode).toBe('home'); expect(back.equipFilterOn).toBe(true)
    expect(activeProfile(back).equipment).toEqual(['dumbbell'])
    expect(needsWorkoutOnboarding(back)).toBe(false)
    expect(profileEquipment(activeProfile(back))).toEqual(['dumbbell'])
  })
})
