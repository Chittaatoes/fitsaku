// The workout's own music: four songs that ship with the app (assets/music/music1.mp3 … music4.mp3, served from
// /music/ by the build: see vite.config.js fitsakuMusic), played one after the other and stepped with next / previous.
// One audio element for the whole app, so the music goes on while the screens change.
//
// Nothing here talks to a server or an account. A browser may refuse to start sound without a tap
// (autoplay rules): then `blocked` is set and the music starts on the person's next touch anywhere, or on the play button.
//
// The volume (setVolume, 0–1) is the one the person sets in the workout sound settings. Where the audio element's own `volume`
// can be set it is used. On the iPhone it cannot (the property is read-only there), so the element is routed through
// Web Audio and the volume is a gain: with that, like every other Web Audio sound of the app, the music follows the silent
// switch unless "play sounds on silent" is on (lib/sound.js).

export const TRACKS = [1, 2, 3, 4].map(n => ({ id: 'music' + n, n, src: 'music/music' + n + '.mp3' }))
const COUNT = TRACKS.length
// "Previous" within this many seconds of the start goes to the song before; later it restarts this one.
export const RESTART_AFTER_S = 3

const srcOf = (i, base) => {
  const rel = TRACKS[i].src
  try { return new URL(rel, base || (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')).href } catch { return rel }
}

const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1)
const volumeWritable = a => {
  try { const keep = a.volume; a.volume = 0.5; const ok = Math.abs(a.volume - 0.5) < 0.01; a.volume = keep; return ok } catch { return false }
}

export function createMusic({
  audioFactory = () => new Audio(), base, onPlayingChange = () => {}, doc = typeof document !== 'undefined' ? document : null,
  ctxFactory = () => { const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); return C ? new C() : null },
} = {}) {
  let audio = null
  let volume = 1
  let actx = null, gain = null            // set only where the element's own volume cannot be
  let state = { index: 0, playing: false, blocked: false, error: false }
  const subs = new Set()
  const set = patch => {
    const next = { ...state, ...patch }
    if (Object.keys(patch).every(k => state[k] === next[k])) return
    const was = state.playing
    state = next
    if (was !== state.playing) onPlayingChange(state.playing)
    subs.forEach(f => f())
  }

  // The first touch after a refused start tries again: the touch is the permission a browser wants.
  let gestureBound = false
  const bindGesture = () => {
    if (gestureBound || !doc) return
    gestureBound = true
    const go = () => {
      doc.removeEventListener('pointerup', go, true); doc.removeEventListener('keydown', go, true)
      gestureBound = false
      if (state.blocked) api.play()
    }
    doc.addEventListener('pointerup', go, true); doc.addEventListener('keydown', go, true)
  }

  // The volume goes to the element, or to the gain it is routed through.
  const applyVolume = () => {
    if (gain && actx) { try { gain.gain.setTargetAtTime(volume, actx.currentTime, 0.04) } catch { gain.gain.value = volume } }
    else if (audio) { try { audio.volume = volume } catch { /* a read-only volume: routed below */ } }
  }
  const route = a => {
    if (volumeWritable(a)) return
    try {
      actx = ctxFactory()
      if (!actx) return
      const src = actx.createMediaElementSource(a)
      gain = actx.createGain()
      src.connect(gain); gain.connect(actx.destination)
    } catch { actx = null; gain = null }
  }

  const ensure = () => {
    if (audio) return audio
    audio = audioFactory()
    audio.preload = 'none'
    route(audio)
    applyVolume()
    audio.addEventListener('play', () => set({ playing: true, blocked: false, error: false }))
    audio.addEventListener('pause', () => set({ playing: false }))
    audio.addEventListener('ended', () => api.next())
    audio.addEventListener('error', () => set({ playing: false, error: true }))
    audio.src = srcOf(state.index, base)
    mediaSession()
    return audio
  }

  // Lock screen and headset buttons, where the browser has them.
  const mediaSession = () => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null
    if (!ms || typeof ms.setActionHandler !== 'function') return
    const on = (a, f) => { try { ms.setActionHandler(a, f) } catch { /* an action this browser does not know */ } }
    on('play', () => api.play()); on('pause', () => api.pause())
    on('nexttrack', () => api.next()); on('previoustrack', () => api.prev())
  }
  const describe = () => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null
    if (!ms || typeof MediaMetadata === 'undefined') return
    try { ms.metadata = new MediaMetadata({ title: 'Music ' + TRACKS[state.index].n, artist: 'FitSaku' }) } catch { /* no metadata */ }
  }

  const load = i => {
    const a = ensure()
    set({ index: i, error: false })
    a.src = srcOf(i, base)
    describe()
  }

  const api = {
    get state() { return state },
    subscribe(f) { subs.add(f); return () => subs.delete(f) },
    /** Starts (or resumes) the song. A refusal by the browser is not an error: it waits for the next touch. */
    async play() {
      const a = ensure()
      describe()
      try {
        // A routed context starts suspended where the page has had no touch yet: the touch that gets the song going wakes it.
        if (actx && actx.state === 'suspended' && typeof actx.resume === 'function') { try { await actx.resume() } catch { /* wakes on the next touch */ } }
        await a.play()
      } catch (e) {
        if (e && e.name === 'NotAllowedError') { set({ blocked: true, playing: false }); bindGesture() }
        else if (e && e.name === 'AbortError') { /* another song, or a pause, came first: that one has its own outcome */ }
        else set({ error: true, playing: false })
      }
    },
    pause() { if (audio) audio.pause(); set({ blocked: false }) },
    /** The loudness of the music, 0–1: what the volume slider in the workout sound settings says. */
    setVolume(v) { volume = clamp01(v); applyVolume() },
    get volume() { return volume },
    toggle() { return state.playing ? api.pause() : api.play() },
    /** Next song, the first after the last. Plays it: pressing next is asking for music. */
    next() { load((state.index + 1) % COUNT); return api.play() },
    /** Restarts this song after a few seconds of it, otherwise goes back one, the last before the first. */
    prev() {
      if (audio && audio.currentTime > RESTART_AFTER_S) { audio.currentTime = 0; return api.play() }
      load((state.index + COUNT - 1) % COUNT)
      return api.play()
    },
    /** A session begins: the first song, and playing it unless `autoplay` is off. */
    start({ autoplay = true } = {}) {
      load(0)
      if (audio) audio.currentTime = 0
      return autoplay ? api.play() : Promise.resolve()
    },
    /** A session is over: stops, and the next one starts again from the first song. */
    stop() {
      if (audio) { audio.pause(); try { audio.currentTime = 0 } catch { /* not loaded yet */ } }
      set({ playing: false, blocked: false, error: false, index: 0 })
      if (audio) audio.src = srcOf(0, base)
    },
  }
  return api
}

export const music = createMusic()
