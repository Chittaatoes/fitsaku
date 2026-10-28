// The guide to logging a set, as a dialog in the middle of the screen (see lib/workout-tips.js): shown once by
// <WorkoutTipsOnce /> on the first workout, and again from Settings > About whenever it is wanted.
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useLang } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { tipsCopy, tipsSeen, markTipsSeen, shouldShowWorkoutTips } from '../lib/workout-tips.js'

function WorkoutTips({ close }) {
  useLang()
  const c = tipsCopy()
  return (
    <div className="wtip" role="dialog" aria-label={c.title}>
      <div className="wtip-ic"><Icon name="lightbulb" /></div>
      <h3>{c.title}</h3>
      <ol className="wtip-steps">
        <li>
          <span className="wtip-vis" aria-hidden="true"><span className="wtip-chk"><Icon name="check" /></span></span>
          <span>{c.s1}</span>
        </li>
        <li>
          <span className="wtip-vis" aria-hidden="true"><span className="wtip-stp"><Icon name="minus" /></span><span className="wtip-stp"><Icon name="plus" /></span></span>
          <span>{c.s2}</span>
        </li>
        <li>
          <span className="wtip-vis" aria-hidden="true"><span className="wtip-next"><Icon name="chevronRight" /></span></span>
          <span>{c.s3}</span>
        </li>
      </ol>
      <button className="btn primary" onClick={close}>{c.ok}</button>
    </div>
  )
}

export function openWorkoutTips() {
  useUI.getState().openSheet(close => <WorkoutTips close={close} />, { kind: 'center' })
}

/** Opens the guide the first time a workout is on screen on this device. Draws nothing itself. */
export function WorkoutTipsOnce() {
  const active = useStore(s => s.S.active)
  const show = shouldShowWorkoutTips({ seen: tipsSeen(), active })
  useEffect(() => {
    if (!show) return undefined
    const t = setTimeout(() => {
      // Re-judged when the moment comes: the workout may be gone, or the guide already shown from another place.
      const now = useStore.getState().S.active
      if (!shouldShowWorkoutTips({ seen: tipsSeen(), active: now }) || useUI.getState().sheets.length) return
      markTipsSeen()
      openWorkoutTips()
    }, 900)
    return () => clearTimeout(t)
  }, [show])
  return null
}
