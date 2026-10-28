import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ambient } from '../lib/ambient.js'
import { ambientKindFor, ambientVolumeOf } from '../lib/ambient-plan.js'

/* Renders nothing. Keeps the built-in rest sound (lib/ambient.js) in step with the app: the calm sound while a rest
   counts down, silence otherwise. The rules are in lib/ambient-plan.js. It is mounted once, beside the rest timer. */
export default function AmbientController() {
  const active = useStore(s => s.S.active)
  const sound = useStore(s => !!s.S.sound)
  const vol = useStore(s => ambientVolumeOf(s.S))
  const timer = useUI(s => s.timer)

  // What the moment calls for. The timer object changes every second, so the effect keys on the
  // fields the rule reads, not on the object.
  const kind = ambientKindFor({ active, timer, soundOn: sound })
  useEffect(() => {
    if (kind) ambient.play(kind, vol)
    else ambient.stop()
  }, [kind])                                                   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ambient.setVolume(vol) }, [vol])
  useEffect(() => () => ambient.stop(0.2), [])
  return null
}
