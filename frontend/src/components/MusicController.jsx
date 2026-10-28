import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { music } from '../lib/music.js'

/* Renders nothing. The workout's own music (lib/music.js) follows the session: when a workout of your own begins (not the
   editor of a saved one, not one logged into the past) it starts from the first song, playing it unless "Play music in a
   workout" is off or the app's Sound setting is; when the workout ends it stops. Mounted once, beside the built-in sound. */
export default function MusicController() {
  const active = useStore(s => s.S.active)
  const auto = useStore(s => s.S.musicAuto !== false)
  const sound = useStore(s => !!s.S.sound)
  const live = !!active && !active.editingWorkoutId && !active.backfill
  const wasLive = useRef(false)

  useEffect(() => {
    if (live && !wasLive.current) music.start({ autoplay: auto && sound })
    if (!live && wasLive.current) music.stop()
    wasLive.current = live
  }, [live])                                                   // eslint-disable-line react-hooks/exhaustive-deps
  // Unmounting stops the music and forgets that a session was running, so a remount (React StrictMode runs every effect
  // twice in development) starts it again rather than finding the session already counted.
  useEffect(() => () => { music.stop(); wasLive.current = false }, [])
  return null
}
