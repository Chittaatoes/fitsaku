import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises-data.js'
import { exAvailable, eqAvailable, accessoriesOf, profileEquipment, newProfile, ALL_EQUIPMENT, ACCESSORIES, ACC_V } from './equipment.js'
import { homeClass, requirementsOf, auditCatalogue, keptFor } from './home-fit.js'

/** A state with the Home profile active and the filter on, holding exactly `equipment`. */
const home = (...equipment) => {
  const p = newProfile('Home'); p.equipment = equipment
  return { equipFilterOn: true, activeEquipId: p.id, equipProfiles: [p], _p: p }
}
const byName = name => EXDB.find(e => e.n === name)
const show = (S, name) => { const e = byName(name); expect(e, name).toBeTruthy(); return exAvailable(S, e) }
const gym = { equipFilterOn: false, activeEquipId: null, equipProfiles: [] }

describe('body weight at home', () => {
  it('plain body-weight exercises stay for everyone, with or without equipment', () => {
    for (const S of [home(), home('dumbbell'), home('dumbbell', 'barbell', 'bench')]) {
      expect(show(S, 'push-up')).toBe(true)
      expect(show(S, 'burpee')).toBe(true)
    }
  })

  it('body weight that needs a pull-up bar, a bench, dip bars or a box does not, until you have it', () => {
    expect(show(home(), 'chin-up')).toBe(false)
    expect(show(home('pull-up bar'), 'chin-up')).toBe(true)
    expect(show(home(), 'chest dip')).toBe(false)
    expect(show(home('dip bars'), 'chest dip')).toBe(true)
    expect(show(home(), 'jump box')).toBe(false)
    expect(show(home('plyo box'), 'jump box')).toBe(true)
    expect(show(home('dumbbell'), 'decline sit-up')).toBe(false)
    expect(show(home('bench'), 'decline sit-up')).toBe(true)
  })

  it('a dip that is done on the floor, a bench or straps is not a dip-bars exercise', () => {
    expect(accessoriesOf(byName('triceps dip floor'))).toEqual([])
    expect(accessoriesOf(byName('bench dip on floor'))).not.toContain('dip bars')
    expect(accessoriesOf(byName('suspension triceps dip'))).not.toContain('dip bars')
    expect(accessoriesOf(byName('chest dip'))).toContain('dip bars')
    expect(accessoriesOf(byName('weighted tricep dips'))).toContain('dip bars')
    expect(accessoriesOf(byName('bodyweight step up on stepbox'))).toEqual(['plyo box'])
  })
})

describe('equipment and what goes with it', () => {
  it('a dumbbell shows dumbbell work, but not what also needs a bench', () => {
    const S = home('dumbbell')
    expect(show(S, 'dumbbell squat')).toBe(true)
    expect(show(S, 'dumbbell bench press')).toBe(false)
    expect(show(home('dumbbell', 'bench'), 'dumbbell bench press')).toBe(true)
  })

  it('plates are not a barbell, and a barbell is not plates', () => {
    const barbellExercise = EXDB.find(e => e.eq === 'barbell' && accessoriesOf(e).length === 0)
    const plateExercise = EXDB.find(e => e.eq === 'weight plate' && accessoriesOf(e).length === 0)
    expect(exAvailable(home('weight plate'), barbellExercise)).toBe(false)
    expect(exAvailable(home('barbell'), plateExercise)).toBe(false)
    expect(exAvailable(home('barbell'), barbellExercise)).toBe(true)
    expect(exAvailable(home('weight plate'), plateExercise)).toBe(true)
  })

  it('several pieces of equipment add up, each unlocking its own exercises', () => {
    const e = { dumbbell: EXDB.find(x => x.eq === 'dumbbell' && !accessoriesOf(x).length), band: EXDB.find(x => x.eq === 'band' && !accessoriesOf(x).length), kb: EXDB.find(x => x.eq === 'kettlebell' && !accessoriesOf(x).length) }
    const S = home('dumbbell', 'band', 'kettlebell')
    for (const x of Object.values(e)) expect(exAvailable(S, x)).toBe(true)
    expect(exAvailable(home('band'), e.dumbbell)).toBe(false)
    expect(exAvailable(home('band'), e.band)).toBe(true)
  })

  it('exercises on a machine you do not own are hidden, and no look-alike gets in by name', () => {
    const machine = EXDB.find(e => e.eq === 'leverage machine')
    const smith = EXDB.find(e => e.eq === 'smith machine')
    const S = home('dumbbell', 'barbell', 'bench', 'pull-up bar')
    expect(exAvailable(S, machine)).toBe(false)
    expect(exAvailable(S, smith)).toBe(false)
    expect(exAvailable(home('leverage machine'), machine)).toBe(true)
    // same body part and a similar name, different equipment: decided by `eq`, not by the words
    const dumbbellTwin = EXDB.find(e => e.eq === 'dumbbell' && e.bp === machine.bp && e.tg === machine.tg)
    if (dumbbellTwin) expect(exAvailable(home(), dumbbellTwin)).toBe(false)
  })

  it('adding equipment later reveals what was hidden, removing it hides it again', () => {
    const S = home('dumbbell')
    const curl = EXDB.find(e => e.eq === 'kettlebell' && !accessoriesOf(e).length)
    expect(exAvailable(S, curl)).toBe(false)
    S._p.equipment = [...S._p.equipment, 'kettlebell']
    expect(exAvailable(S, curl)).toBe(true)
    S._p.equipment = S._p.equipment.filter(k => k !== 'kettlebell')
    expect(exAvailable(S, curl)).toBe(false)
    S._p.equipment = ['barbell']                                          // swapped for something else
    expect(exAvailable(S, EXDB.find(e => e.eq === 'dumbbell' && !accessoriesOf(e).length))).toBe(false)
  })
})

