// Indonesian exercise texts: names, descriptions and steps exist for the exercises the starter plans use and the push-up,
// line up with the English steps one for one, and are the ones the app loads for the language. The rest of the catalogue
// is still English until scripts/catalogue/translate.mjs has been run (docs: the Settings note says so).
import { describe, expect, it } from 'vitest'
import enInstr from '../instr/en.js'
import idInstr from '../instr/id.js'
import idDesc from '../exercise-desc/id.js'
import enDesc from '../exercise-desc/en.js'
import idNames from '../exercise-names/id.js'
import { INSTR_LANGS, EXERCISE_NAME_LANGS } from './catalogue-langs.js'
import { buildStarterPlan } from './starter.js'

describe('Indonesian exercise texts', () => {
  it('is a known pack for names and steps', () => {
    expect(INSTR_LANGS).toContain('id'); expect(EXERCISE_NAME_LANGS).toContain('id')
  })
  it('covers every exercise of the starter plans, and the push-up', () => {
    const ids = new Set(['0662'])
    for (const plan of ['ppl', 'upper-lower', 'full-body', '5x5']) for (const r of buildStarterPlan(plan).routines) r.ex.forEach(e => ids.add(e.id))
    for (const id of ids) {
      expect(idNames[id], `name ${id}`).toBeTruthy()
      expect(idDesc[id], `description ${id}`).toBeTruthy()
      expect(idInstr[id], `steps ${id}`).toHaveLength(enInstr[id].length)
    }
  })
  it('is not the English text, and keeps the same number of steps everywhere', () => {
    for (const id of Object.keys(idDesc)) expect(idDesc[id], id).not.toBe(enDesc[id])
    // steps are translated for fewer exercises than names and descriptions are (done in stages): where there are some, they line up
    for (const id of Object.keys(idInstr)) {
      expect(idInstr[id].length, id).toBe(enInstr[id].length)
      expect(idInstr[id].every(s => typeof s === 'string' && s.trim()), id).toBe(true)
    }
    // no stray control characters or edge whitespace in any translated text
    const control = new RegExp('[\u0000-\u001f]')
    for (const pack of [idNames, idDesc]) {
      for (const [id, v] of Object.entries(pack)) {
        expect(v, id).toBe(v.trim())
        expect(control.test(v), id).toBe(false)
      }
    }
  })
})
