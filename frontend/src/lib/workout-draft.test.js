// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadDraft, saveDraft, clearDraft, sanitizeDraft, isEmptyDraft, emptyDraft } from './workout-draft.js'

const KEY = 'repo_workout_draft_v1'
beforeEach(() => localStorage.clear())

describe('the unfinished workout kept on this device', () => {
  const draft = { name: 'Arm day', ex: [{ id: '0001', sets: 3, reps: 10, weight: 0 }, { id: 42, sets: 4 }], days: [1, 3] }

  it('comes back exactly as saved', () => {
    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)
  })

  it('an empty draft is nothing: saving it removes what was there', () => {
    saveDraft(draft)
    saveDraft(emptyDraft())
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(loadDraft()).toEqual(emptyDraft())
    expect(isEmptyDraft({ name: '   ', ex: [], days: [] })).toBe(true)
    expect(isEmptyDraft({ name: '', ex: [], days: [0] })).toBe(false)
  })

  it('clearing removes it', () => {
    saveDraft(draft); clearDraft()
    expect(loadDraft()).toEqual(emptyDraft())
  })

  it('a draft untouched for 30 days is dropped, one a day old is kept', () => {
    const now = Date.UTC(2026, 9, 26)
    saveDraft(draft, now - 24 * 3600 * 1000)
    expect(loadDraft(now).name).toBe('Arm day')
    saveDraft(draft, now - 31 * 24 * 3600 * 1000)
    expect(loadDraft(now)).toEqual(emptyDraft())
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('damaged or foreign storage reads as no draft, and never throws', () => {
    for (const text of ['not json', '[]', 'null', '{"at":"x"}', '{"at":1,"draft":5}', '"a string"']) {
      localStorage.setItem(KEY, text)
      expect(() => loadDraft()).not.toThrow()
      expect(isEmptyDraft(loadDraft())).toBe(true)
    }
  })

  it('keeps only well-formed parts: weekdays 0–6 once each, rows that have an id, a name within its limit', () => {
    const s = sanitizeDraft({ name: 'x'.repeat(99), ex: [{ id: 'a' }, null, 'str', { sets: 3 }, [], { id: 7 }], days: [1, 1, 7, -1, 2.5, 'x', 6, 0] })
    expect(s.name).toHaveLength(40)
    expect(s.ex.map(e => e.id)).toEqual(['a', 7])
    expect(s.days).toEqual([1, 6, 0])
    expect(sanitizeDraft(undefined)).toEqual(emptyDraft())
  })

  it('a blocked or full storage means the draft is not kept, not an error', () => {
    const real = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
    try { expect(() => saveDraft(draft)).not.toThrow() } finally { Storage.prototype.setItem = real }
  })
})
