// Built-in rest sound: a slow, calm pad while a rest counts down.
//
// Generated live with Web Audio (oscillators and filtered noise), so there is no audio file, no
// licensing question and no download. It runs in a context of its own: lib/sound.js suspends its
// context a second after its last beep (to give the phone's audio session back), which would cut
// a continuous sound; the beeps and the chime keep working beside it.
//
// `kind` is 'rest' (four slow chords that swell and fade, with a faint bell now and then). There used to be a second
// one, a training beat that ran under every set; the workout's own music (lib/music.js) took its place.
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

const CHORDS = [[45, 52, 55, 59, 60], [41, 48, 52, 57], [48, 55, 59, 64], [43, 50, 52, 59]]   // Am9, Fmaj7, Cmaj7, G6
const BELLS = [72, 76, 79, 81, 84]
const CHORD_SEC = 8

export const KINDS = ['rest']
const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export function createAmbient({ ctxFactory, setIntervalFn = setInterval, clearIntervalFn = clearInterval, random = Math.random } = {}) {
  let ctx = null, master = null
  let volume = 0.5
  let limited = false
  const headroom = () => (limited ? 1.15 : 0.5)
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
    // The layers add up, so the master used to sit at half the chosen volume and the music was faint even at
    // the top. A limiter after it catches the peaks, which lets the level be much higher without clipping.
    limited = typeof ctx.createDynamicsCompressor === 'function'
    master.gain.value = volume * headroom()
    if (limited) {
      const lim = ctx.createDynamicsCompressor()
      lim.threshold.value = -9; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.15
      master.connect(lim); lim.connect(ctx.destination)
    } else master.connect(ctx.destination)
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

  /* ---- the kind: schedules whatever falls before `until` ---- */
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
    if (v.next < now) v.next = now + 0.05
    while (v.next < now + LOOKAHEAD) {
      if (v.chordAt <= v.next) { playChord(v, v.chordIdx++, v.next); v.chordAt = v.next + CHORD_SEC }
      if (v.bellAt <= v.next) { note(v, A(BELLS[Math.floor(random() * BELLS.length)]), v.next, 3.2, { peak: 0.05, attack: 0.02 }); v.bellAt = v.next + 3 + random() * 4 }
      v.next += 0.25; v.step++
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
      master.gain.setTargetAtTime(volume * headroom(), ctx.currentTime, 0.1)
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
      if (ctx && master) master.gain.setTargetAtTime(volume * headroom(), ctx.currentTime, 0.1)
    },
    kind: () => (current && !current.dying ? current.kind : null),
  }
}

/** The one the app uses. */
export const ambient = createAmbient()
