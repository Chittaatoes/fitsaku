// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { captureSpotifyReturn, takeSpotifyReturn, spotifyMessage, retryAfter, playlistRef } from './spotify.js'
import { setLang } from './i18n.js'

beforeEach(async () => { sessionStorage.clear(); history.replaceState(null, '', '/'); await setLang('en') })
afterEach(() => { sessionStorage.clear(); history.replaceState(null, '', '/') })

describe('the OAuth return', () => {
  it('moves the code and state off the address and into session storage, and points at the hash route', () => {
    history.replaceState(null, '', '/spotify/callback?code=SECRETCODE&state=STATE123')
    expect(captureSpotifyReturn()).toBe(true)
    expect(location.search).toBe('')
    expect(location.href).not.toMatch(/SECRETCODE|STATE123/)
    expect(location.pathname).toBe('/')
    expect(location.hash).toBe('#/spotify/callback')
    expect(takeSpotifyReturn()).toEqual({ code: 'SECRETCODE', state: 'STATE123', error: '' })
  })

  it('keeps a subpath deployment\'s prefix', () => {
    history.replaceState(null, '', '/gym/spotify/callback?code=C&state=S')
    captureSpotifyReturn()
    expect(location.pathname).toBe('/gym/')
  })

  it('keeps the denial Spotify sends', () => {
    history.replaceState(null, '', '/spotify/callback?error=access_denied&state=S')
    captureSpotifyReturn()
    expect(takeSpotifyReturn()).toEqual({ code: '', state: 'S', error: 'access_denied' })
  })

  it('leaves every other address alone', () => {
    history.replaceState(null, '', '/?code=abc#/home')
    expect(captureSpotifyReturn()).toBe(false)
    expect(location.search).toBe('?code=abc')
    expect(takeSpotifyReturn()).toBeNull()
  })

  it('also takes a return that an nginx redirect brought to the root, but only after this tab started a connection', () => {
    history.replaceState(null, '', '/?code=C&state=S')
    expect(captureSpotifyReturn()).toBe(false)               // nothing started: an ordinary address
    expect(location.search).toBe('?code=C&state=S')
    sessionStorage.setItem('spotify_pending', '1')
    expect(captureSpotifyReturn()).toBe(true)
    expect(location.search).toBe('')
    expect(location.hash).toBe('#/spotify/callback')
    expect(sessionStorage.getItem('spotify_pending')).toBeNull()
    expect(takeSpotifyReturn().state).toBe('S')
  })

  it('hands the return over once', () => {
    history.replaceState(null, '', '/spotify/callback?code=C&state=S')
    captureSpotifyReturn()
    expect(takeSpotifyReturn()).not.toBeNull()
    expect(takeSpotifyReturn()).toBeNull()
  })
})

describe('failures in words', () => {
  const e = (code, extra = {}) => ({ status: 400, data: { code, ...extra } })

  it('says something distinct and useful for each class the server sends', () => {
    const classes = ['storage', 'not_configured', 'denied', 'state', 'exchange', 'reauth', 'premium', 'forbidden', 'no_device', 'not_found', 'unavailable']
    const words = classes.map(c => spotifyMessage(e(c)))
    expect(new Set(words).size).toBe(classes.length)
    expect(spotifyMessage(e('premium'))).toMatch(/Premium/)
    expect(spotifyMessage(e('no_device'))).toMatch(/Open Spotify/)
  })

  it('names the wait of a rate limit and reports it for pausing', () => {
    const limited = e('rate_limited', { retryAfter: 12 })
    expect(spotifyMessage(limited)).toContain('12')
    expect(retryAfter(limited)).toBe(12)
    expect(retryAfter(e('forbidden'))).toBe(0)
  })

  it('treats a request that never got an answer as unreachable, and never shows the server\'s text', () => {
    expect(spotifyMessage({ code: 'timeout' })).toBe(spotifyMessage(e('unavailable')))
    expect(spotifyMessage({ status: 500, message: 'stack trace', data: {} })).not.toMatch(/stack trace/)
  })

  it('speaks Indonesian when the language is Indonesian', async () => {
    await setLang('id')
    expect(spotifyMessage(e('premium'))).toMatch(/Premium/)
    expect(spotifyMessage(e('premium'))).not.toBe('Controlling playback needs Spotify Premium. You can still open music in Spotify.')
    expect(spotifyMessage(e('denied'))).toBe('Akses Spotify tidak diberikan.')
  })
})

describe('the kept playlist', () => {
  it('is an id and what is needed to show it, nothing more', () => {
    expect(playlistRef({ id: 'p', uri: 'spotify:playlist:p', name: 'Lift', image: null, url: 'u', owner: 'x', tracks: 9, extra: 1 }))
      .toEqual({ id: 'p', uri: 'spotify:playlist:p', name: 'Lift', image: null, url: 'u' })
  })
})
