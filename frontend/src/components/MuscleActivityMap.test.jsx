// @vitest-environment happy-dom
// The Muscle activity map on Progress: the right muscles coloured by the right amount, front and back,
// selecting a muscle (map or list) shows its real numbers, and it follows the workout data.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { setLang } from '../lib/i18n.js'
import MuscleActivityMap from './MuscleActivityMap.jsx'
import Progress from '../views/Stats.jsx'    // the one progress page: the statistics

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: '/progress' }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const DAY = 24 * 3600 * 1000
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0)
const BENCH = { chest: 1, triceps: 0.4, deltoids: 0.4 }
const entry = (id, weights, done) => ({ id, exercise: { muscleWeights: weights }, sets: Array.from({ length: done }, () => ({ w: 60, r: 8, done: true })) })
const session = (id, daysAgo, entries) => ({ id, d: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10), start: NOW - daysAgo * DAY, end: NOW - daysAgo * DAY + 3600e3, entries })

let host, root
const setWorkouts = workouts => act(() => useStore.setState({ S: { ...useStore.getState().S, workouts } }))
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 30)) }) }
const mount = async el => { await act(async () => { root.render(el) }); await flush() }
const muscle = name => [...host.querySelectorAll('path.bm-m')].filter(p => p.getAttribute('aria-label') === name)
const fillOf = name => muscle(name)[0]?.style.fill || ''
const alphaOf = name => { const m = /rgba\(255,\s*90,\s*31,\s*([\d.]+)\)/.exec(fillOf(name)); return m ? +m[1] : 0 }
const text = () => host.textContent
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
// SVG paths have no .click() in the DOM emulation, so the event is dispatched.
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

beforeEach(async () => {
  await setLang('en')
  const S = JSON.parse(JSON.stringify(DEF))
  S.workouts = [
    session('a', 2, [entry('bench', BENCH, 5)]),
    session('b', 20, [entry('bench', BENCH, 4)]),
  ]
  useStore.setState({ S, user: null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the colours', () => {
  it('colour the trained muscles in one red-orange hue, stronger for the main muscle than a supporting one, and leave the rest untouched', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    expect(alphaOf('Chest')).toBeGreaterThan(alphaOf('Triceps'))
    expect(alphaOf('Triceps')).toBeGreaterThan(0)
    expect(alphaOf('Shoulders')).toBeGreaterThan(0)
    for (const untouched of ['Calves', 'Quads', 'Glutes', 'Abs']) expect(fillOf(untouched)).toBe('')
    for (const m of ['Chest', 'Triceps', 'Shoulders']) expect(fillOf(m)).toMatch(/^rgba\(255, ?90, ?31, ?0\.\d+\)$/)
  })

  it('follow the data: a new workout strengthens it, deleting one weakens it, an empty history clears it', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    const before = alphaOf('Chest')
    setWorkouts([...useStore.getState().S.workouts, session('c', 0, [entry('bench', BENCH, 8)])])
    expect(alphaOf('Chest')).toBeGreaterThan(before)
    setWorkouts(useStore.getState().S.workouts.filter(w => w.id !== 'a' && w.id !== 'c'))
    expect(alphaOf('Chest')).toBeLessThan(before)
    setWorkouts([])
    expect(fillOf('Chest')).toBe('')
    expect(text()).toMatch(/Nothing logged yet/)
  })

  it('an old session shows fainter than the same session recent', async () => {
    setWorkouts([session('x', 1, [entry('bench', BENCH, 6)])])
    await mount(<MuscleActivityMap now={NOW} />)
    const recent = alphaOf('Chest')
    setWorkouts([session('x', 35, [entry('bench', BENCH, 6)])])
    expect(alphaOf('Chest')).toBeLessThan(recent)
    expect(alphaOf('Chest')).toBeGreaterThan(0)
  })
})

