import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAmbient, KINDS } from './ambient.js'
import { ambientKindFor, ambientSettingOf, ambientVolumeOf } from './ambient-plan.js'

/* A Web Audio stand-in that records what is built and scheduled, with a clock the test moves. */
function fakeAudio() {
  const log = { osc: [], gain: [], noise: [], suspends: 0, resumes: 0 }
  const param = (v = 0) => ({ value: v, setValueAtTime: vi.fn(function (x) { this.value = x }), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(function (x) { this.value = x }) })
  const node = extra => ({ connect: vi.fn(), disconnect: vi.fn(), ...extra })
  const ctx = {
    currentTime: 0, state: 'running', sampleRate: 8000, destination: node(),
    createGain() { const g = node({ gain: param(1) }); log.gain.push(g); return g },
    createOscillator() { const o = node({ frequency: param(), detune: param(), type: 'sine', start: vi.fn(), stop: vi.fn() }); log.osc.push(o); return o },
    createBiquadFilter() { return node({ frequency: param(), type: 'lowpass' }) },
    createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) } },
    createBufferSource() { const s = node({ start: vi.fn(), stop: vi.fn(), buffer: null }); log.noise.push(s); return s },
    resume() { log.resumes++; ctx.state = 'running'; return Promise.resolve() },
    suspend() { log.suspends++; ctx.state = 'suspended'; return Promise.resolve() },
  }
  return { ctx, log }
}
function engine() {
  const a = fakeAudio()
  const intervals = []
  const e = createAmbient({
    ctxFactory: () => a.ctx,
    setIntervalFn: fn => { intervals.push({ fn, on: true }); return intervals.length - 1 },
    clearIntervalFn: id => { if (intervals[id]) intervals[id].on = false },
    random: () => 0.5,
  })
  const tick = (secs = 0) => { a.ctx.currentTime += secs; intervals.filter(i => i.on).forEach(i => i.fn()) }
  return { e, ...a, intervals, tick }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the built-in rest sound', () => {
  it('without Web Audio it does nothing and says so', () => {
    const e = createAmbient({ ctxFactory: () => null })
    expect(e.play('rest')).toBe(false)
    expect(() => { e.stop(); e.setVolume(1) }).not.toThrow()
    expect(e.kind()).toBe(null)
  })

  it('has no training beat any more, and refuses a kind it does not have', () => {
    const { e, log } = engine()
    expect(KINDS).toEqual(['rest'])
    expect(e.play('workout')).toBe(false)
    expect(e.play('disco')).toBe(false)
    expect(log.osc).toHaveLength(0)
    expect(e.kind()).toBe(null)
  })

  it('the rest sound is slow: a swelling chord and an occasional bell, no drums', () => {
    const { e, log, tick } = engine()
    expect(e.play('rest', 0.6)).toBe(true)
    for (let i = 0; i < 20; i++) tick(0.5)            // 10 s
    expect(e.kind()).toBe('rest')
    expect(log.noise).toHaveLength(0)
    expect(log.osc.length).toBeGreaterThan(8)         // chord voices (two detuned oscillators per note) and bells
    expect(log.osc.some(o => o.detune.value !== 0)).toBe(true)
    expect(log.osc.some(o => o.frequency.exponentialRampToValueAtTime.mock.calls.length > 0)).toBe(false)   // no kick drum
  })

  it('schedules only a short way ahead of the clock', () => {
    const { e, log, tick, ctx } = engine()
    e.play('rest')
    for (let i = 0; i < 40; i++) tick(0.06)
    const latest = Math.max(...log.osc.map(o => o.start.mock.calls[0][0]))
    expect(latest).toBeLessThanOrEqual(ctx.currentTime + 0.3)
  })

  it('after a stall it resumes from now instead of replaying what it missed', () => {
    const { e, log, tick } = engine()
    e.play('rest')
    tick(0.06)
    const before = log.osc.length
    tick(30)                                          // the page was asleep for half a minute
    expect(log.osc.length - before).toBeLessThan(40)  // about one lookahead's worth
  })

  it('playing the same kind again does not stack a second copy', () => {
    const { e, intervals } = engine()
    e.play('rest'); e.play('rest'); e.play('rest', 0.4)
    expect(intervals.filter(i => i.on)).toHaveLength(1)
  })

  it('stop fades out and gives the audio device back once nothing is left', async () => {
    const { e, intervals, ctx, log } = engine()
    e.play('rest')
    e.stop(0.5)
    expect(e.kind()).toBe(null)
    expect(intervals.filter(i => i.on)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(log.suspends).toBe(1)
    expect(ctx.state).toBe('suspended')
    e.stop()                                              // stopping twice is harmless
  })

  it('after a stop it plays again from the start, as one voice', () => {
    const { e, intervals } = engine()
    e.play('rest'); e.stop(0.1); e.play('rest')
    expect(e.kind()).toBe('rest')
    expect(intervals.filter(i => i.on)).toHaveLength(1)
  })

  it('volume is clamped to 0–1 and applied to the master gain', () => {
    const { e, log } = engine()
    e.play('rest', 5)
    const master = log.gain[0]
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.5, expect.any(Number), expect.any(Number))   // 1 × headroom 0.5
    e.setVolume(-3)
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, expect.any(Number), expect.any(Number))
    e.setVolume(NaN)
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, expect.any(Number), expect.any(Number))
  })

  it('wakes a suspended context when it starts', () => {
    const { e, ctx, log } = engine()
    ctx.state = 'suspended'
    e.play('rest')
    expect(log.resumes).toBeGreaterThan(0)
  })
})

