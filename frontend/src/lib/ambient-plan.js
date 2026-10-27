// Which built-in sound (lib/ambient.js) belongs to the moment the app is in: pure, so the rules are
// tested without any audio.
//
//   setting  'off' | 'rest' (only while resting) | 'all' (a beat while training, calm while resting)
//
// Nothing plays unless there is a live workout of the user's own (not the editor of a saved one, not
// one logged into the past), the app's Sound setting is on, and the user is not already playing
// music from the Spotify panel (`external`). A counting rest is the calm sound; a paused rest, a
// finished one ("Ready") and the short "switch sides" gap go back to the training sound.

export const AMBIENT_SETTINGS = ['off', 'rest', 'all']
export const ambientSettingOf = S => (AMBIENT_SETTINGS.includes(S?.ambient) ? S.ambient : 'all')
export const ambientVolumeOf = S => (Number.isFinite(S?.ambientVol) ? Math.min(1, Math.max(0, S.ambientVol)) : 0.5)

export function ambientKindFor({ active, timer, setting, soundOn, external }) {
  if (!soundOn || setting === 'off' || external) return null
  if (!active || active.editingWorkoutId || active.backfill) return null
  const resting = !!timer && !timer.ready && !timer.paused && timer.kind !== 'switch'
  if (resting) return 'rest'
  return setting === 'all' ? 'workout' : null
}
