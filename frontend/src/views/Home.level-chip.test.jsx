// @vitest-environment happy-dom
// The level on Home: no card for it, only a small number beside the name that opens Progress.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { setLang } from '../lib/i18n.js'
import { calculateLevel } from '../lib/xp.js'
import Home from './Home.jsx'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(), calendarSheet: vi.fn(),
  startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(), workoutDetailSheet: vi.fn(),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const mount = (xp, user = { id: 1, name: 'Jay' }) => {
  useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), xp }, user })
  act(() => root.render(<Home />))
}
beforeEach(async () => { await setLang('en'); nav.mockClear(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the level on Home', () => {
  it('is no longer a card', () => {
    mount(575)
    expect(host.querySelector('.game-card')).toBeNull()
    expect(host.textContent).not.toMatch(/Progress to Level|total XP/)
  })
  it('is a small number beside the name, the level the XP says', () => {
    mount(575)
    const chip = host.querySelector('.hdr h1 .lvl-chip')
    expect(chip).not.toBeNull()
    expect(chip.textContent).toBe(String(calculateLevel(575)))
    expect(chip.getAttribute('aria-label')).toBe('Level ' + calculateLevel(575))
    expect(host.querySelector('.hdr h1').textContent).toContain('Hi Jay')
  })
  it('follows the XP: a first-time profile is level 1, more XP a higher one', () => {
    mount(0)
    expect(host.querySelector('.lvl-chip').textContent).toBe('1')
    mount(5000)
    expect(+host.querySelector('.lvl-chip').textContent).toBeGreaterThan(1)
  })
  it('a tap goes to Progress', () => {
    mount(575)
    act(() => host.querySelector('.lvl-chip').click())
    expect(nav).toHaveBeenCalledWith('/progress')
  })
  it('keeps the week\'s quests where they were', () => {
    mount(575)
    expect(host.textContent).toContain('This week')
  })
})
