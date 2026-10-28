// Whether the workout is resting, as far as the sound goes: pure, so the rules are tested without any audio.
//
// A workout has two moments. Training (a set under way, or a rest that is over): the workout's own music plays
// (lib/music.js, components/MusicController.jsx). Resting (the rest timer counting down): the music pauses and the
// built-in calm rest sound plays (lib/ambient.js, components/AmbientController.jsx). Both read the answer here, so
// the one stops exactly when the other starts.
//
// Nothing plays unless there is a live workout of the user's own (not the editor of a saved one, not one logged
// into the past) and the app's Sound setting is on. A paused rest, a finished one ("Ready") and the short
// "switch sides" gap count as training. The volume is one setting for both. (The older 'off' / 'rest' / 'all'
// choice that sat here is gone with the training beat it chose between: S.ambient is no longer read.)

export const ambientVolumeOf = S => (Number.isFinite(S?.ambientVol) ? Math.min(1, Math.max(0, S.ambientVol)) : 0.8)

/** 'rest' while the rest sound belongs to the moment, null otherwise. */
export function ambientKindFor({ active, timer, soundOn }) {
  if (!soundOn) return null
  if (!active || active.editingWorkoutId || active.backfill) return null
  const resting = !!timer && !timer.ready && !timer.paused && timer.kind !== 'switch'
  return resting ? 'rest' : null
}
