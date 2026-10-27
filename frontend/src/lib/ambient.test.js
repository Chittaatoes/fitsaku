import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAmbient } from './ambient.js'
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

describe('the built-in workout sound', () => {
  it('without Web Audio it does nothing and says so', () => {
    const e = createAmbient({ ctxFactory: () => null })
    expect(e.play('workout')).toBe(false)
    expect(() => { e.stop(); e.setVolume(1) }).not.toThrow()
    expect(e.kind()).toBe(null)
  })

  it('refuses a kind it does not have', () => {
    const { e, log } = engine()
    expect(e.play('disco')).toBe(false)
    expect(log.osc).toHaveLength(0)
  })

  it('the training sound schedules a kick on every beat, claps, hats and a pumping sub, never more than a short way ahead', () => {
    const { e, log, tick, ctx } = engine()
    expect(e.play('workout', 0.6)).toBe(true)
    expect(e.kind()).toBe('workout')
    const first = log.osc.length
    expect(first).toBeGreaterThan(0)
    for (let i = 0; i < 40; i++) tick(0.06)           // ≈ 2.4 s: about 5 beats at 128 bpm
    const kicks = log.osc.filter(o => o.frequency.exponentialRampToValueAtTime.mock.calls.length > 0)
    expect(kicks.length).toBeGreaterThanOrEqual(4)
    expect(log.noise.length).toBeGreaterThan(4)       // hats and snare
    // everything it queued starts no later than the lookahead past the clock
    const latest = Math.max(...log.osc.map(o => o.start.mock.calls[0][0]))
    expect(latest).toBeLessThanOrEqual(ctx.currentTime + 0.3)
  })

  it('the first bar of the training beat: four kicks, claps on 2 and 4, a pumping sub and two stabs, and no tune', () => {
    const { e, log, tick } = engine()
    e.play('workout')
    for (let i = 0; i < 40; i++) tick(0.06)
    const bar = 60 / 128 * 4                                        // 1.875 s
    const inBar = log.osc.filter(o => o.start.mock.calls[0][0] < bar + 0.05)
    const kicks = inBar.filter(o => o.frequency.exponentialRampToValueAtTime.mock.calls.length > 0)
    expect(kicks).toHaveLength(4)
    expect(inBar.filter(o => o.type === 'sawtooth')).toHaveLength(8)   // 4 sub notes + 2 stabs of 2 notes
    expect(inBar.filter(o => o.type === 'triangle')).toHaveLength(0)  // nothing that plays a melody
    // the kicks sit on the beats: a quarter note apart
    const times = kicks.map(o => o.start.mock.calls[0][0])
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(60 / 128, 2)
  })

  it('after a stall it resumes from now instead of replaying the beats it missed', () => {
    const { e, log, tick } = engine()
    e.play('workout')
    tick(0.06)
    const before = log.osc.length
    tick(30)                                          // the page was asleep for half a minute
    const added = log.osc.length - before
    expect(added).toBeLessThan(40)                    // about one lookahead's worth, not a minute of beats
  })

  it('the rest sound is slow: a swelling chord and an occasional bell, no drums', () => {
    const { e, log, tick } = engine()
    e.play('rest')
    for (let i = 0; i < 20; i++) tick(0.5)            // 10 s
    expect(e.kind()).toBe('rest')
    expect(log.noise).toHaveLength(0)
    expect(log.osc.length).toBeGreaterThan(8)         // chord voices (two detuned oscillators per note) and bells
    expect(log.osc.some(o => o.detune.value !== 0)).toBe(true)
  })

  it('playing the same kind again does not stack a second copy', () => {
    const { e, intervals } = engine()
    e.play('workout'); e.play('workout'); e.play('workout', 0.4)
    expect(intervals.filter(i => i.on)).toHaveLength(1)
  })

  it('switching kind crossfades: the old one stops scheduling and is released after its fade', async () => {
    const { e, intervals, ctx, log } = engine()
    e.play('workout')
    const firstGain = log.gain[1]            // [0] is the master, [1] the first voice's own gain
    e.play('rest')
    expect(e.kind()).toBe('rest')
    expect(intervals.filter(i => i.on)).toHaveLength(1)   // only the new one schedules
    expect(firstGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number))
    await vi.advanceTimersByTimeAsync(1300)
    expect(firstGain.disconnect).toHaveBeenCalled()
    expect(ctx.state).toBe('running')                     // the new voice still holds the device
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

  it('volume is clamped to 0–1 and applied to the master gain', () => {
    const { e, log } = engine()
    e.play('workout', 5)
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

describe('which sound belongs to the moment', () => {
  const live = { id: 'a', entries: [], cur: 0, start: 1 }
  const base = { active: live, timer: null, setting: 'all', soundOn: true, external: false }
  const k = o => ambientKindFor({ ...base, ...o })

  it('a running workout gets the training sound, a counting rest the calm one', () => {
    expect(k({})).toBe('workout')
    expect(k({ timer: { left: 40, total: 60 } })).toBe('rest')
  })
  it('a paused rest, a finished one and the switch-sides gap go back to the training sound', () => {
    expect(k({ timer: { left: 40, paused: true } })).toBe('workout')
    expect(k({ timer: { left: 0, ready: true } })).toBe('workout')
    expect(k({ timer: { left: 8, kind: 'switch' } })).toBe('workout')
  })
  it('"rest only" is silent between rests, and "off" is silent always', () => {
    expect(k({ setting: 'rest' })).toBe(null)
    expect(k({ setting: 'rest', timer: { left: 30 } })).toBe('rest')
    expect(k({ setting: 'off', timer: { left: 30 } })).toBe(null)
  })
  it('nothing plays with Sound off, with no workout, or while Spotify plays from the panel', () => {
    expect(k({ soundOn: false })).toBe(null)
    expect(k({ active: null })).toBe(null)
    expect(k({ active: null, timer: { left: 30 } })).toBe(null)
    expect(k({ external: true })).toBe(null)
    expect(k({ external: true, timer: { left: 30 } })).toBe(null)
  })
  it('not while editing a saved workout or logging one into the past', () => {
    expect(k({ active: { ...live, editingWorkoutId: 'w' } })).toBe(null)
    expect(k({ active: { ...live, backfill: {} } })).toBe(null)
  })
  it('settings fall back to sensible values', () => {
    expect(ambientSettingOf({})).toBe('all')
    expect(ambientSettingOf({ ambient: 'weird' })).toBe('all')
    expect(ambientSettingOf({ ambient: 'rest' })).toBe('rest')
    expect(ambientVolumeOf({})).toBe(0.5)
    expect(ambientVolumeOf({ ambientVol: 7 })).toBe(1)
    expect(ambientVolumeOf({ ambientVol: -1 })).toBe(0)
  })
})
