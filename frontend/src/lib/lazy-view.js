// Route code-splitting that does not make navigation wait.
//
// A screen the person is not on yet does not have to be in the first download: `lazyView` loads it
// as its own chunk. To keep a tab switch instant anyway, `prefetchViews` fetches the chunks in the
// background once the app is idle (one at a time, never on a metered connection), so by the time a
// tap lands the screen is already in memory and React renders it in the same frame.
import { lazy } from 'react'

const registry = []

/** Like React.lazy, remembering how to load the screen early. */
export function lazyView(load, pick = m => m) {
  const loader = () => load().then(m => ({ default: pick(m).default ?? pick(m) }))
  const View = lazy(loader)
  View.preload = loader
  registry.push(View)
  return View
}

const idle = cb => (typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1200))

/** Fetches every registered screen, one per idle slot. Skipped when the browser asks to save data. */
export function prefetchViews(views = registry) {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null
  if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return () => {}
  let i = 0, stopped = false
  const next = () => {
    if (stopped || i >= views.length) return
    const v = views[i++]
    Promise.resolve(v.preload?.()).catch(() => {}).finally(() => idle(next))
  }
  idle(next)
  return () => { stopped = true }
}
