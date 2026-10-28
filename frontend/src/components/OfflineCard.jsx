// "Offline" in Settings > About & updates: whether the app can start without a network (checked by the worker against
// its own cache), a button to complete what is missing, and one to rebuild the app's cache. See lib/offline-status.js.
import { useCallback, useEffect, useState } from 'react'
import { useLang, getLang } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { Section, Row } from './ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import { useOnline } from './ServerSync.jsx'
import { offlineCopy, offlineSupported, getOfflineStatus, repairOffline, resetOfflineCache } from '../lib/offline-status.js'

const ICON = { ready: ['checkCircle', 'var(--green)'], partial: ['warning', 'var(--orange)'], none: ['warning', 'var(--red)'], unknown: ['info', 'var(--grey)'], checking: ['info', 'var(--grey)'], unsupported: ['info', 'var(--grey)'] }

export default function OfflineCard() {
  useLang()
  const c = offlineCopy(getLang())
  const online = useOnline()
  const [st, setSt] = useState({ state: 'checking' })
  const [busy, setBusy] = useState(false)
  const lang = getLang()

  const refresh = useCallback(async () => { setSt(await getOfflineStatus(lang)) }, [lang])
  useEffect(() => {
    refresh()
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null
    sw?.addEventListener?.('controllerchange', refresh)
    return () => sw?.removeEventListener?.('controllerchange', refresh)
  }, [refresh])

  if (!offlineSupported()) return null

  const toast = m => useUI.getState().toast(m)
  const complete = async () => {
    setBusy(true)
    setSt(await repairOffline(lang))
    setBusy(false)
  }
  const reallyReset = async () => {
    setBusy(true)
    const r = await resetOfflineCache(lang)
    setBusy(false)
    if (!r.ok) {
      toast(r.error === 'offline' ? c.errOffline : r.error === 'newer' ? c.errNewer : r.error === 'no-worker' ? c.errNoWorker : c.errFailed)
      refresh()
      return
    }
    setSt(r)
    toast(r.state === 'ready' ? c.done : c.doneNotReady)
  }
  const reset = () => confirmSheet({ title: c.confirmTitle, message: c.confirmBody, confirmText: c.confirmOk, danger: true, onConfirm: reallyReset })

  const state = st.state
  const [icon, tint] = ICON[state] || ICON.unknown
  const missing = (st.lazy || 0) + (st.lang || 0) + (st.shell > 0 ? st.shell : 0)
  const about = state === 'ready' ? c.readyAbout
    : state === 'partial' ? c.partialAbout.replace('{0}', String(missing))
    : state === 'none' ? c.noneAbout
    : state === 'unsupported' ? c.unsupportedAbout
    : state === 'unknown' ? c.unknownAbout : ''
  return (
    <Section title={c.title} footer={c.footer}>
      <Row icon={icon} iconTint={tint} title={c[state] || c.unknown} subtitle={about} />
      {(state === 'partial') && <Row icon="download" iconTint="var(--blue)" title={c.complete} accessory="chevron" onClick={busy || !online ? undefined : complete} />}
      <Row icon="info" iconTint="var(--grey)" title={c.check} accessory="chevron" onClick={busy ? undefined : refresh} />
      <Row icon="trash" iconTint="var(--red)" title={c.reset} accessory="chevron" danger onClick={busy || !online ? undefined : reset} />
    </Section>
  )
}
