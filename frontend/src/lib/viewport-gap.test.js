// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { applyViewportGap, measureGap } from './viewport-gap.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const fakeWin = (o = {}) => ({
  navigator: { userAgent: IPHONE, maxTouchPoints: 5, standalone: true, ...(o.navigator || {}) },
  innerWidth: 393, innerHeight: 793, screen: { width: 393, height: 852 },
  matchMedia: () => ({ matches: false }),
  document: { documentElement: { style: { _v: {}, getPropertyValue(k) { return this._v[k] || '' }, setProperty(k, v) { this._v[k] = v } } } },
  ...o,
})

describe('the gap under the layout viewport in the iOS home-screen app', () => {
  it('is the screen height minus innerHeight', () => {
    expect(measureGap(fakeWin())).toBe(59)
  })
  it('is zero where nothing is missing, or where it cannot be the status-bar strip', () => {
    expect(measureGap(fakeWin({ innerHeight: 852 }))).toBe(0)                              // the viewport fills the screen
    expect(measureGap(fakeWin({ innerHeight: 500 }))).toBe(0)                              // a keyboard, not a strip
    expect(measureGap(fakeWin({ innerWidth: 852, innerHeight: 393 }))).toBe(0)             // landscape
    expect(measureGap(fakeWin({ navigator: { userAgent: IPHONE, standalone: false } }))).toBe(0)   // a browser tab
    expect(measureGap(fakeWin({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', standalone: undefined } }))).toBe(0)
  })
  it('publishes the gap as --vgap, and only changes it when it changes', () => {
    const w = fakeWin()
    expect(applyViewportGap(w)).toBe(59)
    expect(w.document.documentElement.style.getPropertyValue('--vgap')).toBe('59px')
    w.innerHeight = 852
    applyViewportGap(w)
    expect(w.document.documentElement.style.getPropertyValue('--vgap')).toBe('0px')
  })
})
