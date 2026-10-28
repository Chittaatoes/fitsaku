import { describe, expect, it, vi } from 'vitest'
import { createMusic, TRACKS, RESTART_AFTER_S } from './music.js'

// An audio element stand-in: events by name, a play() that can be refused, a clock.
function fakeAudio({ refuse = false, fail = false, readOnlyVolume = false } = {}) {
  const l = {}
  const a = {
    preload: '', src: '', currentTime: 0, paused: true,
    addEventListener: (t, f) => { l[t] = f },
    emit: t => l[t] && l[t](),
    play: vi.fn(async () => {
      if (a.refuse) throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })
      if (a.fail) throw Object.assign(new Error('bad'), { name: 'NotSupportedError' })
      a.paused = false
      if (l.play) l.play()
    }),
    pause: vi.fn(() => { a.paused = true; if (l.pause) l.pause() }),
    refuse, fail,
  }
  // iOS: the volume property can be read and written to, and it stays 1.
  if (readOnlyVolume) Object.defineProperty(a, 'volume', { get: () => 1, set: () => {} })
  else a.volume = 1
  return a
}

// A Web Audio stand-in: a gain the music is routed through, a context that starts suspended.
function fakeCtx() {
  const gain = { gain: { value: 1, setTargetAtTime: vi.fn((v) => { gain.gain.value = v }) }, connect: vi.fn() }
  const ctx = {
    currentTime: 0, state: 'suspended', destination: {},
    createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })), createGain: vi.fn(() => gain),
    resume: vi.fn(async () => { ctx.state = 'running' }),
  }
  return { ctx, gain }
}
const rig = opts => {
  const audio = fakeAudio(opts)
  const changes = []
  const h = {}
  const doc = { h, addEventListener: (t, f) => { h[t] = f }, removeEventListener: t => { delete h[t] } }
  const web = fakeCtx()
  const m = createMusic({ audioFactory: () => audio, base: 'https://gym.test/', onPlayingChange: p => changes.push(p), doc, ctxFactory: () => web.ctx })
  return { m, audio, changes, doc, web }
}
const file = a => a.src.split('/').pop()

describe('the workout music', () => {
  it('has the four songs, music1 first', () => {
    expect(TRACKS.map(t => t.src)).toEqual(['music/music1.mp3', 'music/music2.mp3', 'music/music3.mp3', 'music/music4.mp3'])
  })

  it('a session starts on music1 and plays it, and says it is playing', async () => {
    const { m, audio, changes } = rig()
    await m.start()
    expect(audio.src).toBe('https://gym.test/music/music1.mp3')
    expect(m.state).toMatchObject({ index: 0, playing: true, blocked: false })
    expect(changes).toEqual([true])
  })

  it('with auto-play off it only selects music1', async () => {
    const { m, audio } = rig()
    await m.start({ autoplay: false })
    expect(file(audio)).toBe('music1.mp3')
    expect(m.state.playing).toBe(false)
    expect(audio.play).not.toHaveBeenCalled()
  })

  it('next goes on song by song and plays it, from the last back to the first', async () => {
    const { m, audio } = rig()
    await m.start()
    await m.next(); expect(file(audio)).toBe('music2.mp3')
    await m.next(); await m.next(); expect(file(audio)).toBe('music4.mp3')
    await m.next(); expect(file(audio)).toBe('music1.mp3')
    expect(m.state.playing).toBe(true)
  })

  it('previous goes back, from the first to the last, and restarts a song that is well under way', async () => {
    const { m, audio } = rig()
    await m.start()
    audio.currentTime = 1
    await m.prev(); expect(file(audio)).toBe('music4.mp3')
    audio.currentTime = RESTART_AFTER_S + 5
    await m.prev(); expect(file(audio)).toBe('music4.mp3'); expect(audio.currentTime).toBe(0)
    audio.currentTime = 0
    await m.prev(); expect(file(audio)).toBe('music3.mp3')
  })

  it('pressing next while paused starts the song: it is a request for music', async () => {
    const { m, audio } = rig()
    await m.start({ autoplay: false })
    await m.next()
    expect(file(audio)).toBe('music2.mp3')
    expect(m.state.playing).toBe(true)
  })

  it('a song that ends goes on to the next one', async () => {
    const { m, audio } = rig()
    await m.start()
    audio.emit('ended')
    await Promise.resolve()
    expect(file(audio)).toBe('music2.mp3')
  })

  it('toggle pauses and resumes', async () => {
    const { m, changes } = rig()
    await m.start()
    await m.toggle(); expect(m.state.playing).toBe(false)
    await m.toggle(); expect(m.state.playing).toBe(true)
    expect(changes).toEqual([true, false, true])
  })

  it('a browser that refuses to start sound is not an error: it waits for the next touch, then plays', async () => {
    const { m, audio, doc } = rig({ refuse: true })
    await m.start()
    expect(m.state).toMatchObject({ playing: false, blocked: true, error: false })
    audio.refuse = false
    doc.h.pointerup()
    await Promise.resolve(); await Promise.resolve()
    expect(m.state).toMatchObject({ playing: true, blocked: false })
  })

  it('a song that cannot be played is an error, said as such, and a later try can clear it', async () => {
    const { m, audio } = rig({ fail: true })
    await m.start()
    expect(m.state).toMatchObject({ playing: false, error: true })
    audio.fail = false
    await m.next()
    expect(m.state).toMatchObject({ playing: true, error: false })
  })

  it('a start that is interrupted by another song or a pause is not an error', async () => {
    const { m, audio } = rig()
    audio.play = vi.fn(async () => { throw Object.assign(new Error('interrupted'), { name: 'AbortError' }) })
    await m.start()
    expect(m.state).toMatchObject({ error: false, blocked: false })
  })

  it('the element error event stops it and marks the song', async () => {
    const { m, audio } = rig()
    await m.start()
    audio.emit('error')
    expect(m.state).toMatchObject({ playing: false, error: true })
  })

  it('stop at the end of a session pauses, forgets the song, and the next session starts from music1 again', async () => {
    const { m, audio } = rig()
    await m.start(); await m.next(); await m.next()
    m.stop()
    expect(m.state).toMatchObject({ playing: false, index: 0, blocked: false })
    expect(file(audio)).toBe('music1.mp3')
    await m.start()
    expect(file(audio)).toBe('music1.mp3')
  })
})

