#!/usr/bin/env node
// How long the equipment filter takes over the whole catalogue (one Library render filters every
// exercise), and what it keeps for a few setups. Numbers come from running it, nothing is assumed:
//
//   node scripts/bench-exercise-filter.mjs
import { performance } from 'node:perf_hooks'
import { EXDB } from '../src/lib/exercises-data.js'
import { exAvailable, newProfile } from '../src/lib/equipment.js'

const profile = (...equipment) => { const p = newProfile('Home'); p.equipment = equipment; return p }
const stateFor = p => ({ equipFilterOn: !!p, activeEquipId: p?.id, equipProfiles: p ? [p] : [] })
const setups = {
  'Gym / filter off': stateFor(null),
  'Home, no equipment': stateFor(profile()),
  'Home, dumbbell': stateFor(profile('dumbbell')),
  'Home, dumbbell + bench + pull-up bar': stateFor(profile('dumbbell', 'bench', 'pull-up bar')),
  'Home, dumbbell + band + kettlebell': stateFor(profile('dumbbell', 'band', 'resistance band', 'kettlebell')),
}

const RUNS = 200
console.log(`catalogue: ${EXDB.length} exercises, ${RUNS} full passes per setup`)
for (const [name, S] of Object.entries(setups)) {
  EXDB.filter(e => exAvailable(S, e))                         // warm up
  const t0 = performance.now()
  let kept = 0
  for (let i = 0; i < RUNS; i++) kept = EXDB.filter(e => exAvailable(S, e)).length
  const per = (performance.now() - t0) / RUNS
  console.log(`${name.padEnd(40)} kept ${String(kept).padStart(5)}   ${per.toFixed(2)} ms per pass`)
}
