// @vitest-environment happy-dom
// The tab bar can be slid, like iOS's: press and hold or drag, the pill lifts into a glass bubble that follows the finger, and letting
// go goes to the tab under it. A tap is still a tap.
import React, { act } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar, { HOLD_MS, SLIDE_PX } from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const nav = vi.fn()
let pathname = '/home'
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A bar 300 wide with four tabs of 75: no layout engine here, so the boxes are laid out by hand.
const BAR = { left: 0, right: 300, top: 0, bottom: 58, width: 300, height: 58 }
const box = i => ({ left: i * 75, right: i * 75 + 75, top: 4, bottom: 54, width: 75, height: 50 })

let host, root, spy
beforeEach(() => {
  vi.useFakeTimers()
  nav.mockClear()
  pathname = '/home'
  useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: { id: 1, name: 'test' } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.classList?.contains('pill-nav')) return BAR
    if (this.classList?.contains('pill-btn')) return box([...this.parentElement.querySelectorAll('.pill-btn')].indexOf(this))
    return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }
  })
  act(() => { root.render(<TabBar />) })
})
afterEach(() => { act(() => root.unmount()); host.remove(); spy.mockRestore(); vi.useRealTimers() })

const bar = () => host.querySelector('.pill-nav')
const btns = () => [...host.querySelectorAll('.pill-btn')]
const pill = () => host.querySelector('.pill-active')
const lifted = () => pill().classList.contains('lifted')
const ptr = (type, x, target = bar(), id = 1) => act(() => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: 30 }, pointerId: { value: id }, pointerType: { value: 'touch' }, button: { value: 0 } })
  target.dispatchEvent(e)
})
const hold = () => act(() => { vi.advanceTimersByTime(HOLD_MS + 10) })

describe('a tap', () => {
  it('is still a tap: the pill stays down, and the button\'s own click goes to its tab', () => {
    ptr('pointerdown', 110, btns()[1])
    ptr('pointerup', 110, btns()[1])
    expect(lifted()).toBe(false)
    act(() => btns()[1].click())
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/train')
  })
  it('a press that moves less than a few pixels is a tap too', () => {
    ptr('pointerdown', 110, btns()[1])
    ptr('pointermove', 110 + SLIDE_PX, btns()[1])
    expect(lifted()).toBe(false)
  })
})

describe('the pill', () => {
  it('is one element behind the tabs, and the lit tab wears the accent', () => {
    expect(host.querySelectorAll('.pill-active')).toHaveLength(1)
    expect(btns().map(b => b.classList.contains('active'))).toEqual([true, false, false, false])
  })
  it('goes to the lit tab when the route changes, as one element: the same one, never a new one on each tab', () => {
    const before = pill()
    pathname = '/progress'
    act(() => { root.render(<TabBar />) })
    expect(pill()).toBe(before)
    expect(btns().map(b => b.classList.contains('active'))).toEqual([false, false, true, false])
  })
})

describe('press and hold', () => {
  it('lifts the pill into a bubble over the tab under the finger after a moment, not before', () => {
    ptr('pointerdown', 110, btns()[1])
    act(() => { vi.advanceTimersByTime(HOLD_MS - 50) })
    expect(lifted()).toBe(false)
    hold()
    expect(lifted()).toBe(true)
    expect(pill().dataset.idx).toBe('1')
    expect(btns()[1].classList.contains('peek')).toBe(true)
    expect(bar().classList.contains('sliding')).toBe(true)
  })
  it('letting go without moving goes to the tab that was pressed, once, and the click after it is swallowed', () => {
    ptr('pointerdown', 110, btns()[1]); hold()
    ptr('pointerup', 110, btns()[1])
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/train')
    expect(lifted()).toBe(false)
    act(() => btns()[1].click())                                     // the click the browser sends after the release
    expect(nav).toHaveBeenCalledTimes(1)
  })
})

