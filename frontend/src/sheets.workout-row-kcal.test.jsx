// @vitest-environment happy-dom
// A workout in the history list says what it burned (an estimate: lib/calories.js), and says nothing where there is no figure.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEF, useStore } from './store/useStore.js'
import { setLang } from './lib/i18n.js'
import { WorkoutRow } from './sheets.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const w = over => ({
  id: 'w1', d: '2026-10-29', name: 'Shoulder', start: 1_000_000, end: 1_000_000 + 3600000, routineId: null, vol: 1000,
  entries: [{ id: '0025', sets: [{ w: 20, r: 10, done: true }, { w: 20, r: 10, done: true }] }], ...over,
})
const mount = (work, S = {}) => {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), bodyweight: [{ d: '2026-10-01', w: 80 }], ...S }, user: null })
  act(() => root.render(<WorkoutRow w={work} onClick={() => {}} />))
}
beforeEach(async () => { await setLang('en'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('a workout row', () => {
  it('shows the estimated calories after the volume', () => {
    mount(w())
    expect(host.querySelector('.ss').textContent).toMatch(/2 sets · .* · ≈ 360 kcal$/)
  })
  it('in Indonesian the unit is kkal', async () => {
    await setLang('id')
    mount(w())
    expect(host.querySelector('.ss').textContent).toContain('≈ 360 kkal')
  })
  it('has none for a workout with no completed set', () => {
    mount(w({ entries: [{ id: '0025', sets: [{ w: 20, r: 10, done: false }] }] }))
    expect(host.querySelector('.ss').textContent).not.toMatch(/kcal|kkal/)
  })
})
