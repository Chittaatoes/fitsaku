// Spotify, from the app's side. Every call goes to REPO's own API (api/spotify.js), which holds
// the tokens: nothing in this file, or anywhere in the browser, ever sees one. What the browser
// does hold is the OAuth redirect's `code` and `state` for the moment between Spotify sending the
// user back and the server exchanging them, and captureSpotifyReturn() takes them off the URL
// before anything else runs.
import { api } from './api.js'
import { t } from './i18n.js'

const RETURN_KEY = 'spotify_return'
const PENDING_KEY = 'spotify_pending'
const CALLBACK_PATH = /\/spotify\/callback\/?$/

/** The redirect lands on a path (/spotify/callback?code=…&state=…) but the app routes on the hash.
 *  Called once at boot, before the app reads the URL: moves the parameters into sessionStorage and
 *  rewrites the address to the hash route, so the code is not left in the address bar or history.
 *  Returns true when it took a return. */
export function captureSpotifyReturn(loc = globalThis.location, hist = globalThis.history, store = globalThis.sessionStorage) {
  try {
    if (!loc) return false
    const onPath = CALLBACK_PATH.test(loc.pathname)
    const q = new URLSearchParams(loc.search)
    // The web container sends an unknown path to the app root *with* the query (web/nginx.conf.template
    // @root), so the return can also land on the root. It is taken only when this tab started a
    // connection a moment ago (the pending flag) and the query looks like Spotify's.
    const viaRoot = !onPath && store.getItem(PENDING_KEY) === '1' && q.has('state') && (q.has('code') || q.has('error'))
    if (!onPath && !viaRoot) return false
    store.removeItem(PENDING_KEY)
    store.setItem(RETURN_KEY, JSON.stringify({ code: q.get('code') || '', state: q.get('state') || '', error: q.get('error') || '' }))
    const base = onPath ? loc.pathname.replace(CALLBACK_PATH, '/') : loc.pathname
    hist.replaceState(null, '', base + '#/spotify/callback')
    return true
  } catch { return false }
}

/** What captureSpotifyReturn kept, once: reading it removes it. */
export function takeSpotifyReturn(store = globalThis.sessionStorage) {
  try {
    const raw = store.getItem(RETURN_KEY)
    store.removeItem(RETURN_KEY)
    const r = raw ? JSON.parse(raw) : null
    return r && typeof r === 'object' ? r : null
  } catch { return null }
}

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })

export const spotifyStatus = () => api('/api/spotify/status')
export async function spotifyConnect() {
  const r = await post('/api/spotify/connect')
  try { globalThis.sessionStorage.setItem(PENDING_KEY, '1') } catch { /* private mode: the path form still works */ }
  return r
}
export const spotifyCallback = ret => post('/api/spotify/callback', ret)
export const spotifyDisconnect = () => post('/api/spotify/disconnect')
export const spotifyPlaylists = (offset = 0, limit = 20) => api(`/api/spotify/playlists?offset=${offset}&limit=${limit}`)
export const spotifyPlayer = () => api('/api/spotify/player')
export const spotifyDevices = () => api('/api/spotify/devices')
export const spotifyPlay = (body = {}) => post('/api/spotify/player/play', body)
export const spotifyPause = () => post('/api/spotify/player/pause')
export const spotifyNext = () => post('/api/spotify/player/next')
export const spotifyPrevious = () => post('/api/spotify/player/previous')
export const spotifyTransfer = (device_id, play = true) => post('/api/spotify/player/transfer', { device_id, play })

/** The words for a failure, by the server's class. The server's own text is never shown. */
export function spotifyMessage(e) {
  const code = e?.data?.code
  switch (code) {
    case 'not_configured': return t('Spotify is not set up on this server yet.')
    case 'denied': return t('Spotify access was not granted.')
    case 'state': return t('That Spotify sign-in expired or was already used. Try connecting again.')
    case 'exchange': case 'failed': return t('Spotify did not complete the connection. Try again.')
    case 'reauth': case 'not_connected': return t('Your Spotify connection ended. Connect again to continue.')
    case 'premium': return t('Controlling playback needs Spotify Premium. You can still open music in Spotify.')
    case 'forbidden': return t('Spotify refused this request. This account may not be allowed for this app, or a permission is missing.')
    case 'no_device': return t('No Spotify device is active. Open Spotify on a phone or computer, then try again.')
    case 'storage': return t('REPO could not store the Spotify connection securely on this server.')
    case 'not_found': return t('Spotify could not find that.')
    case 'rate_limited': return t('Spotify is limiting requests. Try again in {0} s.', e?.data?.retryAfter || 5)
    case 'unavailable': return t('Spotify is not reachable right now.')
    default:
      if (e?.status === 401) return t('Sign in to REPO to use Spotify.')
      if (e?.status === 0 || e?.code === 'timeout' || e?.code === 'not-paired' || e?.status === undefined) return t('Spotify is not reachable right now.')
      return t('Something went wrong with Spotify.')
  }
}

/** Seconds to wait before the next request, when the failure was a rate limit. */
export const retryAfter = e => (e?.data?.code === 'rate_limited' ? Math.max(1, Number(e.data.retryAfter) || 5) : 0)

/** The smallest record kept of the chosen workout playlist: an id and what is needed to show it. */
export const playlistRef = p => ({ id: p.id, uri: p.uri, name: p.name, image: p.image || null, url: p.url || null })