describe('sliding', () => {
  it('a drag lifts the bubble at once and it follows the finger from tab to tab', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 30 + SLIDE_PX + 2, btns()[0])
    expect(pill().dataset.idx).toBe('0')
    ptr('pointermove', 110, btns()[0]); expect(pill().dataset.idx).toBe('1')
    ptr('pointermove', 190, btns()[0]); expect(pill().dataset.idx).toBe('2')
    ptr('pointermove', 260, btns()[0]); expect(pill().dataset.idx).toBe('3')
    expect(btns().map(b => b.classList.contains('peek'))).toEqual([false, false, false, true])
  })
  it('the bubble is the same width over every tab (it never stretches), centred on the finger, and inside the bar at the ends', () => {
    ptr('pointerdown', 150, btns()[1])
    const widths = []
    for (const x of [40, 110, 190, 260]) { ptr('pointermove', x, btns()[1]); widths.push(parseFloat(pill().dataset.tw)) }
    expect(new Set(widths).size).toBe(1)
    const w = widths[0]
    expect(w).toBeGreaterThan(75)
    ptr('pointermove', 170, btns()[1])
    expect(parseFloat(pill().dataset.tx)).toBeCloseTo(170 - w / 2, 5)
    ptr('pointermove', -50, btns()[1])
    expect(parseFloat(pill().dataset.tx)).toBe(2)
    ptr('pointermove', 900, btns()[1])
    expect(parseFloat(pill().dataset.tx)).toBe(300 - w - 2)
  })
  it('the colour goes with the bubble: while it is over another tab the lit one gives its accent up', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 200, btns()[0])
    expect(bar().classList.contains('sliding')).toBe(true)
    expect(btns()[0].classList.contains('active')).toBe(true)        // still the page it is on…
    expect(btns()[0].classList.contains('peek')).toBe(false)         // …but not the one under the bubble
    expect(btns()[2].classList.contains('peek')).toBe(true)
    const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    expect(css).toMatch(/\.pill-nav\.sliding \.pill-btn\.active:not\(\.peek\)\{color:var\(--pill-ink\)\}/)
    expect(css).toMatch(/\.pill-btn\.peek\{color:var\(--acc\)\}/)
  })
  it('letting go over a tab goes to that tab, and not to the one the slide began on', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 100, btns()[0])
    ptr('pointermove', 260, btns()[0])
    ptr('pointerup', 260, btns()[0])
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/profile')
    expect(lifted()).toBe(false)
    act(() => btns()[0].click())                                     // a click on the tab it began on is not a tap
    expect(nav).toHaveBeenCalledTimes(1)
  })
  it('letting go past the end of the bar goes to the last tab', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 200, btns()[0])
    ptr('pointerup', 1000, btns()[0])
    expect(nav).toHaveBeenCalledWith('/profile')
  })
  it('a slide that is cancelled (the system took the touch) goes nowhere, and the pill comes back down', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 200, btns()[0])
    expect(lifted()).toBe(true)
    ptr('pointercancel', 200, btns()[0])
    expect(nav).not.toHaveBeenCalled()
    expect(lifted()).toBe(false)
  })
  it('a second finger or another pointer does not move the bubble', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 100, btns()[0])
    ptr('pointermove', 260, btns()[0], 2)
    expect(pill().dataset.idx).toBe('1')
  })
  it('the tap after a slide is a tap again: the swallowed click is only the one that follows the release', () => {
    ptr('pointerdown', 30, btns()[0]); ptr('pointermove', 100, btns()[0]); ptr('pointerup', 100, btns()[0])
    act(() => btns()[0].click())                                     // swallowed
    nav.mockClear()
    act(() => btns()[2].click())                                     // a later tap
    expect(nav).toHaveBeenCalledWith('/progress')
  })
})

describe('the bar while it is slid', () => {
  it('keeps the very same buttons and the very same pill: nothing is rebuilt', () => {
    const before = btns(), p = pill()
    ptr('pointerdown', 30, btns()[0]); ptr('pointermove', 200, btns()[0])
    expect(btns()).toHaveLength(4)
    btns().forEach((b, i) => expect(b).toBe(before[i]))
    expect(pill()).toBe(p)
  })
})

describe('the motion loop', () => {
  it('asks again for a frame that never came, instead of waiting on it for ever (a page that is not being drawn)', () => {
    const asked = []
    const realRaf = window.requestAnimationFrame, realCaf = window.cancelAnimationFrame
    window.requestAnimationFrame = () => { asked.push(1); return asked.length }       // frames that never run
    window.cancelAnimationFrame = () => {}
    try {
      act(() => { root.unmount() }); root = createRoot(host)
      act(() => { root.render(<TabBar />) })
      const first = asked.length
      expect(first).toBeGreaterThan(0)
      ptr('pointerdown', 30, btns()[0]); ptr('pointermove', 100, btns()[0])
      expect(asked.length).toBe(first)                                      // a frame is already on its way: not asked twice
      act(() => { vi.advanceTimersByTime(400) })
      ptr('pointermove', 160, btns()[0])
      expect(asked.length).toBeGreaterThan(first)                           // it was given up on, and asked for again
    } finally { window.requestAnimationFrame = realRaf; window.cancelAnimationFrame = realCaf }
  })
})

describe('the look', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
  it('has four equal tabs, each an icon over its name', () => {
    expect(css).toMatch(/#tabbar\.floating-pill \.pill-nav\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)
    expect(css).toMatch(/#tabbar \.pill-btn\{[^}]*flex-direction:column/)
  })
  it('owns the touch while a finger is on it, so the page does not scroll or select text under the slide', () => {
    expect(css).toMatch(/#tabbar\.floating-pill \.pill-nav\{[^}]*touch-action:none/)
    expect(css).toMatch(/#tabbar \.pill-active\{[^}]*pointer-events:none/)
  })
  it('lifts the pill by scaling it, above the icons, and eases the colour of the tabs over a third of a second', () => {
    expect(css).toMatch(/#tabbar \.pill-active\.lifted\{[^}]*z-index:2;scale:1\.16/)
    expect(css).toMatch(/#tabbar \.pill-btn\{[^}]*transition:color \.3s/)
  })
})
