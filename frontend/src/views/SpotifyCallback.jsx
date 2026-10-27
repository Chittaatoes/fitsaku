import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { takeSpotifyReturn, spotifyCallback, spotifyMessage } from '../lib/spotify.js'
import { Button } from '../components/ui.jsx'

/* Where Spotify's redirect ends up (lib/spotify.js moved its parameters here before the app
   started). It sends them to the server, which checks the state and exchanges the code; "connected"
   is shown only once the server says so. */
export default function SpotifyCallback() {
  const nav = useNavigate()
  const [state, setState] = useState('working')     // working | ok | error
  const [message, setMessage] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return           // StrictMode runs effects twice; the return is read once
    started.current = true
    const ret = takeSpotifyReturn()
    if (!ret || (!ret.code && !ret.error)) { setState('error'); setMessage(t('There is no Spotify sign-in to finish. Start again from Profile.')); return }
    spotifyCallback(ret).then(
      () => { setState('ok'); setTimeout(() => nav('/profile', { replace: true }), 1200) },
      e => { setState('error'); setMessage(spotifyMessage(e)) },
    )
  }, [nav])

  return <div className="narrow">
    <div className="hdr"><h1>Spotify</h1></div>
    <div className="card" role="status">
      {state === 'working' && <p>{t('Finishing the Spotify connection…')}</p>}
      {state === 'ok' && <p>{t('Spotify is connected.')}</p>}
      {state === 'error' && <>
        <p>{t('Spotify was not connected.')}</p>
        <p className="small muted">{message}</p>
        <Button variant="primary" onClick={() => nav('/profile', { replace: true })}>{t('Back to Profile')}</Button>
      </>}
    </div>
  </div>
}
