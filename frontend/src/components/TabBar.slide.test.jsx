// @vitest-environment happy-dom
// The tab bar can be slid, like iOS's: press and hold or drag, a glass bubble follows the finger, and letting go goes to the tab
// under it. A tap is still a tap.
import React, { act } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TabBar, { HOLD_MS, SLIDE_PX } from './TabBar.jsx'
import { DEF, useStore } from '../store/useStore.js'

const nav = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => nav, useLocation: () => ({ pathname: '/home' }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A bar 300 wide with four tabs of 75: no layout engine here, so the boxes are laid out by hand.
const BAR = { left: 0, right: 300, top: 0, bottom: 58, width: 300, height: 58 }
const box = i => ({ left: i * 75, right: i * 75 + 75, top: 6, bottom: 52, width: 75, height: 46 })

let host, root, spy
beforeEach(() => {
  vi.useFakeTimers()
  nav.mockClear()
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
const bubble = () => host.querySelector('.pill-bubble')
const ptr = (type, x, target = bar(), id = 1) => act(() => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { clientX: { value: x }, clientY: { value: 30 }, pointerId: { value: id }, pointerType: { value: 'touch' }, button: { value: 0 } })
  target.dispatchEvent(e)
})
const hold = () => act(() => { vi.advanceTimersByTime(HOLD_MS + 10) })

describe('a tap', () => {
  it('is still a tap: no bubble, and the button\'s own click goes to its tab', () => {
    ptr('pointerdown', 110, btns()[1])
    ptr('pointerup', 110, btns()[1])
    expect(bubble()).toBeNull()
    act(() => btns()[1].click())
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/train')
  })
  it('a press that moves less than a few pixels is a tap too', () => {
    ptr('pointerdown', 110, btns()[1])
    ptr('pointermove', 110 + SLIDE_PX, btns()[1])
    expect(bubble()).toBeNull()
  })
})

describe('press and hold', () => {
  it('lifts the bubble over the tab under the finger after a moment, not before', () => {
    ptr('pointerdown', 110, btns()[1])
    act(() => { vi.advanceTimersByTime(HOLD_MS - 50) })
    expect(bubble()).toBeNull()
    hold()
    expect(bubble()).not.toBeNull()
    expect(bubble().dataset.idx).toBe('1')
    expect(btns()[1].classList.contains('peek')).toBe(true)
    expect(bar().classList.contains('sliding')).toBe(true)
  })
  it('letting go without moving goes to the tab that was pressed, once, and the click after it is swallowed', () => {
    ptr('pointerdown', 110, btns()[1]); hold()
    ptr('pointerup', 110, btns()[1])
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/train')
    expect(bubble()).toBeNull()
    act(() => btns()[1].click())                                     // the click the browser sends after the release
    expect(nav).toHaveBeenCalledTimes(1)
  })
})

describe('sliding', () => {
  it('a drag lifts the bubble at once and it follows the finger from tab to tab', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 30 + SLIDE_PX + 2, btns()[0])
    expect(bubble().dataset.idx).toBe('0')
    ptr('pointermove', 110, btns()[0])
    expect(bubble().dataset.idx).toBe('1')
    ptr('pointermove', 190, btns()[0])
    expect(bubble().dataset.idx).toBe('2')
    ptr('pointermove', 260, btns()[0])
    expect(bubble().dataset.idx).toBe('3')
    expect(btns().map(b => b.classList.contains('peek'))).toEqual([false, false, false, true])
  })
  it('the bubble is centred on the finger, and stays inside the bar at the ends', () => {
    ptr('pointerdown', 150, btns()[1])
    ptr('pointermove', 170, btns()[1])
    const w = parseFloat(bubble().style.width)
    expect(w).toBeGreaterThan(75)                                    // a little wider than the tab
    expect(bubble().style.transform).toBe(`translateX(${170 - w / 2}px)`)
    ptr('pointermove', -50, btns()[1])
    expect(bubble().style.transform).toBe('translateX(2px)')
    ptr('pointermove', 900, btns()[1])
    expect(bubble().style.transform).toBe(`translateX(${300 - w - 2}px)`)
  })
  it('letting go over a tab goes to that tab, and not to the one the slide began on', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 100, btns()[0])
    ptr('pointermove', 260, btns()[0])
    ptr('pointerup', 260, btns()[0])
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/profile')
    expect(bubble()).toBeNull()
    act(() => btns()[0].click())                                     // a click on the tab it began on is not a tap
    expect(nav).toHaveBeenCalledTimes(1)
  })
  it('letting go past the end of the bar goes to the last tab', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 200, btns()[0])
    ptr('pointerup', 1000, btns()[0])
    expect(nav).toHaveBeenCalledWith('/profile')
  })
  it('a slide that is cancelled (the system took the touch) goes nowhere', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 200, btns()[0])
    expect(bubble()).not.toBeNull()
    ptr('pointercancel', 200, btns()[0])
    expect(nav).not.toHaveBeenCalled()
    expect(bubble()).toBeNull()
  })
  it('a second finger or another pointer does not move the bubble', () => {
    ptr('pointerdown', 30, btns()[0])
    ptr('pointermove', 100, btns()[0])
    ptr('pointermove', 260, btns()[0], 2)
    expect(bubble().dataset.idx).toBe('1')
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
  it('keeps the very same buttons: only the bubble comes and goes', () => {
    const before = btns()
    ptr('pointerdown', 30, btns()[0]); ptr('pointermove', 200, btns()[0])
    expect(btns()).toHaveLength(4)
    btns().forEach((b, i) => expect(b).toBe(before[i]))
  })
  it('owns the touch while a finger is on it, so the page does not scroll or select text under the slide, and the bubble never takes a tap', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
    expect(css).toMatch(/#tabbar \.pill-nav\{[^}]*touch-action:none/)
    expect(css).toMatch(/#tabbar \.pill-bubble\{[^}]*pointer-events:none/)
  })
})
