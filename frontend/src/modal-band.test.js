// The page background follows an open popup, so the strip under it in the iOS home-screen app matches it.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = fs.readFileSync(path.resolve(__dirname, 'index.css'), 'utf8')

describe('the strip under a popup', () => {
  it('takes the sheet colour while a sheet is open, and an even dim while a dialog is', () => {
    expect(css).toMatch(/html:has\(#modal-root \.sheet\)\{background:var\(--bg-el\)\}/)
    expect(css).toMatch(/html:has\(#modal-root \.center\)\{background:color-mix\(in srgb,var\(--bg\) 66%,#000\)\}/)
  })
  it('only while a popup exists: the rule is keyed on the popup, not set on the page', () => {
    expect(css).not.toMatch(/\nhtml\{[^}]*background:var\(--bg-el\)/)
  })
})

describe('the popup layer', () => {
  it('stands on the layout viewport with no compensation for a missing strip', () => {
    expect(css).toMatch(/#modal-root\{position:fixed;inset:0;z-index:100/)
    expect(css).toMatch(/\.mback\{[^}]*position:absolute;inset:0;/)
    expect(css).not.toMatch(/--vgap/)
    expect(css).not.toMatch(/0 120px 0 0/)
  })
  it('keeps the glass: a sheet is translucent and blurs what is behind it, in the iOS home-screen app too', () => {
    expect(css).toMatch(/\.sheet\{\s*background:color-mix\(in srgb,var\(--bg-el\) 78%,transparent\);\s*-webkit-backdrop-filter:blur\(30px\)/)
    expect(css).not.toMatch(/\[data-ios-standalone\][^{]*\.sheet\{[^}]*(background|backdrop-filter)/)
  })
  it('gives a sheet in the iOS home-screen app the home-indicator inset and a short breath, nothing more', () => {
    expect(css).toMatch(/padding:8px 18px calc\(20px \+ var\(--sab\)\);/)
    expect(css).toMatch(/:root\[data-ios-standalone\] \.sheet\{padding-bottom:max\(12px,calc\(var\(--sab\) - 10px\)\);scroll-padding-bottom:max\(12px,calc\(var\(--sab\) - 10px\)\)\}/)
  })
})

describe('the tab bar sits low, like the App Store one', () => {
  it('counts only the part of the bottom inset past 27px, and everything stacked above it follows', () => {
    expect(css).toMatch(/--sab-nav:max\(0px,calc\(var\(--sab\) - 27px\)\)/)
    expect(css).toMatch(/#tabbar\{\s*position:fixed;left:50%;bottom:calc\(14px \+ var\(--sab-nav\)\)/)
    expect(css).toMatch(/#timer\{[^}]*bottom:calc\(88px \+ var\(--sab-nav\)\)/)
    expect(css).toMatch(/#toast\{[^}]*bottom:calc\(96px \+ var\(--sab-nav\)\)/)
    expect(css).toMatch(/calc\(88px \+ var\(--sab-nav\)\)/)
  })
  it('leaves roomy screens as they were', () => {
    expect(css).toMatch(/@media \(min-width:600px\)\{\s*:root\{--sab-nav:var\(--sab\)\}\s*#tabbar\{bottom:calc\(20px \+ var\(--sab\)\)\}/)
  })
})
