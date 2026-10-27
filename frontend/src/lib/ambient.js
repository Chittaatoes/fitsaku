// Built-in workout sound: a gentle beat while you train and a slow, calm pad while you rest.
//
// Generated live with Web Audio (oscillators and filtered noise), so there is no audio file, no
// licensing question and no download. It runs in a context of its own: lib/sound.js suspends its
// context a second after its last beep (to give the phone's audio session back), which would cut
// a continuous sound; the beeps and the chime keep working beside it.
//
// `kind` is 'workout' (128 bpm gym beat: a hard kick on every beat, claps on 2 and 4, rolling hats
// with an open hat on the offbeat, a pumping sub on the offbeats and a power-chord stab; no melody,
// and a clap roll into every fourth bar to lift it) or 'rest' (four slow chords that swell and fade,
// with a faint bell now and then).
// Playing a different kind crossfades; stopping fades out. The scheduler looks a short way ahead
// of the audio clock and never queues a backlog: after a pause (a tab put to sleep) it resumes from
// "now" instead of replaying what it missed.
//
// Like every Web Audio sound it is muted by the iPhone's silent switch unless the user has turned
// on "play on silent" (lib/sound.js); that is the platform's rule, not something to work around here.

const LOOKAHEAD = 0.25       // seconds scheduled ahead of the clock
const TICK_MS = 60
const FADE_IN = 1.2
const A = f => 440 * Math.pow(2, (f - 69) / 12)   // MIDI note → Hz

// The training beat is drums, a pumping sub and a stab: no tune to follow. The sub's root moves every
// two bars (A, A, F, G) so it drives without becoming a melody.
const SUB_ROOTS = [33, 33, 29, 31]   // MIDI A1, A1, F1, G1
const CHORDS = [[45, 52, 55, 59, 60], [41, 48, 52, 57], [48, 55, 59, 64], [43, 50, 52, 59]]   // Am9, Fmaj7, Cmaj7, G6
const BELLS = [72, 76, 79, 81, 84]
const BPM = 128
const CHORD_SEC = 8