describe('what is never decided by guessing', () => {
  it('an exercise with no equipment recorded is not quietly treated as body weight', () => {
    expect(exAvailable(home(), { id: 'x', n: 'mystery move' })).toBe(false)
    expect(exAvailable(home('dumbbell', 'barbell'), { id: 'x', n: 'mystery move' })).toBe(false)
    expect(exAvailable(gym, { id: 'x', n: 'mystery move' })).toBe(true)      // the whole catalogue is still there with the filter off
    expect(homeClass({ id: 'x', n: 'mystery move' })).toBe('unknown')
  })
  it('your own exercise stays visible, with or without equipment recorded', () => {
    expect(exAvailable(home(), { id: 'c1', n: 'my thing', custom: true })).toBe(true)
    expect(exAvailable(home(), { id: 'c2', n: 'my thing', eq: 'custom', custom: true })).toBe(true)
    expect(exAvailable(home(), { id: 'c3', n: 'my row', eq: 'barbell', custom: true })).toBe(false)
  })
  it('with the filter off, or no profile, every exercise is available', () => {
    expect(EXDB.every(e => exAvailable(gym, e))).toBe(true)
    expect(EXDB.every(e => exAvailable({ equipFilterOn: true, activeEquipId: 'gone', equipProfiles: [] }, e))).toBe(true)   // a deleted profile hides nothing
  })
})

describe('profiles saved before an accessory existed', () => {
  it('keep what they had, and count as having what came later until they are saved again', () => {
    expect(ACC_V).toBe(2)
    expect(profileEquipment({ equipment: ['dumbbell'] })).toEqual(['dumbbell', ...ACCESSORIES])           // before the bench and bar
    expect(profileEquipment({ equipment: ['dumbbell'], accV: 1 })).toEqual(['dumbbell', 'dip bars', 'plyo box'])
    expect(profileEquipment({ equipment: ['dumbbell'], accV: 2 })).toEqual(['dumbbell'])
    expect(show({ equipFilterOn: true, activeEquipId: 'p', equipProfiles: [{ id: 'p', equipment: ['dumbbell'], accV: 1 }] }, 'chest dip')).toBe(true)
    expect(show({ equipFilterOn: true, activeEquipId: 'p', equipProfiles: [{ id: 'p', equipment: ['dumbbell'], accV: 2 }] }, 'chest dip')).toBe(false)
  })
  it('every accessory is on the checklist a profile offers', () => {
    for (const a of ACCESSORIES) expect(ALL_EQUIPMENT).toContain(a)
  })
})

describe('the catalogue audit', () => {
  const a = auditCatalogue(EXDB)
  it('classifies every exercise exactly once, and none is unknown', () => {
    expect(a.total).toBe(EXDB.length)
    expect(Object.values(a.byClass).reduce((x, y) => x + y, 0)).toBe(EXDB.length)
    expect(a.byClass.unknown).toBe(0)
    expect(a.byClass.free + a.byClass.accessory).toBe(EXDB.filter(e => e.eq === 'body weight').length)
  })
  it('a profile that has everything keeps the whole catalogue: nothing is lost to the filter', () => {
    expect(keptFor(EXDB, { equipment: ALL_EQUIPMENT, accV: ACC_V })).toBe(EXDB.length)
  })
  it('an empty profile keeps exactly the free body-weight exercises', () => {
    expect(keptFor(EXDB, { equipment: [], accV: ACC_V })).toBe(a.byClass.free)
    expect(EXDB.filter(e => eqAvailable([], e)).every(e => homeClass(e) === 'free')).toBe(true)
  })
  it('more equipment never keeps fewer exercises', () => {
    const steps = [[], ['dumbbell'], ['dumbbell', 'bench'], ['dumbbell', 'bench', 'barbell'], ['dumbbell', 'bench', 'barbell', 'pull-up bar']]
    const counts = steps.map(eq => keptFor(EXDB, { equipment: eq, accV: ACC_V }))
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    expect(counts[1]).toBeGreaterThan(counts[0])
  })
  it('names the requirements of an exercise', () => {
    expect(requirementsOf(byName('dumbbell bench press'))).toEqual({ equipment: 'dumbbell', accessories: ['bench'] })
    expect(requirementsOf(byName('push-up'))).toEqual({ equipment: null, accessories: [] })
  })
})
