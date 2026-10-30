// Quick Activities: three small things worth doing any day, workout day or rest day: a drink of water, a few deep breaths,
// a stretch. Nothing to count or time: each is just done, or not, today.
//
// Whether one is done is not stored anywhere of its own. It is the XP ledger (`S.xpAwarded`, lib/xp.js) that says so: finishing one
// writes the key `qa:<local day>:<id>`, and "done today" is that key being there. So there is one record, which is also the proof
// of the XP: it survives a reload and a sign-in on another device (the ledger is what sync merges, an entry counted once), it
// cannot be ticked twice for XP, it cannot be unticked, and a new local day starts with every activity open without anything to
// reset. The ids and the order are fixed; there are no others.
export const QUICK_ACTIVITIES = [
  { id: 'water', icon: 'drop' },
  { id: 'breath', icon: 'wind' },
  { id: 'stretch', icon: 'stretch' },
]
export const QUICK_IDS = QUICK_ACTIVITIES.map(a => a.id)

/** The ledger key of one activity on one local day ('2026-10-30'). */
export const quickKey = (day, id) => 'qa:' + day + ':' + id

/** The activities done on `day`: a Set of ids, read off the ledger. */
export function quickDone(S, day) {
  const ledger = S && typeof S.xpAwarded === 'object' && S.xpAwarded ? S.xpAwarded : {}
  return new Set(QUICK_IDS.filter(id => Object.hasOwn(ledger, quickKey(day, id))))
}