export const KINDS = ['workout', 'rest']
const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export function createAmbient({ ctxFactory, setIntervalFn = setInterval, clearIntervalFn = clearInterval, random = Math.random } = {}) {
  let ctx = null, master = null
  let volume = 0.5
  const voices = new Set()
  let current = null            // the voice that is playing now

  const makeCtx = () => {
    if (ctxFactory) return ctxFactory()
    const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
    return C ? new C() : null
  }
  const ensure = () => {
    if (ctx && ctx.state !== 'closed') return ctx
    ctx = makeCtx()
    if (!ctx) return null
    master = ctx.createGain()
    master.gain.value = volume * 0.5       // headroom: the layers add up
    master.connect(ctx.destination)
    return ctx
  }
  const wake = () => {
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}) }
  }
  // A context made outside a tap starts suspended; the first touch anywhere starts it.
  let unlockBound = false
  const bindUnlock = () => {
    if (unlockBound || typeof document === 'undefined') return
    unlockBound = true
    const go = () => { wake(); if (!ctx || ctx.state === 'running') { document.removeEventListener('pointerdown', go, true); document.removeEventListener('keydown', go, true); unlockBound = false } }
    document.addEventListener('pointerdown', go, true); document.addEventListener('keydown', go, true)
  }

  /* ---- sound building blocks, each connected to a voice's own gain ---- */
  const noiseBuf = () => {
    if (ctx.__noise) return ctx.__noise
    const len = Math.floor((ctx.sampleRate || 44100) * 0.5)
    const b = ctx.createBuffer(1, len, ctx.sampleRate || 44100)
    const d = b.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = random() * 2 - 1
    return (ctx.__noise = b)
  }
  const note = (v, freq, t0, dur, { type = 'sine', peak = 0.2, attack = 0.01, filter = 0, glideTo = 0 } = {}) => {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur)
    let out = o
    if (filter) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filter; o.connect(f); out = f }
    out.connect(g); g.connect(v.gain)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.start(t0); o.stop(t0 + dur + 0.05)
    v.nodes.push(o)
  }
  const burst = (v, t0, dur, { peak = 0.1, hp = 7000, bp = 0 } = {}) => {
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter()
    s.buffer = noiseBuf()
    f.type = bp ? 'bandpass' : 'highpass'; f.frequency.value = bp || hp
    s.connect(f); f.connect(g); g.connect(v.gain)
    g.gain.setValueAtTime(peak, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    s.start(t0); s.stop(t0 + dur + 0.05)
    v.nodes.push(s)
  }

  /* ---- the two kinds: each schedules whatever falls before `until` ---- */
  // One sixteenth note of the training beat. 16 sixteenths = one bar of 4/4.
  const playWorkoutStep = (v, step, t0) => {
    const i = step % 16, bar = Math.floor(step / 16)
    const beat = i % 4 === 0
    if (beat) {                                                                                       // kick on every beat
      note(v, 160, t0, 0.24, { peak: 0.9, attack: 0.002, glideTo: 42 })
      burst(v, t0, 0.012, { peak: 0.12, hp: 3500 })                                                   // its click
    }
    if (i === 4 || i === 12) {                                                                        // clap on 2 and 4
      burst(v, t0, 0.16, { peak: 0.26, bp: 1500 })
      burst(v, t0 + 0.012, 0.1, { peak: 0.16, bp: 2400 })
    }
    if (i % 4 === 2) burst(v, t0, 0.11, { peak: 0.1, hp: 6500 })                                     // open hat on the offbeat
    else if (!beat) burst(v, t0, 0.03, { peak: i % 2 ? 0.045 : 0.07, hp: 8500 })                      // closed hats between
    if (i % 4 === 2) {                                                                                // the sub pumps on the offbeats
      const root = SUB_ROOTS[Math.floor(bar / 2) % SUB_ROOTS.length]
      note(v, A(root), t0, 0.2, { type: 'sawtooth', peak: 0.3, filter: 190, attack: 0.006 })
    }
    if (i === 0 || i === 10) {                                                                        // a power-chord stab, off the beat
      const root = SUB_ROOTS[Math.floor(bar / 2) % SUB_ROOTS.length] + 12
      note(v, A(root), t0, 0.17, { type: 'sawtooth', peak: 0.07, filter: 1400, attack: 0.004 })
      note(v, A(root + 7), t0, 0.17, { type: 'sawtooth', peak: 0.06, filter: 1400, attack: 0.004 })
    }
    if (bar % 4 === 3 && i >= 12) burst(v, t0, 0.06, { peak: 0.1 + (i - 12) * 0.05, bp: 1900 })        // the roll into every fourth bar
  }
  const playChord = (v, idx, t0) => {
    for (const m of CHORDS[idx % CHORDS.length]) {
      for (const detune of [-5, 5]) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter()
        o.type = m < 50 ? 'triangle' : 'sine'
        o.frequency.value = A(m); o.detune.value = detune
        f.type = 'lowpass'; f.frequency.value = 900
        o.connect(f); f.connect(g); g.connect(v.gain)
        const dur = CHORD_SEC + 2.5
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.linearRampToValueAtTime(0.07, t0 + 2.6)
        g.gain.setValueAtTime(0.07, t0 + CHORD_SEC - 1)
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        o.start(t0); o.stop(t0 + dur + 0.05)
        v.nodes.push(o)
      }
    }
  }

  const schedule = v => {
    const now = ctx.currentTime
    if (v.kind === 'workout') {
      const eighth = 60 / BPM / 4                            // one sixteenth
      if (v.next < now) v.next = now + 0.05                  // after a stall, from now: no backlog
      while (v.next < now + LOOKAHEAD) { playWorkoutStep(v, v.step++, v.next); v.next += eighth }
    } else {
      if (v.next < now) v.next = now + 0.05
      while (v.next < now + LOOKAHEAD) {
        if (v.step % 1 === 0 && v.chordAt <= v.next) { playChord(v, v.chordIdx++, v.next); v.chordAt = v.next + CHORD_SEC }
        if (v.bellAt <= v.next) { note(v, A(BELLS[Math.floor(random() * BELLS.length)]), v.next, 3.2, { peak: 0.05, attack: 0.02 }); v.bellAt = v.next + 3 + random() * 4 }
        v.next += 0.25; v.step++
      }
    }
    // forget nodes that have finished, so a long session does not hold on to thousands
    if (v.nodes.length > 80) v.nodes.splice(0, v.nodes.length - 40)
  }

  const dispose = v => {
    clearIntervalFn(v.timer)
    for (const n of v.nodes) { try { n.stop() } catch { /* already stopped */ } }
    try { v.gain.disconnect() } catch { /* gone */ }
    voices.delete(v)
    if (!voices.size && ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}) }
  }
  const fadeOut = (v, sec) => {
    clearIntervalFn(v.timer)                               // nothing new is scheduled; what is queued rings out under the fade
    const t = ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + sec)
    v.dying = true
    setTimeout(() => dispose(v), sec * 1000 + 150)
  }

  return {
    /** Starts (or switches to) `kind` at `vol` (0–1). Returns false when this device has no Web Audio. */
    play(kind, vol = volume) {
      if (!KINDS.includes(kind)) return false
      volume = clamp01(vol)
      if (!ensure()) return false
      bindUnlock(); wake()
      master.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.1)
      if (current && current.kind === kind && !current.dying) return true
      if (current) fadeOut(current, 1)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE_IN)
      gain.connect(master)
      const v = { kind, gain, nodes: [], step: 0, next: ctx.currentTime + 0.05, chordAt: 0, chordIdx: 0, bellAt: 0, dying: false, timer: null }
      v.timer = setIntervalFn(() => schedule(v), TICK_MS)
      voices.add(v); current = v
      schedule(v)
      return true
    },
    /** Fades out (default one second) and releases the audio device. */
    stop(sec = 1) {
      if (!current) return
      const v = current; current = null
      if (ctx && ctx.state !== 'closed') fadeOut(v, Math.max(0.05, sec))
    },
    setVolume(vol) {
      volume = clamp01(vol)
      if (ctx && master) master.gain.setTargetAtTime(volume * 0.5, ctx.currentTime, 0.1)
    },
    kind: () => (current && !current.dying ? current.kind : null),
  }
}

/** The one the app uses. */
export const ambient = createAmbient()
