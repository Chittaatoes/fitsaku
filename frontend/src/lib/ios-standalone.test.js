import { describe, expect, it } from 'vitest'
import { isAppleStandalone, markIosStandalone } from './ios-standalone.js'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const fakeWin = (nav = {}) => ({
  navigator: { userAgent: IPHONE, maxTouchPoints: 5, standalone: true, ...nav },
  matchMedia: () => ({ matches: false }),
  document: { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v } } },
})

describe('isAppleStandalone', () => {
  it('is true for the home-screen app', () => {
    expect(isAppleStandalone(fakeWin())).toBe(true)
  })
  it('is true for an iPad that reports a desktop user agent, and for the display-mode query', () => {
    const ipad = fakeWin({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', standalone: undefined })
    ipad.matchMedia = () => ({ matches: true })
    expect(isAppleStandalone(ipad)).toBe(true)
  })
  it('is false for a browser tab and for other platforms', () => {
    expect(isAppleStandalone(fakeWin({ standalone: false }))).toBe(false)
    expect(isAppleStandalone(fakeWin({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', standalone: undefined }))).toBe(false)
    expect(isAppleStandalone(fakeWin({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120', standalone: undefined }))).toBe(false)
  })
  it('does not throw when the window is unusable', () => {
    expect(isAppleStandalone({})).toBe(false)
  })
})

describe('markIosStandalone', () => {
  it('marks the document only in the home-screen app', () => {
    const on = fakeWin(); markIosStandalone(on)
    expect(on.document.documentElement.attrs['data-ios-standalone']).toBe('')
    const off = fakeWin({ standalone: false }); markIosStandalone(off)
    expect(off.document.documentElement.attrs['data-ios-standalone']).toBeUndefined()
  })
})
