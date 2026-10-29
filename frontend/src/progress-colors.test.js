// The colours of the muscle balance and strength maps are the muscle activity map's red (255, 90, 31), and the gold of the
// strength view is gone.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_RGB } from './lib/muscle-activity.js'

const css = fs.readFileSync(path.resolve(__dirname, 'index.css'), 'utf8')
const rule = sel => { const m = css.match(new RegExp(sel.replace(/[.[\]]/g, '\$&') + '\{[^}]*\}')); return m ? m[0] : '' }

describe('strength', () => {
  it('has no yellow left, at any band, on the map or its legend', () => {
    for (const band of ['l1', 'l2', 'l3', 'l4']) {
      expect(rule(`.hm-strength .bm-m.${band}`)).toMatch(/rgba\(255,90,31,/)
      expect(rule(`.hm-strength .hm-c.${band}`)).toMatch(/rgba\(255,90,31,/)
    }
    expect(css).not.toMatch(/\.hm-strength[^{]*\{[^}]*yellow/)
  })
  it('gets stronger band by band, like the activity map does', () => {
    const a = band => +/rgba\(255,90,31,([\d.]+)\)/.exec(rule(`.hm-strength .bm-m.${band}`))[1]
    expect(a('l1')).toBeLessThan(a('l2'))
    expect(a('l2')).toBeLessThan(a('l3'))
    expect(a('l3')).toBeLessThan(a('l4'))
    expect(a('l4')).toBeLessThan(1)
  })
  it('is the hue the activity map uses', () => {
    expect(ACTIVITY_RGB).toEqual([255, 90, 31])
  })
})

describe('the shared red', () => {
  it('is available as --act for the places that need one colour', () => {
    expect(css).toMatch(/--act:rgb\(255,90,31\)/)
  })
})
