import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import {
  spotifyStatus, spotifyPlayer, spotifyDevices, spotifyPlay, spotifyPause, spotifyNext, spotifyPrevious,
  spotifyTransfer, spotifyMessage, retryAfter,
} from '../lib/spotify.js'
import Icon from './Icon.jsx'
import AmbientControls from './AmbientControls.jsx'
import { useUI } from '../store/useUI.js'

const POLL_MS = 10000      // while open and visible; nothing is requested while it is folded
const SETTLE_MS = 800      // after a command, before the state is read back

/* The workout's music row. Folded by default: a line with the chosen playlist and a chevron, and
   not a single request until it is opened. Open, it shows what Spotify says is playing and the
   controls for the user's own Spotify Connect device. Nothing here starts music by itself, and
   nothing here is read by the workout: a failure only changes what this panel says. */
export default function MusicPanel() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const playlist = useStore(s => s.S.spotifyPlaylist)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)       // null = not asked yet / asking
  const [player, setPlayer] = useState(null)
  const [devices, setDevices] = useState(null)
  const [error, setError] = useState('')
  const [errCode, setErrCode] = useState('')
  const [busy, setBusy] = useState(false)
  const pause = useRef(0)                          // no request before this time (a rate limit)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const fail = useCallback(e => {
    if (!alive.current) return
    const wait = retryAfter(e)
    if (wait) pause.current = Date.now() + wait * 1000
    if (e?.data?.code === 'reauth' || e?.data?.code === 'not_connected') { setStatus(s => ({ ...(s || {}), connected: false })); useUI.setState({ extMusic: false }) }
    setError(spotifyMessage(e)); setErrCode(e?.data?.code || '')
  }, [])

  const readPlayer = useCallback(async () => {
    if (Date.now() < pause.current) return
    try {
      const p = await spotifyPlayer()
      if (!alive.current) return
      setPlayer(p); setError(''); setErrCode('')
      useUI.setState({ extMusic: !!(p.active && p.playing) })    // the built-in sound stays quiet while this plays
    } catch (e) { fail(e) }
  }, [fail])

  // Opening asks for the status once, and for playback if connected.
  useEffect(() => {
    if (!open || !user) return
    let off = false
    spotifyStatus().then(s => { if (!off) { setStatus(s); if (s.connected) readPlayer() } }).catch(e => { if (!off) { setStatus({ configured: true, connected: false, failed: true }); fail(e) } })
    return () => { off = true }
  }, [open, user, readPlayer, fail])

  // Light polling while open, connected and the page is showing.
  useEffect(() => {
    if (!open || !status?.connected) return
    const id = setInterval(() => { if (document.visibilityState !== 'hidden') readPlayer() }, POLL_MS)
    return () => clearInterval(id)
  }, [open, status?.connected, readPlayer])

  // A command, then the state as Spotify reports it: success is what the player says afterwards.
  const run = async fn => {
    if (busy) return
    if (Date.now() < pause.current) { setError(t('Spotify is limiting requests. Try again in {0} s.', Math.ceil((pause.current - Date.now()) / 1000))); return }
    setBusy(true); setError('')
    try {
      await fn()
      await new Promise(r => setTimeout(r, SETTLE_MS))
      await readPlayer()
    } catch (e) { fail(e) }
    finally { if (alive.current) setBusy(false) }
  }

  const loadDevices = async () => {
    setError('')
    try { const d = await spotifyDevices(); if (alive.current) setDevices(d.devices || []) } catch (e) { fail(e) }
  }
  const useDevice = id => run(async () => { await spotifyTransfer(id, true); setDevices(null) })

  const startPlaylist = () => run(() => spotifyPlay({ context_uri: playlist.uri, ...(player?.device?.id ? { device_id: player.device.id } : {}) }))
  const noDevice = errCode === 'no_device'
  const track = player?.track
  const label = playlist ? playlist.name : t('Music')

  return <div className="musicpanel" data-testid="music-panel">
    <button type="button" className="musicpanel-bar" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <Icon name="speaker" />
      <span className="musicpanel-t">{playlist ? <><span className="muted small">{t('Music')} · </span>{label}</> : label}</span>
      {open && track && player?.playing && <span className="tag acc nocap">{t('Playing')}</span>}
      <Icon name={open ? 'chevronUp' : 'chevronDown'} />
    </button>

    {open && <div className="musicpanel-body">
      {!user ? <p className="small muted">{t('Sign in to REPO to use Spotify.')}</p>
        : !status ? <p className="small muted">{t('Loading…')}</p>
        : !status.configured ? <p className="small muted">{t('Spotify is not set up on this server yet.')}</p>
        : !status.connected ? <>
          <p className="small muted">{t('Connect Spotify to pick workout music. Your workout works without it.')}</p>
          <button type="button" className="btn tinted sm" onClick={() => nav('/profile')}>{t('Connect Spotify')}</button>
        </> : <>
          {track ? <div className="musicpanel-track">
            {track.image ? <img src={track.image} alt="" width="48" height="48" loading="lazy" /> : <span className="musicpanel-art"><Icon name="speaker" /></span>}
            <div className="musicpanel-meta">
              <div className="musicpanel-name">{track.name}</div>
              <div className="small muted">{track.artists.join(', ')}</div>
              {player?.device?.name && <div className="small muted">{t('on {0}', player.device.name)}</div>}
            </div>
            {track.url && <a className="btn ghost sm" href={track.url} target="_blank" rel="noopener noreferrer" aria-label={t('Open in Spotify')}><Icon name="share" /></a>}
          </div> : <p className="small muted">{player && !player.active ? t('Nothing is playing on Spotify.') : player ? t('Spotify is connected, but there is no track to show.') : t('Loading…')}</p>}

          <div className="musicpanel-ctl">
            <button type="button" className="iconbtn" disabled={busy || !player?.active} aria-label={t('Previous track')} onClick={() => run(spotifyPrevious)}><Icon name="skipForward" style={{ transform: 'scaleX(-1)' }} /></button>
            {player?.playing
              ? <button type="button" className="btn primary sm" disabled={busy} onClick={() => run(spotifyPause)}><Icon name="pause" /><span>{t('Pause')}</span></button>
              : track && player?.active
                ? <button type="button" className="btn primary sm" disabled={busy} onClick={() => run(() => spotifyPlay({}))}><Icon name="play" /><span>{t('Resume')}</span></button>
                : <button type="button" className="btn primary sm" disabled={busy || !playlist} onClick={startPlaylist}><Icon name="play" /><span>{t('Play')}</span></button>}
            <button type="button" className="iconbtn" disabled={busy || !player?.active} aria-label={t('Next track')} onClick={() => run(spotifyNext)}><Icon name="skipForward" /></button>
          </div>

          {playlist && <div className="musicpanel-pl">
            <span className="small muted">{t('Workout playlist')}:</span> <strong className="small">{playlist.name}</strong>
            <span className="row" style={{ gap: 6, marginTop: 6 }}>
              <button type="button" className="chip" disabled={busy} onClick={startPlaylist}>{t('Play this playlist')}</button>
              {playlist.url && <a className="chip" href={playlist.url} target="_blank" rel="noopener noreferrer">{t('Open in Spotify')}</a>}
            </span>
          </div>}
          {!playlist && <p className="small muted">{t('Pick a workout playlist in Profile.')} <button type="button" className="chip" onClick={() => nav('/profile')}>{t('Profile')}</button></p>}

          {(noDevice || (player && !player.active)) && <button type="button" className="chip" disabled={busy} onClick={loadDevices}>{t('Choose a device')}</button>}
          {devices && (devices.length
            ? <ul className="musicpanel-devs">{devices.map(d => <li key={d.id}><button type="button" className="chip" disabled={busy || d.restricted} onClick={() => useDevice(d.id)}>{d.name}{d.restricted ? ' · ' + t('restricted') : ''}</button></li>)}</ul>
            : <p className="small muted">{t('No Spotify devices found. Open Spotify on a phone or computer.')}</p>)}
        </>}

      <AmbientControls compact />
      {error && <p className="small musicpanel-err" role="status">{error}</p>}
    </div>}
  </div>
}