describe('when the rest sound plays', () => {
  const live = { id: 'a', entries: [], cur: 0, start: 1 }
  const base = { active: live, timer: null, setting: 'rest', soundOn: true }
  const k = o => ambientKindFor({ ...base, ...o })

  it('only while a rest counts down: a running set is silent', () => {
    expect(k({})).toBe(null)
    expect(k({ timer: { left: 40, total: 60 } })).toBe('rest')
  })
  it('a paused rest, a finished one and the switch-sides gap are silent', () => {
    expect(k({ timer: { left: 40, paused: true } })).toBe(null)
    expect(k({ timer: { left: 0, ready: true } })).toBe(null)
    expect(k({ timer: { left: 8, kind: 'switch' } })).toBe(null)
  })
  it('"off" is silent always', () => {
    expect(k({ setting: 'off', timer: { left: 30 } })).toBe(null)
  })
  it('nothing plays with Sound off or with no workout', () => {
    expect(k({ soundOn: false, timer: { left: 30 } })).toBe(null)
    expect(k({ active: null })).toBe(null)
    expect(k({ active: null, timer: { left: 30 } })).toBe(null)
  })
  it('the music playing does not silence it: it has its own switch', () => {
    expect(k({ timer: { left: 30 }, external: true })).toBe('rest')
  })
  it('not while editing a saved workout or logging one into the past', () => {
    expect(k({ active: { ...live, editingWorkoutId: 'w' }, timer: { left: 30 } })).toBe(null)
    expect(k({ active: { ...live, backfill: {} }, timer: { left: 30 } })).toBe(null)
  })
  it('settings fall back to sensible values, and the old "workout + rest" is now the rest sound', () => {
    expect(ambientSettingOf({})).toBe('rest')
    expect(ambientSettingOf({ ambient: 'weird' })).toBe('rest')
    expect(ambientSettingOf({ ambient: 'all' })).toBe('rest')
    expect(ambientSettingOf({ ambient: 'rest' })).toBe('rest')
    expect(ambientSettingOf({ ambient: 'off' })).toBe('off')
    expect(ambientVolumeOf({})).toBe(0.8)
    expect(ambientVolumeOf({ ambientVol: 7 })).toBe(1)
    expect(ambientVolumeOf({ ambientVol: -1 })).toBe(0)
  })
})
