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
