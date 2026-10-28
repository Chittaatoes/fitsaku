// Today's date on the person's own clock, kept current: a screen left open across midnight (or the app left in the
// background overnight) moves to the new day instead of showing the old one until something else redraws it.
import { useEffect, useState } from 'react'
import { todayISO } from './format.js'

/** Milliseconds from `now` to the next local midnight. */
export function msToNextMidnight(now = new Date()) {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return next.getTime() - now.getTime()
}

export function useLocalToday() {
  const [today, setToday] = useState(todayISO)
  useEffect(() => {
    let tm = null
    const sync = () => setToday(todayISO())
    const arm = () => {
      clearTimeout(tm)
      tm = setTimeout(() => { sync(); arm() }, msToNextMidnight() + 50)
    }
    const back = () => { if (document.visibilityState !== 'hidden') { sync(); arm() } }
    arm()
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      clearTimeout(tm)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [])
  return today
}
