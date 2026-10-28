import { describe, it, expect, vi } from 'vitest'
import { shouldAskNotifications, ASK_AGAIN_MS, noticeCopy, watchAppUpdates } from './app-notices.js'

const base = { supported: true, permission: 'default', signedIn: true, askedAt: 0, now: 1_000_000_000_000 }

describe('shouldAskNotifications', () => {
  it('asks a signed-in person whose browser can push and who has not decided', () => {
    expect(shouldAskNotifications(base)).toBe(true)
  })
  it('never asks once permission is granted, nor after a refusal', () => {
    expect(shouldAskNotifications({ ...base, permission: 'granted' })).toBe(false)
    expect(shouldAskNotifications({ ...base, permission: 'denied' })).toBe(false)
  })
  it('does not ask signed out, or where push is not possible', () => {
    expect(shouldAskNotifications({ ...base, signedIn: false })).toBe(false)
    expect(shouldAskNotifications({ ...base, supported: false })).toBe(false)
  })
  it('stays quiet for a week after "Not now", then asks again', () => {
    expect(shouldAskNotifications({ ...base, askedAt: base.now - 1000 })).toBe(false)
    expect(shouldAskNotifications({ ...base, askedAt: base.now - ASK_AGAIN_MS - 1 })).toBe(true)
  })
})

describe('noticeCopy', () => {
  it('speaks Indonesian and falls back to English', () => {
    expect(noticeCopy('id').updated).toBe('FitSaku baru saja diupdate')
    expect(noticeCopy('xx').updated).toBe('FitSaku was just updated')
  })
})

describe('watchAppUpdates', () => {
  const fakeNav = controller => {
    const l = {}
    return { l, nav: { serviceWorker: { controller, addEventListener: (n, f) => { l[n] = f }, removeEventListener: n => { delete l[n] } } } }
  }
  it('reports a new worker taking over a page that already had one', () => {
    const { l, nav } = fakeNav({})
    const fn = vi.fn()
    watchAppUpdates(fn, nav)
    l.controllerchange()
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('does not report the first install', () => {
    const { l, nav } = fakeNav(null)
    const fn = vi.fn()
    watchAppUpdates(fn, nav)
    l.controllerchange()
    expect(fn).not.toHaveBeenCalled()
  })
  it('reports the worker\'s message that a release is out, and stops when asked', () => {
    const { l, nav } = fakeNav(null)
    const fn = vi.fn()
    const stop = watchAppUpdates(fn, nav)
    l.message({ data: { type: 'other' } })
    expect(fn).not.toHaveBeenCalled()
    l.message({ data: { type: 'fs-update' } })
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
    expect(l.message).toBeUndefined()
  })
  it('is a no-op without service workers', () => {
    expect(() => watchAppUpdates(() => {}, {})()).not.toThrow()
  })
})
