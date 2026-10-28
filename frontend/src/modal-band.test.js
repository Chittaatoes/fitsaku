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
  it('paints a solid fill under the sheet, so it reaches the bottom even when the gap cannot be measured', () => {
    expect(css).toMatch(/0 120px 0 0 var\(--bg-el\)/)
    expect(css).toMatch(/0 120px 0 0 var\(--bg\)/)
  })
  it('keeps the sheet and its content inside the layout viewport; only the backdrop reaches below by --vgap', () => {
    expect(css).toMatch(/#modal-root\{position:fixed;inset:0;z-index:100/)
    expect(css).toMatch(/\.mback\{[^}]*bottom:calc\(-1 \* var\(--vgap,0px\)\)/)
    expect(css).toMatch(/padding:8px 18px calc\(20px \+ var\(--sab\)\);/)
  })
})
