// The XP ledger and the level it adds up to. Kept apart from gamification.js (which pulls in the
// i18n layer for quest text) so sync-merge.js can use it without that.
//
// `S.xpAwarded` maps workout id → XP that workout paid. `S.xp` and `S.level` are always read off
// it, so two devices that each finished different workouts add up to both, and one workout seen
// by both is counted once.

// Cumulative XP required to reach each level (index 0 = level 1).
export const LEVEL_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700]

export function calculateLevel(totalXp) {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (totalXp >= LEVEL_THRESHOLDS[i]) return i + 1
  }
  return 1
}

const isMap = v => v && typeof v === 'object' && !Array.isArray(v)

/** Keep only well-formed entries: a finite, non-negative amount under an id. */
const clean = ledger => Object.fromEntries(
  Object.entries(isMap(ledger) ? ledger : {}).filter(([, v]) => Number.isFinite(v) && v >= 0))

/** Both devices' ledgers as one. A workout both have pays what the larger entry says, once. */
export function mergeXpLedger(a, b) {
  const out = clean(a)
  for (const [id, v] of Object.entries(clean(b))) out[id] = Math.max(out[id] ?? 0, v)
  return out
}

/** The ledger's total and the level it reaches, for writing onto a state. */
export function xpFromLedger(ledger) {
  const xp = Object.values(clean(ledger)).reduce((s, v) => s + v, 0)
  return { xp, level: calculateLevel(xp) }
}