describe('front and back', () => {
  it('has a toggle that picks the side, and both sides carry the muscles that belong to them', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    const map = host.querySelector('.bodymap')
    expect(map.getAttribute('data-view')).toBe('front')
    expect(btn('Front view').getAttribute('aria-pressed')).toBe('true')
    await click(btn('Back view'))
    expect(map.getAttribute('data-view')).toBe('back')
    expect(btn('Back view').getAttribute('aria-pressed')).toBe('true')
    const svgs = host.querySelectorAll('svg.bm-v')
    expect(svgs).toHaveLength(2)
    const names = svg => new Set([...svg.querySelectorAll('path.bm-m')].map(p => p.getAttribute('aria-label')))
    expect(names(svgs[0]).has('Chest')).toBe(true)                  // the front view
    expect(names(svgs[1]).has('Chest')).toBe(false)
    expect(names(svgs[1]).has('Hamstrings')).toBe(true)             // the back view
    expect(names(svgs[0]).has('Hamstrings')).toBe(false)
  })
})

describe('selecting a muscle', () => {
  it('shows its real numbers: score, sets in 7 and 30 days, last trained, exercises, six weeks of trend', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    expect(text()).toMatch(/Tap a muscle to see its details/)
    await click(muscle('Chest')[0])
    const d = host.querySelector('.ama-d')
    expect(d.getAttribute('aria-label')).toBe('Chest')
    expect(d.textContent).toMatch(/Last 7 days5 sets/)
    expect(d.textContent).toMatch(/Last 30 days9 sets/)
    expect(d.textContent).toMatch(/2 days ago/)
    expect(d.querySelector('.ama-score strong').textContent).toMatch(/^\d+$/)
    expect(d.querySelectorAll('.ama-trend span')).toHaveLength(6)
    expect(d.querySelector('.ama-trend').getAttribute('aria-label')).toBe('0, 0, 0, 4, 0, 5')    // 20 days ago: week 2 back; 2 days ago: this week
    expect(d.querySelectorAll('.ama-ex li')).toHaveLength(1)
    expect(d.querySelectorAll('.ama-ex li')[0].textContent).toContain('9 sets')
    expect(text()).toMatch(/counts fully for a main muscle and 40%/)
  })

  it('says plainly when a muscle has no recorded activity, with no invented numbers', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    await click(muscle('Calves')[0])
    const d = host.querySelector('.ama-d')
    expect(d.textContent).toMatch(/No activity recorded for this muscle yet/)
    expect(d.querySelector('.ama-score')).toBeNull()
    expect(d.textContent).not.toMatch(/Last 7 days/)
  })

  it('offers exercises the app already has for the muscle, and tapping the muscle again closes it', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    await click(muscle('Calves')[0])
    expect(host.querySelectorAll('.ama-sug .chip').length).toBeGreaterThan(0)
    await click(muscle('Calves')[0])
    expect(host.querySelector('.ama-d')).toBeNull()
  })
})

describe('without relying on colour', () => {
  it('lists every muscle with its score and recency, strongest first, and selecting from the list works', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    expect(host.querySelector('.ama-list')).toBeNull()
    await click(btn('Show as list'))
    const rows = [...host.querySelectorAll('.ama-list button')]
    expect(rows.length).toBe(18)
    expect(rows[0].querySelector('.ama-ln').textContent).toBe('Chest')
    expect(rows[0].querySelector('.ama-ls').textContent).toBe('2 days ago')
    const scores = rows.map(r => +r.querySelector('.ama-lv').textContent)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(rows.at(-1).querySelector('.ama-ls').textContent).toBe('Not trained yet')
    await click(rows[0])
    expect(host.querySelector('.ama-d').getAttribute('aria-label')).toBe('Chest')
    await click(btn('Hide list'))
    expect(host.querySelector('.ama-list')).toBeNull()
  })

  it('every muscle region is a labelled, pressable control', async () => {
    await mount(<MuscleActivityMap now={NOW} />)
    const paths = [...host.querySelectorAll('path.bm-m')]
    expect(paths.length).toBeGreaterThan(18)
    for (const p of paths) { expect(p.getAttribute('role')).toBe('button'); expect(p.getAttribute('aria-label')).toBeTruthy(); expect(p.getAttribute('tabindex')).toBe('0') }
  })
})

describe('on Progress, in Indonesian', () => {
  it('appears on the Progress screen, and its words follow the language', async () => {
    await setLang('id')
    await mount(<Progress />)
    expect(host.querySelector('.ama')).toBeTruthy()
    expect(text()).toContain('Aktivitas otot')
    expect(btn('Tampak belakang')).toBeTruthy()
    await click(btn('Tampilkan sebagai daftar'))
    expect(text()).toContain('Belum dilatih')
  })
})
