// @vitest-environment happy-dom
// Create your own workout: name it, add exercises, pick days, save. And Train's entry points to it.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setLang } from '../lib/i18n.js'
import { EXDB } from '../lib/exercises-data.js'
import CreateWorkout, { addCustomWorkout } from './CreateWorkout.jsx'
import Train from './Train.jsx'
import { loadDraft } from '../lib/workout-draft.js'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/train/new' }) }))
const sheets = vi.hoisted(() => ({ picker: null, startFlow: vi.fn(), config: vi.fn() }))
vi.mock('../sheets.jsx', async importOriginal => ({
  ...await importOriginal(),
  exercisePicker: onPick => { sheets.picker = onPick },
  exConfigSheet: (...a) => sheets.config(...a),
  startFlow: (...a) => sheets.startFlow(...a),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const A = EXDB[0].id, B = EXDB[1].id
let host, root
const text = () => host.textContent
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label)
const click = async el => { expect(el).toBeTruthy(); await act(async () => { el.click() }) }
const type = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const S = () => useStore.getState().S
const mount = async el => { await act(async () => { root.render(el) }) }

beforeEach(async () => {
  localStorage.clear()
  nav.mockClear(); sheets.startFlow.mockClear(); sheets.config.mockClear(); sheets.picker = null
  await setLang('en')
  const st = JSON.parse(JSON.stringify(DEF))
  st.routines = []; st.week = {}
  useStore.setState({ S: st, user: null })
  useUI.setState({ toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('addCustomWorkout', () => {
  const base = () => ({ routines: [{ id: 'p', name: 'Push', ex: [] }], week: { 1: ['p'] } })
  it('adds the routine and puts it on the chosen days, after what is already there', () => {
    const s = base(); const ex = [{ id: A, sets: 3, reps: 10 }]
    const r = addCustomWorkout(s, { name: '  Arm day  ', ex, days: [1, 3] }, 'mine')
    expect(r).toMatchObject({ id: 'mine', name: 'Arm day' })
    expect(s.routines.map(x => x.id)).toEqual(['p', 'mine'])
    expect(s.week).toEqual({ 1: ['p', 'mine'], 3: ['mine'] })
    ex[0].sets = 99
    expect(s.routines[1].ex[0].sets).toBe(3)            // a copy, not the draft's own objects
  })
  it('without days it is only added to the routines, and a day never lists it twice', () => {
    const s = base()
    addCustomWorkout(s, { name: 'X', ex: [], days: [] }, 'x')
    expect(s.week).toEqual({ 1: ['p'] })
    s.week[2] = ['x']
    addCustomWorkout(s, { name: 'X2', ex: [], days: [2] }, 'x')
    expect(s.week[2]).toEqual(['x'])
  })
  it('keeps the name within its limit', () => {
    expect(addCustomWorkout(base(), { name: 'n'.repeat(80), ex: [], days: [] }).name).toHaveLength(40)
  })
})

describe('the Create your own workout screen', () => {
  it('cannot be saved until it has a name and an exercise, and says why', async () => {
    await mount(<CreateWorkout />)
    expect(btn('Save workout').disabled).toBe(true)
    expect(text()).toMatch(/Add a name and at least one exercise/)
    await type(host.querySelector('#cw-name'), 'Arm day')
    expect(btn('Save workout').disabled).toBe(true)
    await click(btn('Add exercise'))
    await act(async () => { sheets.picker({ id: A }, true) })
    expect(btn('Save workout').disabled).toBe(false)
    expect(text()).not.toMatch(/Add a name and at least one exercise/)
  })

  it('builds a workout with several exercises, reorders and removes, then saves it on chosen days', async () => {
    await mount(<CreateWorkout />)
    await type(host.querySelector('#cw-name'), 'Arm day')
    await click(btn('Add exercise'))
    await act(async () => { sheets.picker({ id: A }, true) })
    await act(async () => { sheets.picker({ id: B }, true) })
    expect(host.querySelectorAll('.cw-ex')).toHaveLength(2)
    await click(host.querySelectorAll('.cw-ex')[1].querySelector('[aria-label="Move up"]'))
    await click(host.querySelectorAll('.cw-ex')[1].querySelector('[aria-label^="Remove"]'))   // [B, A] → [B]
    expect(host.querySelectorAll('.cw-ex')).toHaveLength(1)
    await act(async () => { sheets.picker({ id: A }, true) })
    // Monday and Wednesday (the week starts on Monday by default)
    const days = [...host.querySelectorAll('.cw-day')]
    expect(days).toHaveLength(7)
    await click(days.find(d => d.getAttribute('aria-label') === 'Monday'))
    await click(days.find(d => d.getAttribute('aria-label') === 'Wednesday'))
    expect(host.querySelectorAll('.cw-day.on')).toHaveLength(2)
    await click(btn('Save workout'))

    const r = S().routines[0]
    expect(r.name).toBe('Arm day')
    expect(r.ex.map(e => e.id)).toEqual([B, A])
    expect(S().week[1]).toEqual([r.id]); expect(S().week[3]).toEqual([r.id])
    expect(nav).toHaveBeenCalledWith('/train', { replace: true })
    expect(sheets.startFlow).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('“Arm day” saved')
  })

  it('warns when a chosen day already has a workout', async () => {
    useStore.setState({ S: { ...S(), routines: [{ id: 'p', name: 'Push', ex: [] }], week: { 1: ['p'] } } })
    await mount(<CreateWorkout />)
    await click([...host.querySelectorAll('.cw-day')].find(d => d.getAttribute('aria-label') === 'Monday'))
    expect(text()).toMatch(/Already planned: Monday \(Push\)/)
  })

  it('Save and start saves, then starts that workout', async () => {
    await mount(<CreateWorkout />)
    await type(host.querySelector('#cw-name'), 'Quick')
    await click(btn('Add exercise')); await act(async () => { sheets.picker({ id: A }, true) })
    await click(btn('Save and start'))
    expect(sheets.startFlow).toHaveBeenCalledWith([S().routines[0].id])
  })

  it('does not start a second session while one is running', async () => {
    useStore.setState({ S: { ...S(), active: { id: 'a', entries: [], cur: 0, start: Date.now() } } })
    await mount(<CreateWorkout />)
    await type(host.querySelector('#cw-name'), 'Quick')
    await click(btn('Add exercise')); await act(async () => { sheets.picker({ id: A }, true) })
    expect(btn('Save and start').disabled).toBe(true)
    expect(btn('Save workout').disabled).toBe(false)
  })

  it('in a looping plan the weekday step is replaced by an explanation, and no day is written', async () => {
    useStore.setState({ S: { ...S(), scheduleMode: 'rotation' } })
    await mount(<CreateWorkout />)
    expect(host.querySelectorAll('.cw-day')).toHaveLength(0)
    expect(text()).toMatch(/runs as a loop/)
    await type(host.querySelector('#cw-name'), 'Loopy')
    await click(btn('Add exercise')); await act(async () => { sheets.picker({ id: A }, true) })
    await click(btn('Save workout'))
    expect(S().routines).toHaveLength(1)
    expect(S().week).toEqual({})
  })

  it('is in Indonesian when the language is, with the chosen exercises untouched', async () => {
    await setLang('id')
    await mount(<CreateWorkout key="id" />)
    expect(text()).toContain('Buat latihanmu sendiri')
    expect(btn('Simpan latihan')).toBeTruthy()
    expect(host.querySelectorAll('.cw-day')).toHaveLength(7)
    expect([...host.querySelectorAll('.cw-day')].map(d => d.getAttribute('aria-label'))).toContain('Senin')
  })
})


describe('an unfinished workout survives the app being left', () => {
  // The phone drops the page while another app is in front: the screen is unmounted and rebuilt from
  // nothing but what is in storage.
  const reopen = async () => {
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await mount(<CreateWorkout key={Math.random()} />)
  }
  const fill = async () => {
    await type(host.querySelector('#cw-name'), 'Arm day')
    await click(btn('Add exercise')); await act(async () => { sheets.picker({ id: A }, true) }); await act(async () => { sheets.picker({ id: B }, true) })
    await click([...host.querySelectorAll('.cw-day')].find(d => d.getAttribute('aria-label') === 'Wednesday'))
  }

  it('brings back the name, the exercises in order, and the chosen days', async () => {
    await mount(<CreateWorkout />)
    await fill()
    await click(host.querySelectorAll('.cw-ex')[1].querySelector('[aria-label="Move up"]'))
    await reopen()
    expect(host.querySelector('#cw-name').value).toBe('Arm day')
    expect([...host.querySelectorAll('.cw-ex-t')]).toHaveLength(2)
    expect(host.querySelectorAll('.cw-day.on')).toHaveLength(1)
    expect(host.querySelector('.cw-day.on').getAttribute('aria-label')).toBe('Wednesday')
    expect(text()).toMatch(/Draft saved on this device/)
    expect(btn('Save workout').disabled).toBe(false)
    expect(S().routines).toHaveLength(0)                      // nothing was saved by leaving
  })

  it('every change is written as it happens, with no save step', async () => {
    await mount(<CreateWorkout />)
    expect(loadDraft().name).toBe('')
    await type(host.querySelector('#cw-name'), 'Leg')
    expect(loadDraft().name).toBe('Leg')
    await click(btn('Add exercise')); await act(async () => { sheets.picker({ id: A }, true) })
    expect(loadDraft().ex.map(e => e.id)).toEqual([A])
  })

  it('saving the workout clears the draft, so the next one starts empty', async () => {
    await mount(<CreateWorkout />)
    await fill()
    await click(btn('Save workout'))
    expect(S().routines).toHaveLength(1)
    expect(loadDraft()).toEqual({ name: '', ex: [], days: [] })
    await reopen()
    expect(host.querySelector('#cw-name').value).toBe('')
    expect(text()).not.toMatch(/Draft saved on this device/)
  })

  it('Start over empties the screen and the stored draft', async () => {
    await mount(<CreateWorkout />)
    await fill()
    await click(btn('Start over'))
    expect(host.querySelector('#cw-name').value).toBe('')
    expect(host.querySelectorAll('.cw-ex')).toHaveLength(0)
    expect(loadDraft()).toEqual({ name: '', ex: [], days: [] })
    await reopen()
    expect(host.querySelector('#cw-name').value).toBe('')
  })

  it('leaving with the back arrow keeps the draft, and Train offers to continue it', async () => {
    await mount(<CreateWorkout />)
    await fill()
    await click(btn('Back'))
    await reopen()
    expect(host.querySelector('#cw-name').value).toBe('Arm day')
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await mount(<Train />)
    expect(text()).toContain('Continue your draft')
    expect(text()).toMatch(/Arm day · 2 exercises/)
    expect(text()).not.toContain('Build a workout from any exercise')
  })

  it('a workout with no name shows as unnamed on Train, and Train is normal without a draft', async () => {
    await mount(<CreateWorkout />)
    await click(btn('Add exercise')); await act(async () => { sheets.picker({ id: A }, true) })
    act(() => root.unmount()); host.remove()
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
    await mount(<Train />)
    expect(text()).toMatch(/Unnamed workout · 1 exercise/)
    localStorage.clear()
    await mount(<Train key="n" />)
    expect(text()).toContain('Create your own workout')
  })

  it('the draft text is shown in Indonesian when the language is', async () => {
    await mount(<CreateWorkout />)
    await type(host.querySelector('#cw-name'), 'Lengan')
    await setLang('id')
    await mount(<CreateWorkout key="id" />)
    expect(text()).toContain('Draf tersimpan di perangkat ini')
    expect(btn('Mulai dari awal')).toBeTruthy()
  })
})

describe('Train', () => {
  it('has a clear way to create your own workout, and lists your workouts with their days', async () => {
    useStore.setState({ S: { ...S(), routines: [{ id: 'p', name: 'Push Day', ex: [{ id: A }, { id: B }] }], week: { 1: ['p'], 4: ['p'] } } })
    await mount(<Train />)
    expect(text()).toContain('Create your own workout')
    expect(text()).toContain('Your workouts')
    expect(text()).toContain('Push Day')
    expect(text()).toContain('2 exercises')
    expect([...host.querySelectorAll('.train-routine .train-day')].map(d => d.textContent)).toEqual(['Mo', 'Th'])
    expect(host.querySelector('.train-days').getAttribute('aria-label')).toBe('Monday, Thursday')
    await click(host.querySelector('.train-create'))
    expect(nav).toHaveBeenCalledWith('/train/new')
    await click(btn('Edit: Push Day'))
    expect(nav).toHaveBeenCalledWith('/plan/r/p')
    await click(host.querySelector('.train-routine .train-start'))
    expect(sheets.startFlow).toHaveBeenCalledWith(['p'])
  })

  it('shows the create card even before there is any workout', async () => {
    await mount(<Train />)
    expect(text()).toContain('Create your own workout')
    expect(text()).not.toContain('Your workouts')
  })
})
