// The short answer the app gives to what you just did: an exercise or a workout added, one deleted, a
// workout finished (lib/sound.js SFX). Plays only while Sounds is on and "Action sounds" has not been
// turned off (Settings > Timer alerts); nothing to import at the call site but this one function.
import { useStore } from '../store/useStore.js'
import { sfx, setLoudness } from './sound.js'

// Both of these are wrapped: a sound module that is missing or mocked must never take a screen down with it.
export function applyLoudness(level) { try { setLoudness(level) } catch (e) { /* */ } }
export function playSfx(enabled, kind) { try { sfx(enabled, kind) } catch (e) { /* */ } }

export function actionSound(kind) {
  try {
    const S = useStore.getState().S
    if (S && S.sound && S.actionSounds !== false) sfx(true, kind)
  } catch (e) { /* a sound is never worth an error */ }
}
