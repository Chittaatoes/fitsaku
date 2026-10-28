// What sits over whichever page the person is on: "FitSaku was just updated" (a new build took over, or a push says
// so) and, once, the offer to allow notifications. See lib/app-notices.js for when each shows.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useLang } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { enablePush, pushSupported, pushPermission } from '../lib/push.js'
import { noticeCopy, shouldAskNotifications, askedAt, rememberAsked, watchAppUpdates } from '../lib/app-notices.js'

const ASK_DELAY_MS = 2500   // after the app has drawn, not over its first frame

export default function AppNotices() {
  useLang()
  const user = useStore(s => s.user)
  const ready = useStore(s => s.ready)
  const [updated, setUpdated] = useState(false)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)
  const c = noticeCopy()

  useEffect(() => (MOBILE ? undefined : watchAppUpdates(() => setUpdated(true))), [])

  useEffect(() => {
    if (MOBILE || !ready) return undefined
    const go = shouldAskNotifications({ supported: pushSupported(), permission: pushPermission(), signedIn: !!user, askedAt: askedAt() })
    if (!go) { setAsk(false); return undefined }
    const t = setTimeout(() => setAsk(true), ASK_DELAY_MS)
    return () => clearTimeout(t)
  }, [ready, user?.id])

  const allow = async () => {
    setBusy(true)
    try { await enablePush(); useUI.getState().toast(c.on) }
    catch { useUI.getState().toast(c.failed) }
    rememberAsked()
    setBusy(false); setAsk(false)
  }
  const later = () => { rememberAsked(); setAsk(false) }

  if (updated) {
    return (
      <div className="app-notice" role="status">
        <div className="an-text"><b>{c.updated}</b></div>
        <button className="an-btn primary" onClick={() => location.reload()}>{c.reload}</button>
        <button className="an-x" aria-label="×" onClick={() => setUpdated(false)}>×</button>
      </div>
    )
  }
  if (ask) {
    return (
      <div className="app-notice" role="dialog" aria-label={c.askTitle}>
        <div className="an-text"><b>{c.askTitle}</b><span>{c.askBody}</span></div>
        <div className="an-row">
          <button className="an-btn" disabled={busy} onClick={later}>{c.later}</button>
          <button className="an-btn primary" disabled={busy} onClick={allow}>{c.allow}</button>
        </div>
      </div>
    )
  }
  return null
}
