// @vitest-environment happy-dom
// The Library under Home Workout: one filter, the same one every list uses, with a count that says the
// list is matched to the equipment and a way to change the equipment or see everything.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Library from './Library.jsx'
import { DEF } from '../store/useStore.js'
import { EXDB } from '../lib/exercises-data.js'
import { applyWorkoutPrefs } from '../lib/workout-prefs.js'
import { exAvailable } from '../lib/equipment.js'
import { setLang } from '../lib/i18n.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const nav = vi.fn()
const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', async importOriginal => {
  const real = await importOriginal()
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { ...real, useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({ exerciseDetailSheet: vi.fn(), addToRoutineSheet: vi.fn(), customExSheet: vi.fn() }))

let host, root
const mount = () => act(() => root.render(<Library />))
const banner = () => host.querySelector('.small.dim.row')
const setState = mut => { const s = structuredClone(DEF); mut(s); mocks.S = s; mocks.snapshot().S }

beforeEach(async () => {
  nav.mockClear(); await setLang('en')
  const S = structuredClone(DEF)
  applyWorkoutPrefs(S, { mode: 'home', equipment: ['dumbbell'] })
  mocks.S = S
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Library under Home Workout', () => {
  it('says the list is matched to the equipment, with how many match', () => {
    mount()
    const b = banner()
    expect(b.textContent).toContain('Showing what you have in "Home"')
    const matching = EXDB.filter(e => exAvailable(mocks.S, e)).length
    expect(b.textContent.replace(/[\s,. ]/g, '')).toContain(`${matching}of${EXDB.length}exercisesmatch`)
    expect(matching).toBeLessThan(EXDB.length)
  })

  it('offers a shortcut to the equipment, and one to see everything and back', () => {
    mount()
    act(() => [...banner().querySelectorAll('button')].find(x => x.textContent === 'Change equipment').click())
    expect(nav).toHaveBeenCalledWith('/settings/equipment')
    act(() => [...banner().querySelectorAll('button')].find(x => x.textContent === 'Show all equipment').click())
    expect(banner().textContent).toContain('Showing all equipment')
    expect(banner().textContent).not.toMatch(/exercises match/)
    act(() => [...banner().querySelectorAll('button')].find(x => /Filter by/.test(x.textContent)).click())
    expect(banner().textContent).toContain('Showing what you have')
  })

  it('shows no matching banner at all for the Gym or with the filter off', () => {
    const S = structuredClone(DEF); applyWorkoutPrefs(S, { mode: 'gym' }); mocks.S = S
    mount()
    expect(banner()).toBeNull()
  })

  it('turning the equipment filter off in Settings (state only) gives back the whole catalogue', () => {
    mocks.S = { ...mocks.S, equipFilterOn: false }
    mount()
    expect(banner()).toBeNull()
    expect(mocks.S.workoutMode).toBe('home')                  // the mode stays
    expect(mocks.S.equipProfiles[0].equipment).toEqual(['dumbbell'])
  })

  it('reads in Indonesian', async () => {
    await setLang('id')
    mount()
    expect(banner().textContent).toMatch(/latihan cocok/)
    expect([...banner().querySelectorAll('button')].some(x => x.textContent === 'Ubah peralatan')).toBe(true)
  })
})
