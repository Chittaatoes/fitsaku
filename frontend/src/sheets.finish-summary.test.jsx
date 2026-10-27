// @vitest-environment happy-dom
// The card after Finish: what it shows, in what order, and that the way out is always in reach.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { setLang } from './lib/i18n.js'
import { finishWorkoutNow } from './sheets.jsx'
import { EXDB } from './lib/exercises-data.js'

const nav = vi.fn()
vi.mock('./lib/nav.js', async importOriginal => ({ ...await importOriginal(), nav: (...a) => nav(...a) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const clone = v => JSON.parse(JSON.stringify(v))
const mounted = []
let host

/** An active workout of `n` exercises, three done sets each (plus a ticked warm-up on the first). */
function install(n, { warmup = false } = {}) {
  const st = clone(DEF)
  st.active = {
    id: 'fin-1', d: '2026-10-27', start: Date.now() - 45 * 60000, routineId: null, name: 'Push Day', bw: null, cur: 0,
    entries: EXDB.slice(0, n).map((e, i) => ({
      id: e.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 0 },
      sets: [...(warmup && i === 0 ? [{ w: 10, r: 10, done: true, warmup: true }] : []), ...[0, 1, 2].map(() => ({ w: 40, r: 10, done: true }))],
    })),
  }
  useStore.setState({ S: st, user: null })
}
function open() {
  act(() => finishWorkoutNow())
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const text = () => host.textContent
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)

beforeEach(async () => { localStorage.clear(); nav.mockClear(); await setLang('en'); useUI.setState({ sheets: [] }) })
afterEach(() => { act(() => mounted.splice(0).forEach(r => r.unmount())); document.body.innerHTML = '' })

describe('the workout summary', () => {
  it('opens with what it was and what it earned', () => {
    install(2); open()
    expect(host.querySelector('.fin-hero h3').textContent).toBe('Workout complete!')
    expect(host.querySelector('.fin-hero').textContent).toContain('Push Day')
    const xp = host.querySelector('.fin-xp')
    expect(xp.textContent).toMatch(/^\+(50|75) XP/)
    expect(xp.textContent).toContain('Level 1')
    expect(xp.getAttribute('role')).toBe('status')
  })

  it('shows the four numbers as plain tiles: duration, volume, sets, PRs', () => {
    install(2); open()
    const tiles = [...host.querySelectorAll('.fin-stat')]
    expect(tiles.map(x => x.querySelector('.l').textContent)).toEqual(['Duration', 'Volume', 'Sets', 'PRs'])
    expect(tiles[2].querySelector('.v').textContent).toBe('6')
    expect(tiles[2].querySelector('.s')).toBeNull()                     // no warm-ups: nothing to explain
  })

  it('explains the set count only when warm-ups make it differ', () => {
    install(2, { warmup: true }); open()
    const sets = [...host.querySelectorAll('.fin-stat')][2]
    expect(sets.querySelector('.v').textContent).toBe('7')
    expect(sets.querySelector('.s').textContent).toBe('7 sets · 6 work')
  })

  it('names the muscles trained as chips above the body map', () => {
    install(2); open()
    expect(host.querySelectorAll('.fin-muscles .chip').length).toBeGreaterThan(0)
    expect(host.querySelector('.fin-map')).toBeTruthy()
  })

  it('shows the last-time list three exercises at a time, with Show all and Show less', () => {
    install(5); open()
    const rows = () => host.querySelectorAll('.list .item').length
    expect(rows()).toBe(3)
    act(() => btn('Show all (5)').click())
    expect(rows()).toBe(5)
    expect(btn('Show all (5)')).toBeUndefined()
    act(() => btn('Show less').click())
    expect(rows()).toBe(3)
  })

  it('does not offer Show all when everything already fits', () => {
    install(2); open()
    expect(host.querySelector('.fin-more')).toBeNull()
  })

  it('keeps Done in a footer after the content, so it is never lost at the bottom of a long list', () => {
    install(5); open()
    const foot = host.querySelector('.fin-foot')
    expect(foot).toBeTruthy()
    expect(foot.textContent).toBe('Done')
    const body = host.querySelector('.fin-body')
    expect(body.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    act(() => foot.querySelector('button').click())
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('reads in Indonesian', async () => {
    await setLang('id')
    install(5); open()
    expect(text()).toContain('Latihan selesai!')
    expect(btn('Tampilkan semua (5)')).toBeTruthy()
    expect(host.querySelector('.fin-foot').textContent).toBe('Selesai')
  })
})
