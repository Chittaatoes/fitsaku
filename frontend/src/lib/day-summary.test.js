import { describe, expect, it } from 'vitest'
import { completedToday, doneCard } from './day-summary.js'

const TODAY = '2026-10-28'
const idx = { sh1: { bp: 'shoulders' }, sh2: { bp: 'shoulders' }, ch1: { bp: 'chest' } }
const set = (w, r, done = true) => ({ w, r, done })
const entry = (id, sets) => ({ id, sets })
const workout = (over = {}) => ({
  id: 'w' + Math.random(), d: TODAY, name: 'Shoulder', start: 1_000_000, end: 1_000_000 + 45 * 60000,
  entries: [entry('sh1', [set(20, 10), set(20, 10)]), entry('sh2', [set(10, 12)])], prs: [], ...over,
})
const S = (...workouts) => ({ workouts, unit: 'kg' })

describe('completedToday', () => {
  it('is null with no workout today', () => {
    expect(completedToday(S(), TODAY, idx)).toBeNull()
    expect(completedToday({}, TODAY, idx)).toBeNull()
  })

  it('sums up one finished Shoulder workout: name, body part, sets, time, volume', () => {
    const r = completedToday(S(workout()), TODAY, idx)
    expect(r).toMatchObject({ count: 1, names: ['Shoulder'], bodyParts: ['shoulders'], sets: 3, durMs: 45 * 60000, prs: 0 })
    expect(r.volume).toBe(20 * 10 * 2 + 10 * 12)
  })

  it('names and body parts of several workouts are listed once each, in order', () => {
    const r = completedToday(S(
      workout({ name: 'Shoulder' }),
      workout({ name: 'Chest', entries: [entry('ch1', [set(40, 8)]), entry('sh1', [set(10, 10)])] }),
      workout({ name: 'Shoulder', entries: [entry('sh2', [set(8, 12)])] }),
    ), TODAY, idx)
    expect(r.count).toBe(3)
    expect(r.names).toEqual(['Shoulder', 'Chest'])
    expect(r.bodyParts).toEqual(['shoulders', 'chest'])
    expect(r.sets).toBe(3 + 2 + 1)
  })

  it('does not count a workout from another day, nor one with no completed set', () => {
    expect(completedToday(S(workout({ d: '2026-10-27' })), TODAY, idx)).toBeNull()
    expect(completedToday(S(workout({ d: '2026-10-29' })), TODAY, idx)).toBeNull()
    expect(completedToday(S(workout({ entries: [entry('sh1', [set(20, 10, false)])] })), TODAY, idx)).toBeNull()
    expect(completedToday(S(workout({ entries: [] })), TODAY, idx)).toBeNull()
  })

  it('an exercise with no completed set does not put its body part on the card', () => {
    const r = completedToday(S(workout({ entries: [entry('sh1', [set(20, 10)]), entry('ch1', [set(40, 8, false)])] })), TODAY, idx)
    expect(r.bodyParts).toEqual(['shoulders'])
  })

  it('leaves out what is not there: no times, no weight, no records', () => {
    const r = completedToday(S(workout({ start: undefined, end: undefined, entries: [entry('sh1', [{ r: 10, done: true }])], prs: undefined })), TODAY, idx)
    expect(r.durMs).toBe(0)
    expect(r.volume).toBe(0)
    expect(r.prs).toBe(0)
    const card = doneCard(r, { lang: 'en' })
    expect(card.chips).toEqual(['1 set'])
  })

  it('ignores a duration that cannot be real (an end before the start, or days long)', () => {
    expect(completedToday(S(workout({ start: 5000, end: 1000 })), TODAY, idx).durMs).toBe(0)
    expect(completedToday(S(workout({ start: 0, end: 3 * 86400000 })), TODAY, idx).durMs).toBe(0)
  })

  it('takes a custom exercise\'s body part from its snapshot, and counts records', () => {
    const r = completedToday(S(workout({ prs: ['sh1', 'sh2'], entries: [{ id: 'mine', sets: [set(5, 5)], muscleSnapshot: { bp: 'back' } }] })), TODAY, idx)
    expect(r.bodyParts).toEqual(['back'])
    expect(r.prs).toBe(2)
  })
})

describe('doneCard', () => {
  const sum = { count: 1, names: ['Shoulder'], bodyParts: ['shoulders'], sets: 12, durMs: 45 * 60000, volume: 3250, prs: 1 }
  it('says it in Indonesian, with the figures that exist', () => {
    const c = doneCard(sum, { lang: 'id', unit: 'kg', label: bp => bp.toUpperCase() })
    expect(c.title).toBe('Latihan hari ini selesai!')
    expect(c.message).toBe('Hari ini kamu sudah melatih Shoulder. Kerja bagus! 💪')
    expect(c.parts).toEqual(['SHOULDERS'])
    expect(c.chips.join('|')).toMatch(/12 set/)
    expect(c.chips.join('|')).toMatch(/kg/)
    expect(c.prs).toBe(1)
  })
  it('several workouts: the count of sessions, and every name once', () => {
    const c = doneCard({ ...sum, count: 2, names: ['Shoulder', 'Chest'] }, { lang: 'en' })
    expect(c.message).toBe('Today you trained Shoulder + Chest. Great work! 💪')
    expect(c.chips[0]).toBe('2 sessions')
  })
  it('a workout with no name falls back to its body parts, then to a plain line', () => {
    expect(doneCard({ ...sum, names: [] }, { lang: 'en', label: () => 'Shoulders' }).message).toBe('Today you trained Shoulders. Great work! 💪')
    expect(doneCard({ ...sum, names: [], bodyParts: [] }, { lang: 'en' }).message).toBe('You trained today. Great work! 💪')
  })
  it('shows no duration under a minute, no volume without weight, and falls back to English', () => {
    const c = doneCard({ ...sum, durMs: 30000, volume: 0, prs: 0 }, { lang: 'xx' })
    expect(c.chips).toEqual(['12 sets'])
    expect(c.title).toBe('Workout complete today!')
  })
})
