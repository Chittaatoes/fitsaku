import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ambient } from '../lib/ambient.js'
import { ambientKindFor, ambientSettingOf, ambientVolumeOf } from '../lib/ambient-plan.js'

/* Renders nothing. Keeps the built-in workout sound (lib/ambient.js) in step with the app: the
   training sound while a session runs, the calm one while a rest counts down, silence otherwise.
   The rules are in lib/ambient-plan.js. It is mounted once, beside the rest timer. */
export default function AmbientController() {
  const active = useStore(s => s.S.active)
  const sound = useStore(s => !!s.S.sound)
  const setting = useStore(s => ambientSettingOf(s.S))
  const vol = useStore(s => ambientVolumeOf(s.S))
  const timer = useUI(s => s.timer)
  const external = useUI(s => s.extMusic)

  // What the moment calls for. The timer object changes every second, so the effect keys on the
  // fields the rule reads, not on the object.
  const kind = ambientKindFor({ active, timer, setting, soundOn: sound, external })
  useEffect(() => {
    if (kind) ambient.play(kind, vol)
    else ambient.stop()
  }, [kind])                                                   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ambient.setVolume(vol) }, [vol])
  // The music (components/MusicController.jsx) stops with the session: forget that it was playing.
  useEffect(() => { if (!active && useUI.getState().extMusic) useUI.setState({ extMusic: false }) }, [active])
  useEffect(() => () => ambient.stop(0.2), [])
  return null
}
