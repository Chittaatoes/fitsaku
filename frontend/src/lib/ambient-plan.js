// Whether the built-in rest sound (lib/ambient.js) belongs to the moment the app is in: pure, so the rules are
// tested without any audio.
//
//   setting  'off' | 'rest'. A profile from before the training beat went away may hold 'all': that is 'rest' now.
//
// Nothing plays unless there is a live workout of the user's own (not the editor of a saved one, not one logged
// into the past) and the app's Sound setting is on. A counting rest is the calm sound; a paused rest, a finished
// one ("Ready") and the short "switch sides" gap are silent, and so is everything between rests. The workout's own
// music (lib/music.js) is separate: it has its own switch and shares only the volume.

export const AMBIENT_SETTINGS = ['off', 'rest']
export const ambientSettingOf = S => (S?.ambient === 'off' ? 'off' : 'rest')
export const ambientVolumeOf = S => (Number.isFinite(S?.ambientVol) ? Math.min(1, Math.max(0, S.ambientVol)) : 0.8)

export function ambientKindFor({ active, timer, setting, soundOn }) {
  if (!soundOn || setting === 'off') return null
  if (!active || active.editingWorkoutId || active.backfill) return null
  const resting = !!timer && !timer.ready && !timer.paused && timer.kind !== 'switch'
  return resting ? 'rest' : null
}
