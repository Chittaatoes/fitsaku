import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import {
  spotifyStatus, spotifyConnect, spotifyDisconnect, spotifyPlaylists, spotifyMessage, playlistRef,
} from '../lib/spotify.js'
import { confirmSheet } from '../sheets.jsx'
import { Section, Button } from './ui.jsx'
import Icon from './Icon.jsx'

const PAGE = 20

/* Profile's Spotify card. What it shows is what the server says: connected or not comes from
   /api/spotify/status, never from a flag kept here. */
export default function SpotifyCard() {
  const user = useStore(s => s.user)
  const playlist = useStore(s => s.S.spotifyPlaylist)
  const update = useStore(s => s.update)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [browse, setBrowse] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try { setStatus(await spotifyStatus()) } catch (e) { setStatus({ failed: true }); setError(spotifyMessage(e)) }
  }, [])
  useEffect(() => { if (user) load() }, [user, load])

  const connect = async () => {
    setBusy(true); setError('')
    try { const { url } = await spotifyConnect(); window.location.assign(url) }
    catch (e) { setError(spotifyMessage(e)); setBusy(false) }
  }
  const disconnect = () => confirmSheet({
    title: t('Disconnect Spotify?'),
    message: t('REPO forgets your Spotify connection on the server. Your chosen playlist stays, and you can connect again any time.'),
    confirmText: t('Disconnect Spotify'),
    onConfirm: async () => {
      try { setStatus(await spotifyDisconnect()); setBrowse(false); setError('') } catch (e) { setError(spotifyMessage(e)) }
    },
  })

  const body = () => {
    if (!user) return <p className="small muted">{t('Sign in to REPO to connect Spotify. Guest data stays on this device.')}</p>
    if (!status) return <p className="small muted">{t('Loading…')}</p>
    if (status.failed) return <Button size="sm" variant="tinted" onClick={load}>{t('Try again')}</Button>
    if (!status.configured) return <p className="small muted">{t('Spotify is not set up on this server yet. The person running it adds a Spotify client ID and redirect address (see docs/spotify-integration.md).')}</p>
    if (!status.connected) return <>
      <p className="small muted">{t('Pick workout music and control your Spotify player from REPO. You approve access on Spotify’s own page; REPO never sees your Spotify password.')}</p>
      <ul className="small muted spot-scopes">
        <li>{t('Read your playlists, to let you choose one')}</li>
        <li>{t('Read and control playback, on a device you already use')}</li>
        <li>{t('Read your plan type, to explain when Premium is needed')}</li>
      </ul>
      <Button variant="primary" disabled={busy} onClick={connect}>{t('Connect Spotify')}</Button>
      <p className="small muted">{t('REPO works fully without Spotify.')}</p>
    </>
    return <>
      <div className="row between" style={{ gap: 8 }}>
        <div>
          <div className="spot-name">{status.account?.name || t('Connected')}</div>
          <div className="small muted">
            {t('Connected')}{status.account?.product ? ' · ' + (status.account.product === 'premium' ? t('Premium') : t('Free plan')) : ''}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={disconnect}>{t('Disconnect Spotify')}</Button>
      </div>
      {status.account?.product && status.account.product !== 'premium' && <p className="small muted">{t('Controlling playback needs Spotify Premium. You can still open music in Spotify.')}</p>}
      {status.missingScopes?.length > 0 && <div className="spot-warn">
        <p className="small">{t('Some permissions were not granted, so a few controls may not work.')}</p>
        <Button size="sm" variant="tinted" disabled={busy} onClick={connect}>{t('Reconnect Spotify')}</Button>
      </div>}

      <div className="spot-pl">
        <div className="small muted">{t('Workout playlist')}</div>
        {playlist ? <div className="spot-sel">
          {playlist.image ? <img src={playlist.image} alt="" width="40" height="40" loading="lazy" /> : <span className="spot-art"><Icon name="speaker" /></span>}
          <strong>{playlist.name}</strong>
          <span className="row" style={{ gap: 6 }}>
            {playlist.url && <a className="chip" href={playlist.url} target="_blank" rel="noopener noreferrer">{t('Open in Spotify')}</a>}
            <button type="button" className="chip" onClick={() => update(s => { s.spotifyPlaylist = null })}>{t('Clear')}</button>
          </span>
        </div> : <p className="small muted">{t('None chosen yet.')}</p>}
        <Button size="sm" variant="tinted" onClick={() => setBrowse(b => !b)}>{browse ? t('Hide playlists') : playlist ? t('Change playlist') : t('Choose a playlist')}</Button>
        {browse && <Playlists chosen={playlist} onPick={p => { update(s => { s.spotifyPlaylist = playlistRef(p) }); setBrowse(false) }} onAuthLost={load} />}
      </div>
    </>
  }

  return <Section title="Spotify">
    <div className="card spot-card">
      {body()}
      {error && <p className="small spot-err" role="status">{error}</p>}
    </div>
  </Section>
}

/** The user's playlists, a page at a time. */
function Playlists({ chosen, onPick, onAuthLost }) {
  const [items, setItems] = useState([])
  const [next, setNext] = useState(0)          // offset of the next page; null when there is none
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')

  const more = useCallback(async offset => {
    setState('loading'); setError('')
    try {
      const page = await spotifyPlaylists(offset, PAGE)
      setItems(cur => (offset === 0 ? page.items : [...cur, ...page.items]))
      setNext(page.next)
      setState('ready')
    } catch (e) {
      setError(spotifyMessage(e)); setState('error')
      if (e?.data?.code === 'reauth') onAuthLost()
    }
  }, [onAuthLost])
  useEffect(() => { more(0) }, [more])

  return <div className="spot-list">
    {state === 'ready' && !items.length && <div>
      <p className="small muted">{t('No playlists on this Spotify account yet.')}</p>
      <a className="chip" href="https://open.spotify.com" target="_blank" rel="noopener noreferrer">{t('Open Spotify')}</a>
    </div>}
    {items.map(p => <div key={p.id} className="spot-item">
      {p.image ? <img src={p.image} alt="" width="44" height="44" loading="lazy" /> : <span className="spot-art"><Icon name="speaker" /></span>}
      <div className="spot-item-m">
        <div className="spot-item-t">{p.name}</div>
        <div className="small muted">{[p.owner, p.tracks != null ? t('{0} tracks', p.tracks) : null].filter(Boolean).join(' · ')}</div>
      </div>
      <span className="row" style={{ gap: 6 }}>
        {p.url && <a className="chip" href={p.url} target="_blank" rel="noopener noreferrer" aria-label={t('Open in Spotify')}><Icon name="share" /></a>}
        <button type="button" className={'chip' + (chosen?.id === p.id ? ' on' : '')} onClick={() => onPick(p)}>{chosen?.id === p.id ? t('Selected') : t('Choose')}</button>
      </span>
    </div>)}
    {state === 'loading' && <p className="small muted">{t('Loading…')}</p>}
    {state === 'error' && <div><p className="small spot-err" role="status">{error}</p><button type="button" className="chip" onClick={() => more(items.length ? next ?? 0 : 0)}>{t('Try again')}</button></div>}
    {state === 'ready' && next != null && <button type="button" className="chip" onClick={() => more(next)}>{t('Load more')}</button>}
  </div>
}
