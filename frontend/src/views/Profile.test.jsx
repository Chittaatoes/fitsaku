// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from './Profile.jsx'
import { PAGES } from './settings-pages.js'
import { LANGS } from '../lib/i18n.js'
import { bindUI } from '../components/ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The Profile tab: every row opens something that exists (an unknown Settings page sends the route back to the
   Settings root, which is what Goals, Backups, Import / Export and Help did), and the language is saved on the
   profile, not only drawn on screen. */
const mocks = vi.hoisted(() => {
  const state = { S: { lang: 'en', theme: 'dark', accent: 'lime', unit: 'kg' }, update: vi.fn(), navs: [], goal: vi.fn(), guest: true, config: null }
  state.snapshot = () => ({ S: state.S, update: state.update, user: state.guest ? null : { id: 'u', name: 'Ana' }, isGuest: () => state.guest, config: state.config })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.navs.push(a) }))
vi.mock('../sheets.jsx', () => ({ goalSheet: (...a) => mocks.goal(...a) }))
vi.mock('../components/AmbientControls.jsx', () => ({ default: () => null }))

let host, root
beforeEach(() => {
  mocks.S = { lang: 'en', theme: 'dark', accent: 'lime', unit: 'kg' }
  mocks.update.mockClear(); mocks.navs.length = 0; mocks.goal.mockClear(); mocks.guest = false; mocks.config = null
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<Profile />))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const row = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const tap = title => act(() => { row(title).click() })

describe('the rows lead somewhere real', () => {
  it('every Settings page a row opens exists', () => {
    for (const title of ['Equipment', 'Units', 'Backups', 'Import / Export', 'Passkeys', 'Sign Out', 'About', 'Help']) {
      mocks.navs.length = 0
      tap(title)
      const [to] = mocks.navs[0]
      const page = to.replace(/^\/settings\//, '')
      expect(to.startsWith('/settings/'), title).toBe(true)
      expect(Object.keys(PAGES), `${title} -> ${to}`).toContain(page)
    }
  })
  it('Goals opens the goal sheet instead of leaving for Settings', () => {
    tap('Goals')
    expect(mocks.goal).toHaveBeenCalledTimes(1)
    expect(mocks.navs).toEqual([])
  })
  it('Import / Export and Passkeys land on the row they are named after', () => {
    tap('Import / Export'); expect(mocks.navs[0]).toEqual(['/settings/data', { state: { find: 'Import backup' } }])
    tap('Passkeys'); expect(mocks.navs[1]).toEqual(['/settings/account', { state: { find: 'Passkeys' } }])
  })
})

describe('the language', () => {
  // SelectRow opens its options on a sheet; the sheet is mounted here so an option can be tapped.
  const pick = label => {
    let sheet
    bindUI({ getState: () => ({ openSheet: render => { sheet = render(() => {}); return {} } }) })
    tap('Language')
    const h = document.createElement('div'); document.body.appendChild(h)
    const r = createRoot(h)
    act(() => r.render(sheet))
    const opt = [...h.querySelectorAll('button, .lrow, [role=option], li')].find(e => e.textContent.trim().startsWith(label))
    act(() => opt.click())
    act(() => r.unmount()); h.remove()
  }
  it('is saved on the profile when it is changed, and no longer an automatic one', () => {
    pick(LANGS.id)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    const next = { lang: 'en' }
    mocks.update.mock.calls[0][0](next)
    expect(next).toEqual({ lang: 'id', langAuto: false })
  })
  it('shows the language in use, which for a profile that never chose is the one detected, not "English"', () => {
    mocks.S = { langAuto: true, theme: 'dark', accent: 'lime', unit: 'kg' }; mocks.config = { default_lang: 'id' }
    act(() => root.render(<Profile key="again" />))
    expect(row('Language').querySelector('.lrow-v').textContent).toBe(LANGS.id)
    mocks.S = { lang: 'en', theme: 'dark', accent: 'lime', unit: 'kg' }; mocks.config = null
    act(() => root.render(<Profile key="third" />))
    expect(row('Language').querySelector('.lrow-v').textContent).toBe(LANGS.en)
  })
})
