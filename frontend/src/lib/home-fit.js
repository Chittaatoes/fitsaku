// What the catalogue's 5,632 exercises ask of someone training at home, as a measured classification
// rather than a guess. It adds no catalogue and no inventory: it reads the equipment the catalogue
// already tags (`eq`) and the accessories lib/equipment.js reads off the name, and the filtering
// itself stays lib/equipment.js `exAvailable` (one function every list in the app already asks).
//
//   free            body weight, nothing else needed
//   accessory       body weight, but needs a listed accessory (pull-up bar, bench, dip bars, plyo box)
//   equipment       needs the equipment its `eq` names (and any accessory)
//   unknown         no equipment recorded, so the requirement cannot be told
//
// Assumed to be in every home and never asked for: the floor, a wall, a chair or sofa, stairs, a
// towel, a table. Exercises that use only those count as `free`; the cost of that assumption is
// stated in the audit (a handful of names mention a "captain's chair" or a "box" that is a gym fitting).

import { ALWAYS_BODY, accessoriesOf, eqAvailable, profileEquipment } from './equipment.js'

export const HOME_CLASSES = ['free', 'accessory', 'equipment', 'unknown']

export function homeClass(ex) {
  if (!ex || !ex.eq) return 'unknown'
  const acc = accessoriesOf(ex)
  if (ex.eq === ALWAYS_BODY) return acc.length ? 'accessory' : 'free'
  return 'equipment'
}

/** What an exercise needs: its equipment (null for body weight) and its accessories. */
export const requirementsOf = ex => ({
  equipment: ex && ex.eq && ex.eq !== ALWAYS_BODY ? ex.eq : null,
  accessories: accessoriesOf(ex),
})

/** Counts for a list of exercises: by class, by equipment, how many stay for a given equipment list. */
export function auditCatalogue(list, equipment = null) {
  const byClass = Object.fromEntries(HOME_CLASSES.map(c => [c, 0]))
  const byEquipment = {}
  const byAccessory = {}
  let kept = 0
  for (const ex of list) {
    byClass[homeClass(ex)]++
    if (ex.eq) byEquipment[ex.eq] = (byEquipment[ex.eq] || 0) + 1
    for (const a of accessoriesOf(ex)) byAccessory[a] = (byAccessory[a] || 0) + 1
    if (equipment && eqAvailable(equipment, ex)) kept++
  }
  return { total: list.length, byClass, byEquipment, byAccessory, kept: equipment ? kept : null }
}

/** How many exercises a saved profile keeps, with its version rules (profiles saved before an accessory existed). */
export const keptFor = (list, profile) => list.filter(ex => eqAvailable(profileEquipment(profile), ex)).length
