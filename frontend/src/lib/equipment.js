import { t } from './i18n-core.js'
import { EXDB } from './exercises-data.js'

// Pieces of kit the catalogue never names as an exercise's equipment — "dumbbell bench press" is
// tagged `dumbbell`, yet it needs a bench; "chin-up" is tagged `body weight`, yet it needs a bar.
// They are read off the exercise name instead of stored on 1,300 rows, and sit in the profile
// checklist beside the real equipment values.
// 'dip bars' (parallel bars, a dip station) and 'plyo box' (a jump or step box) were added with the Home
// Workout filter: dip and box exercises are tagged `body weight` yet cannot be done without them.
// Chairs, walls, stairs, a towel or a table are household things and are NOT asked for (lib/home-fit.js).
export const ACCESSORIES = ['bench', 'pull-up bar', 'dip bars', 'plyo box']
// Which accessories came in at which version of a saved profile (accV): a profile keeps working with
// what it had when it was saved, and counts as having what was added since until it is saved again.
const ACC_ADDED = { 1: ['bench', 'pull-up bar'], 2: ['dip bars', 'plyo box'] }

// Machines that carry their own seat, bar or bench: "lever incline chest press" needs no bench.
const SELF_CONTAINED = new Set(['leverage machine', 'sled machine', 'assisted'])

// Which accessories an exercise needs, e.g. ['bench'] for "dumbbell incline bench press".
// Dips on parallel bars or a dip station (a bench dip is done on a bench or a chair, so it is not
// one), and jumps, drops and steps onto a box.
const DIP_BARS = /parallel bars|\bdip bars?\b|dip station|dip-pull-up cage|\b(chest|triceps?|ring|weighted|assisted) dips?\b|\bdips?\b/
const NOT_DIP_BARS = /\bbench dips?\b|\bchair dips?\b|\bdips? (on|between) (the )?(floor|chairs?|benches)\b|\bdips? floor\b|\bdips? \(bench|\bjerk dip\b|\bstretch\b/
// Dips held by straps, a ball or a bar in the hands elsewhere need that equipment, not parallel bars.
const NOT_DIP_EQ = new Set(['suspension trainer', 'stability ball', 'barbell', 'cable', 'kettlebell', 'dumbbell'])
const PLYO_BOX = /\bjump box\b|\bbox jump|\bbox drop|\bplyo(metric)? box\b|\bstep ?box\b/

// Read off the name once per exercise object and remembered: one Library pass asks about all 5,632.
const accessoryCache = new WeakMap()
export function accessoriesOf(ex) {
  if (!ex || !ex.n || SELF_CONTAINED.has(ex.eq)) return []
  const hit = accessoryCache.get(ex)
  if (hit && hit.n === ex.n && hit.eq === ex.eq) return hit.need
  const n = ex.n.toLowerCase()
  const need = []
  if (/\bbench\b|\bincline\b|\bdecline\b/.test(n)) need.push('bench')
  if (/pull-up|pull up|chin-up|\bchin\b|hanging|muscle-up|muscle up/.test(n)) need.push('pull-up bar')
  if (DIP_BARS.test(n) && !NOT_DIP_BARS.test(n) && !NOT_DIP_EQ.has(ex.eq)) need.push('dip bars')
  if (PLYO_BOX.test(n)) need.push('plyo box')
  accessoryCache.set(ex, { n: ex.n, eq: ex.eq, need })
  return need
}

// Every equipment value present in the catalogue, most common first, then the accessories —
// this becomes the checklist Settings shows when you build a profile.
export const ALL_EQUIPMENT = (() => {
  const c = {}
  EXDB.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  const ranked = Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
  // Clubbell and macebell have no catalogue entries yet (issue #393). They still belong on the
  // profile checklist and the custom-exercise chips, after everything the catalogue already uses.
  for (const extra of ['clubbell', 'macebell']) if (!ranked.includes(extra)) ranked.push(extra)
  return ranked.concat(ACCESSORIES)
})()

// Body weight is never gated by a profile — no gym or home setup can take it away from you,
// and every profile should be able to see bodyweight exercises regardless of what's checked.
// Only the accessory an exercise needs (a bar, a bench) can still gate it.
const ALWAYS_AVAILABLE = 'body weight'
export const ALWAYS_BODY = ALWAYS_AVAILABLE

export function activeProfile(S) {
  if (!S.equipFilterOn) return null
  const profiles = S.equipProfiles || []
  return profiles.find(p => p.id === S.activeEquipId) || null
}

// Whether an exercise is usable under the active profile. With filtering off, or no profile
// selected, everything is available — this is purely additive, never a trap that hides your
// whole library because you haven't set anything up yet.
export function exAvailable(S, ex) {
  const p = activeProfile(S)
  if (!p) return true
  return eqAvailable(profileEquipment(p), ex)
}

// A profile saved before the bench and the bar were on the checklist (#464) never had the chance
// to tick them; read as unticked, every bench press and pull-up would vanish from it overnight.
// It counts as having both until it is saved again, and the sheet shows them ticked.
export const ACC_V = 2
export function profileEquipment(p) {
  const have = p?.equipment || []
  if (!p || p.accV === ACC_V) return have
  const v = Number.isInteger(p.accV) ? p.accV : 0
  const added = Object.entries(ACC_ADDED).filter(([ver]) => +ver > v).flatMap(([, list]) => list)
  return added.length ? [...new Set([...have, ...added])] : have
}

// The same test against a bare equipment list, for callers that hold a profile rather than S.
export function eqAvailable(equipment, ex) {
  const have = equipment || []
  // No equipment recorded: the requirement is unknown, so it is not quietly counted as body weight.
  // Only an exercise the user made themselves stays (it is theirs, and could never be ticked back).
  if (!ex.eq) return !!ex.custom
  if (ex.eq && ex.eq !== ALWAYS_AVAILABLE) {
    // Equipment no profile can tick (an imported exercise's "custom") would hide the user's own
    // exercise under every profile, with no way to bring it back. It stays, like body weight.
    if (!ALL_EQUIPMENT.includes(ex.eq)) return true
    if (!have.includes(ex.eq)) return false
  }
  return accessoriesOf(ex).every(a => have.includes(a))
}

export function newProfile(name) {
  return { id: 'eq' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, equipment: [], accV: ACC_V }
}
