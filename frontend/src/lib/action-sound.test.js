// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ S: { sound: true }, sfx: vi.fn(), setLoudness: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: mocks.S }) } }))
vi.mock('./sound.js', () => ({ sfx: (...a) => mocks.sfx(...a), setLoudness: (...a) => mocks.setLoudness(...a) }))

import { actionSound, applyLoudness, playSfx } from './action-sound.js'

beforeEach(() => { mocks.sfx.mockClear(); mocks.setLoudness.mockClear(); mocks.S = { sound: true } })

describe('action sounds', () => {
  it('play when Sounds is on and the action switch has not been turned off', () => {
    actionSound('add')
    expect(mocks.sfx).toHaveBeenCalledWith(true, 'add')
  })
  it('stay silent when Sounds is off, or when Action sounds is', () => {
    mocks.S = { sound: false }; actionSound('delete')
    mocks.S = { sound: true, actionSounds: false }; actionSound('delete')
    expect(mocks.sfx).not.toHaveBeenCalled()
  })
  it('never throw, even when the sound module does', () => {
    mocks.sfx.mockImplementationOnce(() => { throw new Error('no audio') })
    expect(() => actionSound('add')).not.toThrow()
    mocks.sfx.mockImplementationOnce(() => { throw new Error('no audio') })
    expect(() => playSfx(true, 'finish')).not.toThrow()
    mocks.setLoudness.mockImplementationOnce(() => { throw new Error('no audio') })
    expect(() => applyLoudness('max')).not.toThrow()
  })
  it('hand the loudness level and the finish fanfare on', () => {
    applyLoudness('max'); expect(mocks.setLoudness).toHaveBeenCalledWith('max')
    playSfx(true, 'finish'); expect(mocks.sfx).toHaveBeenCalledWith(true, 'finish')
  })
})
