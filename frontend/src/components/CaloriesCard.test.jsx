// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { setLang } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'

const sheets = vi.hoisted(() => ({ workoutDetailSheet: vi.fn() }))
vi.mock('../sheets.jsx', () => sheets)
import CaloriesCard from './CaloriesCard.jsx'

let host, root
const iso = back => { const d = new Date(); d.setDate(d.getDate() - back); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const hour = 3600000
const w = (back, name, mins = 60, over = {}) => ({
  id: name + back, d: iso(back), name, start: Date.now() - back * 86400000 - hour, end: Date.now() - back * 86400000 - hour + mins * 60000,
  entries: [{ id: '0025', sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }] }], ...over,
})
const setS = over => act(() => useStore.setState(s => ({ S: { ...s.S, bodyweight: [{ d: '2026-01-01', w: 80 }], unit: 'kg', workouts: [], ...over } })))
const mount = () => act(() => root.render(<CaloriesCard />))

beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await setLang('en')
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)) })
  sheets.workoutDetailSheet.mockClear()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the calories card', () => {
  it('with no workout today says so, and shows no figure for the day', () => {
    setS(); mount()
    expect(host.textContent).toContain('No workout yet today.')
    expect(host.querySelector('.cal-v').textContent).toContain('–')
    expect(host.querySelectorAll('.cal-row')).toHaveLength(0)
  })

  it('today\'s workouts each with their estimate, and the day\'s total on top', () => {
    setS({ workouts: [w(0, 'Shoulder', 60), w(0, 'Chest', 30)] }); mount()
    const rows = [...host.querySelectorAll('.cal-row')]
    expect(rows.map(r => r.querySelector('.cal-n').textContent)).toEqual(['Shoulder', 'Chest'])
    expect(rows[0].textContent).toContain('360 kcal')                  // 4.5 x 80 kg x 1 h
    expect(rows[1].textContent).toContain('180 kcal')
    expect(rows[0].querySelector('.cal-m').textContent).toBe('60 min')
    expect(host.querySelector('.cal-v').textContent).toBe('540kcal')
  })

  it('the last 7 and 30 days', () => {
    setS({ workouts: [w(0, 'A', 60), w(3, 'B', 60), w(10, 'C', 60), w(40, 'D', 60)] }); mount()
    const sums = [...host.querySelectorAll('.cal-sum b')].map(b => b.textContent.replace(/\s+/g, ' ').trim())
    expect(sums).toEqual(['720 kcal', '1,080 kcal'])
  })

  it('a workout row opens the workout', () => {
    const work = w(0, 'Shoulder')
    setS({ workouts: [work] }); mount()
    act(() => host.querySelector('.cal-row').click())
    expect(sheets.workoutDetailSheet).toHaveBeenCalledWith(expect.objectContaining({ id: work.id }))
  })

  it('says it is an estimate, and when the weight or the time behind a figure is a guess', () => {
    setS({ workouts: [w(0, 'Shoulder', 60, { start: undefined, end: undefined })], bodyweight: [] }); mount()
    expect(host.textContent).toContain('An estimate from how long you trained')
    expect(host.textContent).toContain('Counted at 70 kg')
    expect(host.textContent).toContain('no start and end time')
  })

  it('does not apologise when the figures rest on real time and a logged weight', () => {
    setS({ workouts: [w(0, 'Shoulder')] }); mount()
    expect(host.textContent).not.toContain('Counted at 70 kg')
    expect(host.textContent).not.toContain('no start and end time')
  })

  it('speaks Indonesian, with kkal', async () => {
    await setLang('id')
    setS({ workouts: [w(0, 'Shoulder')] }); mount()
    expect(host.textContent).toContain('Kalori terbakar')
    expect(host.textContent).toContain('kkal')
    expect(host.textContent).toContain('Perkiraan dari lama latihan')
  })
})
