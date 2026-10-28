import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { music } from '../lib/music.js'
import { ambientKindFor, ambientVolumeOf } from '../lib/ambient-plan.js'

/* Renders nothing. The workout's own music (lib/music.js) follows the session:
   - when a workout of your own begins (not the editor of a saved one, not one logged into the past) it starts from the
     first song, playing it unless "Play music in a workout" is off or the app's Sound setting is;
   - while a rest counts down it is paused, and the calm rest sound (components/AmbientController.jsx) plays instead; when the
     rest is over it carries on from where it stopped. Music that was already paused by the person stays paused;
   - when the workout ends it stops.
   What counts as a rest is the same answer the rest sound uses (lib/ambient-plan.js), so the one stops as the other starts.
   Mounted once, beside the rest sound. */
export default function MusicController() {
  const active = useStore(s => s.S.active)
  const auto = useStore(s => s.S.musicAuto !== false)
  const sound = useStore(s => !!s.S.sound)
  const vol = useStore(s => ambientVolumeOf(s.S))
  const timer = useUI(s => s.timer)
  const live = !!active && !active.editingWorkoutId && !active.backfill
  const resting = ambientKindFor({ active, timer, soundOn: sound }) === 'rest'
  const wasLive = useRef(false)
  const pausedForRest = useRef(false)

  // The volume slider in the workout sound settings is the music's volume. Before the session effect below, so a song
  // that starts with the session starts at it.
  useEffect(() => { music.setVolume(vol) }, [vol])
  useEffect(() => {
    if (live && !wasLive.current) music.start({ autoplay: auto && sound })
    if (!live && wasLive.current) { music.stop(); pausedForRest.current = false }
    wasLive.current = live
  }, [live])                                                   // eslint-disable-line react-hooks/exhaustive-deps
  // A rest begins: the music gives way. It ends: the music, if it was playing, carries on.
  useEffect(() => {
    if (!live) return
    if (resting) {
      if (music.state.playing) { music.pause(); pausedForRest.current = true }
    } else if (pausedForRest.current) {
      pausedForRest.current = false
      music.play()
    }
  }, [resting, live])
  // Unmounting stops the music and forgets that a session was running, so a remount (React StrictMode runs every effect
  // twice in development) starts it again rather than finding the session already counted.
  useEffect(() => () => { music.stop(); wasLive.current = false; pausedForRest.current = false }, [])
  return null
}
