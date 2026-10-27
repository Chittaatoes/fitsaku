// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, freshState, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { setLang } from '../lib/i18n.js'
import { ALL_EQUIPMENT, activeProfile } from '../lib/equipment.js'
import WorkoutOnboarding from './WorkoutOnboarding.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/home' }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const S = () => useStore.getState().S
const text = () => host.textContent
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const chip = label => [...host.querySelectorAll('.wob-chips .chip')].find(b => b.textContent.trim() === label)
const click = el => { expect(el, String(el)).toBeTruthy(); act(() => { el.click() }) }
const mount = async () => { await act(async () => { root.render(<WorkoutOnboarding />) }) }

beforeEach(async () => {
  nav.mockClear(); localStorage.clear(); await setLang('en')
  useStore.setState({ S: freshState(), user: null })
  useUI.setState({ toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('step one: how do you train', () => {
  it('offers Home Workout and Gym with a plain description each, and a way to not decide', async () => {
    await mount()
    expect(text()).toContain('How do you want to train?')
    expect(text()).toContain('Home Workout'); expect(text()).toContain('Gym')
    expect(text()).toMatch(/No gear needed/); expect(text()).toMatch(/You see every exercise/)
    expect(btn('Not now')).toBeTruthy()
    expect(text()).toMatch(/change this any time in Settings/)
  })

  it('Gym finishes at once: the whole catalogue, no equipment question, and the user goes Home', async () => {
    await mount()
    click([...host.querySelectorAll('.wob-card')].find(c => c.textContent.includes('Gym')))
    expect(S().workoutMode).toBe('gym'); expect(S().equipFilterOn).toBe(false); expect(S().workoutOnboarded).toBe(true)
    expect(S().equipProfiles).toEqual([])
    expect(nav).toHaveBeenCalledWith('/home', { replace: true })
  })

  it('"Not now" leaves everything as it was and is not asked again', async () => {
    await mount()
    click(btn('Not now'))
    expect(S().workoutMode).toBeNull(); expect(S().equipFilterOn).toBe(false); expect(S().workoutOnboarded).toBe(true)
    expect(nav).toHaveBeenCalledWith('/home', { replace: true })
  })
})

describe('step two: the equipment at home', () => {
  const toEquipment = async () => { await mount(); click([...host.querySelectorAll('.wob-card')].find(c => c.textContent.includes('Home Workout'))) }

  it('asks in plain words, from the same list as Settings, with the usual things first and the rest behind More', async () => {
    await toEquipment()
    expect(text()).toContain('What equipment do you have at home?')
    expect(text()).toMatch(/body-weight moves are always included/)
    const first = [...host.querySelectorAll('.wob-chips .chip')].map(c => c.textContent.trim())
    expect(first.slice(0, 3)).toEqual(['dumbbell', 'kettlebell', 'band'])
    expect(first).not.toContain('leverage machine')
    click(btn('More equipment'))
    const all = [...host.querySelectorAll('.wob-chips .chip')].map(c => c.textContent.trim())
    expect(all.length).toBe(ALL_EQUIPMENT.length)
    for (const k of ALL_EQUIPMENT) expect(all).toContain(k)               // nothing the Settings list has is missing, nothing extra is invented
  })

  it('several can be picked at once, and unpicked again; Continue saves them as the Home profile', async () => {
    await toEquipment()
    click(chip('dumbbell')); click(chip('bench')); click(chip('kettlebell')); click(chip('bench'))
    expect(text()).toContain('2 selected')
    click(btn('Continue'))
    const p = activeProfile(S())
    expect(p.name).toBe('Home'); expect(p.equipment.sort()).toEqual(['dumbbell', 'kettlebell'])
    expect(S().workoutMode).toBe('home'); expect(S().equipFilterOn).toBe(true)
    expect(useUI.getState().toastMsg).toMatch(/Home Workout is on/)
    expect(nav).toHaveBeenCalledWith('/home', { replace: true })
  })

  it('with nothing picked the button says so, and it continues without equipment', async () => {
    await toEquipment()
    expect(text()).toMatch(/Nothing selected: you will see body-weight exercises/)
    click(btn('Continue without equipment'))
    expect(S().workoutMode).toBe('home'); expect(activeProfile(S()).equipment).toEqual([])
  })

  it('"Skip for now" still turns Home Workout on, with no equipment, even after something was picked', async () => {
    await toEquipment()
    click(chip('dumbbell'))
    click(btn('Skip for now'))
    expect(S().workoutMode).toBe('home'); expect(S().equipFilterOn).toBe(true)
    expect(activeProfile(S()).equipment).toEqual([])
    expect(S().workoutOnboarded).toBe(true)
  })

  it('Back returns to the first question without saving anything', async () => {
    await toEquipment()
    click(btn('Back'))
    expect(text()).toContain('How do you want to train?')
    expect(S().workoutOnboarded).toBe(false); expect(S().equipProfiles).toEqual([])
  })
})

describe('in Indonesian', () => {
  it('asks and explains in Indonesian', async () => {
    await setLang('id')
    await mount()
    expect(text()).toContain('Bagaimana kamu ingin berlatih?')
    expect(text()).toContain('Latihan di Rumah')
    click([...host.querySelectorAll('.wob-card')][0])
    expect(text()).toContain('Alat apa saja yang kamu punya di rumah?')
    expect(btn('Lanjut tanpa alat')).toBeTruthy(); expect(btn('Lewati untuk sekarang')).toBeTruthy()
  })
})
