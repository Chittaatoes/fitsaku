// @vitest-environment happy-dom
// The numbered exercise row at the top of a workout, and the rest bar at the bottom: what each
// says about where you are. (Their behaviour is covered in Workout.test.jsx and RestTimer.*.test.jsx.)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkoutChips from './WorkoutChips.jsx'
import RestTimer from './RestTimer.jsx'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { EXDB } from '../lib/exercises-data.js'
import { setLang } from '../lib/i18n.js'
import { exerciseNameText } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

let host, root, originalS
beforeEach(async () => {
  vi.useFakeTimers()
  await setLang('en')
  originalS = useStore.getState().S
  useStore.setState({ S: { ...originalS, sound: false } })
  useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => {
  act(() => root.render(null)); useUI.getState().stopRest(); useUI.getState().stopWork()
  useStore.setState({ S: originalS }); host.remove(); vi.useRealTimers()
})

const set = done => ({ w: 10, r: 5, done })
const entry = (i, sets) => ({ id: EXDB[i].id, target: { mode: 'reps', sets: sets.length, reps: 5 }, sets })

describe('the numbered exercise row', () => {
  const entries = [entry(0, [set(true), set(true)]), entry(1, [set(true), set(false)]), entry(2, [set(false)]), entry(3, [set(false)])]
  const mountChips = cur => act(() => root.render(<WorkoutChips entries={entries} cur={cur} onPick={() => {}} />))

  it('shows a finished exercise as a tick, a started one ringed, and the rest empty', () => {
    mountChips(1)
    const chips = [...host.querySelectorAll('.wchip')]
    expect(chips.map(c => c.className)).toEqual(['wchip done', 'wchip partial cur', 'wchip todo', 'wchip todo'])
    expect(chips[0].querySelector('[data-icon="check"]')).toBeTruthy()
    expect(chips[1].querySelector('[data-icon="check"]')).toBeNull()
    expect(chips[2].querySelector('[data-icon="check"]')).toBeNull()
    // every state keeps its number in the markup, for the one that is hidden behind the tick too
    expect(chips.map(c => c.querySelector('.wchip-n').textContent)).toEqual(['1', '2', '3', '4'])
  })

  it('says in words which one is on screen: its place and its name', () => {
    mountChips(2)
    const cap = host.querySelector('.wchips-cap')
    expect(cap.textContent.startsWith('3/4')).toBe(true)
    expect(cap.textContent).toContain(exerciseNameText(EXDB[2]))
    mountChips(0)
    expect(host.querySelector('.wchips-cap').textContent.startsWith('1/4')).toBe(true)
  })

  it('keeps the accessible names as they were, and the caption is for the eye only', () => {
    mountChips(1)
    expect(host.querySelector('nav.wchips').getAttribute('aria-label')).toBe('Exercises in this workout')
    expect(host.querySelectorAll('.wchip')[0].getAttribute('aria-label')).toMatch(/^Exercise 1: .* \(Finished\)$/)
    expect(host.querySelector('.wchips-cap').getAttribute('aria-hidden')).toBe('true')
    expect(host.textContent).not.toContain('Exercise 2 / 4')
  })
})

describe('the rest bar', () => {
  const mountRest = () => act(() => root.render(<RestTimer />))

  it('counting down it says Rest; when over it says Ready and what comes next', () => {
    act(() => useUI.getState().startRest(30, 0)); mountRest()
    expect(host.querySelector('#timer .lbl').textContent).toBe('Rest')
    act(() => vi.advanceTimersByTime(31000))
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(host.querySelector('#timer .lbl').textContent).toBe('Next set')
  })

  it('in Indonesian the ready bar reads "Siap / Set berikutnya" and the close button is "Tutup", not "Tolak"', async () => {
    await setLang('id')
    act(() => useUI.getState().startRest(1, 0)); mountRest()
    act(() => vi.advanceTimersByTime(1500))
    expect(host.querySelector('#timer .t').textContent).toBe('Siap')
    expect(host.querySelector('#timer .lbl').textContent).toBe('Set berikutnya')
    expect(host.querySelector('#timer .skip .on').textContent).toBe('Tutup')
  })
})
