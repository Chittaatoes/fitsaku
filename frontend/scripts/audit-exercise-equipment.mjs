#!/usr/bin/env node
// An audit of what the catalogue says about the equipment each exercise needs, and what the Home
// Workout filter keeps for a few setups. Every number comes from running this:
//
//   node scripts/audit-exercise-equipment.mjs
import { EXDB } from '../src/lib/exercises-data.js'
import { ALL_EQUIPMENT, newProfile } from '../src/lib/equipment.js'
import { auditCatalogue, keptFor, homeClass } from '../src/lib/home-fit.js'

const a = auditCatalogue(EXDB)
console.log(`catalogue: ${a.total} exercises`)
console.log('by class  :', JSON.stringify(a.byClass))
console.log('accessories read off names:', JSON.stringify(a.byAccessory))
const ranked = Object.entries(a.byEquipment).sort((x, y) => y[1] - x[1])
console.log('by equipment (' + ranked.length + ' values):', ranked.map(([k, v]) => `${k} ${v}`).join(', '))
const missing = EXDB.filter(e => !e.eq)
const unlisted = [...new Set(EXDB.map(e => e.eq).filter(eq => eq && !ALL_EQUIPMENT.includes(eq)))]
console.log(`no equipment recorded: ${missing.length}; equipment values a profile cannot tick: ${unlisted.length ? unlisted.join(', ') : 'none'}`)

const profile = (...equipment) => { const p = newProfile('Home'); p.equipment = equipment; return p }
const setups = [
  ['Gym, or filter off (everything)', null],
  ['Home, no equipment', profile()],
  ['Home: dumbbell', profile('dumbbell')],
  ['Home: dumbbell + bench', profile('dumbbell', 'bench')],
  ['Home: dumbbell + bench + pull-up bar + dip bars + plyo box', profile('dumbbell', 'bench', 'pull-up bar', 'dip bars', 'plyo box')],
  ['Home: barbell + plates only', profile('barbell', 'weight plate')],
  ['Home: band + resistance band + kettlebell', profile('band', 'resistance band', 'kettlebell')],
]
console.log('\nkept by setup:')
for (const [name, p] of setups) console.log(`  ${name.padEnd(62)} ${String(p ? keptFor(EXDB, p) : EXDB.length).padStart(5)}`)
const hiddenFree = EXDB.filter(e => homeClass(e) === 'free').length
console.log(`\nbody weight with nothing else needed (always shown at home): ${hiddenFree}`)
