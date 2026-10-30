import { describe, expect, it } from 'vitest'
import { approach, settled, locateTab, settleOn, PILL_TAU, BUBBLE_TAU } from './tab-slide.js'

describe('approach', () => {
  it('moves toward the target and never past it, however long the frame', () => {
    let x = 0
    for (let i = 0; i < 40; i++) {
      const next = approach(x, 100, 16, PILL_TAU)
      expect(next).toBeGreaterThan(x)
      expect(next).toBeLessThanOrEqual(100)
      x = next
    }
    expect(approach(0, 100, 100000, PILL_TAU)).toBeCloseTo(100, 5)
  })
  it('is quickest at the start and slows as it arrives: no jump, no stop', () => {
    const a = approach(0, 100, 16, PILL_TAU)
    const b = approach(a, 100, 16, PILL_TAU)
    expect(a).toBeGreaterThan(b - a)                                  // the first step covers more than the second
    expect(b - a).toBeGreaterThan(0)
  })
  it('takes the same time at any frame rate: 60 frames a second and 120 meet after the same 200 ms', () => {
    let a = 0, b = 0
    for (let i = 0; i < 12; i++) a = approach(a, 100, 1000 / 60, PILL_TAU)
    for (let i = 0; i < 24; i++) b = approach(b, 100, 1000 / 120, PILL_TAU)
    expect(a).toBeCloseTo(b, 5)
  })
  it('the bubble catches the finger faster than the pill catches its tab', () => {
    expect(BUBBLE_TAU).toBeLessThan(PILL_TAU)
    expect(approach(0, 100, 50, BUBBLE_TAU)).toBeGreaterThan(approach(0, 100, 50, PILL_TAU))
  })
  it('settles in about a third of a second', () => {
    let x = 0
    for (let i = 0; i < 20; i++) x = approach(x, 100, 16, PILL_TAU)  // ≈ 320 ms
    expect(100 - x).toBeLessThan(3)
  })
  it('with no time constant (reduced motion) it is there at once, and a stalled frame does not go backwards', () => {
    expect(approach(0, 100, 16, 0)).toBe(100)
    expect(approach(40, 100, -50, PILL_TAU)).toBe(40)
  })
})

describe('settled', () => {
  it('is within a quarter of a pixel', () => {
    expect(settled(10, 10.2)).toBe(true)
    expect(settled(10, 10.5)).toBe(false)
  })
})

describe('locateTab', () => {
  // four equal tabs of 75 in a bar 308 wide, 1 px border
  const bar = { left: 10, width: 308 }
  const boxes = [0, 1, 2, 3].map(i => ({ left: 15 + i * 75, right: 15 + i * 75 + 75, width: 75 }))
  it('finds the tab under the finger, and the nearest when the finger is off the bar', () => {
    expect(locateTab(boxes, 40, bar, 1).idx).toBe(0)
    expect(locateTab(boxes, 130, bar, 1).idx).toBe(1)
    expect(locateTab(boxes, 280, bar, 1).idx).toBe(3)
    expect(locateTab(boxes, -500, bar, 1).idx).toBe(0)
    expect(locateTab(boxes, 5000, bar, 1).idx).toBe(3)
  })
  it('makes the bubble the width of the tab plus a little, the same for every tab', () => {
    const widths = [40, 130, 200, 280].map(x => locateTab(boxes, x, bar, 1).w)
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBeGreaterThan(75)
    expect(widths[0]).toBeLessThan(90)
  })
  it('centres it on the finger, and keeps it inside the bar', () => {
    const mid = locateTab(boxes, 150, bar, 1)
    expect(mid.x).toBeCloseTo(150 - 10 - 1 - mid.w / 2, 5)
    expect(locateTab(boxes, -50, bar, 1).x).toBe(2)
    const end = locateTab(boxes, 900, bar, 1)
    expect(end.x).toBe(308 - 2 - end.w - 2)
  })
  it('has nothing to say about a bar with no tabs', () => {
    expect(locateTab([], 10, bar)).toBeNull()
  })
})

describe('settleOn', () => {
  it('puts the bubble over the middle of a tab', () => {
    const bar = { left: 0, width: 300 }
    const boxes = [0, 1, 2, 3].map(i => ({ left: i * 75, right: i * 75 + 75, width: 75 }))
    const s = settleOn(boxes, 2, bar)
    expect(s.idx).toBe(2)
    expect(s.x + s.w / 2).toBeCloseTo(187.5, 5)
    expect(settleOn(boxes, 9, bar)).toBeNull()
  })
})
