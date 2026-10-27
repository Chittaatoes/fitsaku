// The unfinished "Create your own workout" (views/CreateWorkout.jsx), kept on this device.
//
// A phone may drop the page whenever the app is in the background (switching to another app, the
// WebView being reclaimed), and the screen's own state goes with it. So every change is written
// here as it happens and read back when the screen opens: the user comes back to what they had.
// It lives in localStorage on its own key, not in the synced state: a half-built workout is not
// data to send to other devices or to merge, and it is cleared the moment it is saved or the user
// starts over. A draft untouched for 30 days is dropped.

const KEY = 'repo_workout_draft_v1'
const MAX_AGE_MS = 30 * 24 * 3600 * 1000
const NAME_MAX = 40

const store = () => { try { return globalThis.localStorage } catch { return null } }

export const emptyDraft = () => ({ name: '', ex: [], days: [] })
export const isEmptyDraft = d => !d || (!String(d.name || '').trim() && !(d.ex || []).length && !(d.days || []).length)

/** What the stored text may become: strings, plain exercise rows with an id, weekdays 0–6 once each.
 *  Anything else is dropped, so a damaged or foreign value cannot break the screen. */
export function sanitizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return emptyDraft()
  const ex = (Array.isArray(raw.ex) ? raw.ex : []).filter(e => e && typeof e === 'object' && !Array.isArray(e) && (typeof e.id === 'string' || typeof e.id === 'number'))
  const days = [...new Set((Array.isArray(raw.days) ? raw.days : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))]
  return { name: typeof raw.name === 'string' ? raw.name.slice(0, NAME_MAX) : '', ex: ex.map(e => ({ ...e })), days }
}

/** The saved draft, or an empty one (nothing saved, too old, unreadable). */
export function loadDraft(now = Date.now()) {
  try {
    const s = store(); const text = s && s.getItem(KEY)
    if (!text) return emptyDraft()
    const doc = JSON.parse(text)
    if (!doc || typeof doc !== 'object' || !(now - Number(doc.at) < MAX_AGE_MS)) { s.removeItem(KEY); return emptyDraft() }
    return sanitizeDraft(doc.draft)
  } catch { return emptyDraft() }
}

/** Writes the draft (or removes it when there is nothing in it). Never throws: a full or blocked
 *  storage only means the draft is not kept. */
export function saveDraft(draft, now = Date.now()) {
  try {
    const s = store(); if (!s) return
    if (isEmptyDraft(draft)) s.removeItem(KEY)
    else s.setItem(KEY, JSON.stringify({ at: now, draft: sanitizeDraft(draft) }))
  } catch { /* not kept */ }
}

export function clearDraft() { try { store()?.removeItem(KEY) } catch { /* nothing to clear */ } }
