// @vitest-environment happy-dom
// Quick Activities on Home: three fixed rows, each paid once per local day through the core XP ledger.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import QuickActivities from './QuickActivities.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { QUICK_ACTIVITIES, quickDone, quickKey } from '../lib/quick-activities.js'
import { awardQuickActivityXp, XP_AWARDS } from '../lib/gamification.js'
import { mergeXpLedger } from '../lib/xp.js'
import { todayISO } from '../lib/format.js'
import { actionSound } from '../lib/action-sound.js'

vi.mock('../lib/action-sound.js', () => ({ actionSound: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
const fresh = patch => useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), ...patch }, user: null })
const rows = () => [...host.querySelectorAll('.qa-row')]
const show = () => act(() => { root.render(<QuickActivities />) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date(2026, 9, 30, 10, 0, 0))
  actionSound.mockClear()
  fresh({ xp: 0, level: 1, xpAwarded: {} })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('the rule', () => {
  it('pays quickActivity once per activity per day, and moves the level with the total', () => {
    const s = { xp: 98, xpAwarded: {} }
    expect(awardQuickActivityXp(s, 'water', todayISO())).toBe(XP_AWARDS.quickActivity)
    expect(s.xpAwarded[quickKey(todayISO(), 'water')]).toBe(XP_AWARDS.quickActivity)
    expect(s.xp).toBe(98 + XP_AWARDS.quickActivity)
    expect(s.level).toBe(2)
    expect(awardQuickActivityXp(s, 'water', todayISO())).toBe(0)
    expect(s.xp).toBe(98 + XP_AWARDS.quickActivity)
  })
  it('refuses an unknown activity, a day that is not today, and a day that is not a string', () => {
    const s = { xp: 0, xpAwarded: {} }
    expect(awardQuickActivityXp(s, 'nap', todayISO())).toBe(0)
    expect(awardQuickActivityXp(s, 'water', '2026-10-29')).toBe(0)
    expect(awardQuickActivityXp(s, 'water', 20261030)).toBe(0)
    expect(s.xp).toBe(0)
    expect(s.xpAwarded).toEqual({})
  })
  it('done-state reads off the ledger, only for the day asked', () => {
    const S = { xpAwarded: { [quickKey('2026-10-30', 'breath')]: 5, [quickKey('2026-10-29', 'water')]: 5 } }
    expect([...quickDone(S, '2026-10-30')]).toEqual(['breath'])
    expect(quickDone({}, '2026-10-30').size).toBe(0)
  })
  it('two devices that ticked the same activity count it once after the ledgers merge', () => {
    const k = quickKey('2026-10-30', 'water')
    const merged = mergeXpLedger({ [k]: 5 }, { [k]: 5 })
    expect(Object.keys(merged)).toEqual([k])
  })
})

describe('the card', () => {
  it('shows exactly the three fixed activities, none done', () => {
    show()
    expect(QUICK_ACTIVITIES).toHaveLength(3)
    expect(rows()).toHaveLength(3)
    expect(rows().every(r => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(host.textContent).toContain('Drink Water')
    expect(host.textContent).toContain('Deep Breathing')
    expect(host.textContent).toContain('Body Stretch')
    expect(host.textContent).toContain('0 of 3 done today')
  })
  it('a tap checks the row, pays the XP through the store, thanks, floats +XP and plays one sound', () => {
    show()
    act(() => rows()[0].click())
    const S = useStore.getState().S
    expect(S.xp).toBe(XP_AWARDS.quickActivity)
    expect(S.xpAwarded[quickKey(todayISO(), 'water')]).toBe(XP_AWARDS.quickActivity)
    expect(rows()[0].getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('.qa-float').textContent).toBe('+' + XP_AWARDS.quickActivity + ' XP')
    expect(host.querySelector('.qa-praise').textContent.length).toBeGreaterThan(3)
    expect(actionSound).toHaveBeenCalledTimes(1)
    expect(actionSound).toHaveBeenCalledWith('check')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(host.textContent).toContain('1 of 3 done today')
  })
  it('a double tap is one reward, and a done row cannot be unticked or paid again', () => {
    show()
    act(() => { rows()[1].click(); rows()[1].click() })
    expect(useStore.getState().S.xp).toBe(XP_AWARDS.quickActivity)
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => rows()[1].click())
    expect(useStore.getState().S.xp).toBe(XP_AWARDS.quickActivity)
    expect(rows()[1].getAttribute('aria-checked')).toBe('true')
    expect(actionSound).toHaveBeenCalledTimes(1)
  })
  it('is still done after a reload (it lives in the ledger), and open again on the next local day', () => {
    fresh({ xp: 5, xpAwarded: { [quickKey(todayISO(), 'stretch')]: 5 } })
    show()
    expect(rows().map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true'])
    act(() => { vi.advanceTimersByTime(14 * 3600 * 1000 + 1000) })     // past local midnight
    expect(rows().map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
    act(() => rows()[2].click())
    expect(useStore.getState().S.xp).toBe(10)
  })
  it('a new level plays the level-up sound and says so', () => {
    fresh({ xp: 98, level: 1, xpAwarded: {} })
    show()
    act(() => rows()[0].click())
    expect(actionSound).toHaveBeenCalledWith('levelup')
    expect(useStore.getState().S.level).toBe(2)
    expect(host.querySelector('.qa-levelup').textContent).toContain('2')
  })
  it('under reduced motion there is no confetti, but the check and the words are still there', () => {
    window.matchMedia = q => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} })
    show()
    act(() => rows()[0].click())
    expect(host.querySelector('.qa-conf')).toBeNull()
    expect(rows()[0].getAttribute('aria-checked')).toBe('true')
    expect(host.querySelector('.qa-praise')).not.toBeNull()
    delete window.matchMedia
  })
  it('with confetti allowed, the burst appears on the ticked row only', () => {
    show()
    act(() => rows()[0].click())
    expect(host.querySelectorAll('.qa-conf')).toHaveLength(1)
    expect(rows()[0].querySelector('.qa-conf')).not.toBeNull()
  })
  it('the praise is never the same line twice in a row', () => {
    show()
    const seen = []
    for (let i = 0; i < 3; i++) { act(() => rows()[i].click()); seen.push(host.querySelector('.qa-praise').textContent); act(() => { vi.advanceTimersByTime(400) }) }
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[1]).not.toBe(seen[2])
  })
})

describe('level and XP are a notice, not a fixture', () => {
  it('nothing about level or XP is shown until something is earned, then it appears with the new numbers and goes away', () => {
    show()
    expect(host.querySelector('.qa-xp')).toBeNull()
    expect(host.textContent).not.toMatch(/Level|XP/)
    act(() => rows()[0].click())
    const n = host.querySelector('.qa-xp')
    expect(n.textContent).toContain('Level 1')
    expect(n.textContent).toContain('5 / 100 XP')
    act(() => { vi.advanceTimersByTime(3000) })
    expect(host.querySelector('.qa-xp')).toBeNull()
  })
  it('embedded in the hero it is not a card of its own', () => {
    act(() => { root.render(<QuickActivities embedded />) })
    expect(host.querySelector('.qa').classList.contains('card')).toBe(false)
    expect(host.querySelector('.qa').classList.contains('qa-in')).toBe(true)
  })
})