describe('the volume of the music', () => {
  it('sets the audio element volume where the browser lets it, and does not touch Web Audio', async () => {
    const { m, audio, web } = rig()
    await m.start()
    m.setVolume(0.3)
    expect(audio.volume).toBeCloseTo(0.3)
    m.setVolume(0.9)
    expect(audio.volume).toBeCloseTo(0.9)
    expect(web.ctx.createMediaElementSource).not.toHaveBeenCalled()
  })

  it('a volume chosen before the first song is the one it starts at', async () => {
    const { m, audio } = rig()
    m.setVolume(0.4)
    await m.start()
    expect(audio.volume).toBeCloseTo(0.4)
  })

  it('is clamped to 0–1', async () => {
    const { m, audio } = rig()
    await m.start()
    m.setVolume(7); expect(audio.volume).toBe(1)
    m.setVolume(-2); expect(audio.volume).toBe(0)
    m.setVolume(NaN); expect(audio.volume).toBe(1)
  })

  it('where the element volume cannot be set (the iPhone) the music goes through a gain, and the volume is the gain', async () => {
    const { m, audio, web } = rig({ readOnlyVolume: true })
    m.setVolume(0.25)
    await m.start()
    expect(web.ctx.createMediaElementSource).toHaveBeenCalledWith(audio)
    expect(web.ctx.createGain).toHaveBeenCalledTimes(1)
    expect(web.ctx.resume).toHaveBeenCalled()                     // started suspended: the touch that starts the song wakes it
    expect(web.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.25, expect.any(Number), expect.any(Number))
    m.setVolume(0.8)
    expect(web.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.8, expect.any(Number), expect.any(Number))
    expect(m.volume).toBe(0.8)
  })

  it('a device with no Web Audio and a read-only volume plays at full volume rather than not at all', async () => {
    const audio = fakeAudio({ readOnlyVolume: true })
    const m = createMusic({ audioFactory: () => audio, base: 'https://gym.test/', doc: null, ctxFactory: () => null })
    await m.start()
    m.setVolume(0.2)
    expect(m.state.playing).toBe(true)
  })

  it('the volume survives the end of a session and the next one starts at it', async () => {
    const { m, audio } = rig()
    m.setVolume(0.35)
    await m.start(); m.stop()
    await m.start()
    expect(audio.volume).toBeCloseTo(0.35)
  })
})
