import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getOfflineStatus, repairOffline, resetOfflineCache, announceLanguage, offlineSupported, offlineCopy } from './offline-status.js'

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const setNavigator = v => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: v })

// A controlling worker that answers over the port it is handed, as the real one does.
function worker(reply) {
  const posted = []
  const listeners = {}
  const serviceWorker = {
    controller: { postMessage: (msg, ports) => { posted.push(msg); const r = reply && reply(msg); if (r !== undefined && ports && ports[0]) ports[0].postMessage(r) } },
    addEventListener: (t, f) => { listeners[t] = f },
    removeEventListener: () => {},
  }
  return { serviceWorker, posted, listeners }
}

beforeEach(() => {
  globalThis.location = { protocol: 'https:' }
  globalThis.caches = {}
})
afterEach(() => {
  vi.useRealTimers()
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
  delete globalThis.location
  delete globalThis.caches
})

describe('the offline status', () => {
  it('is unsupported on an address with no https, or without the Cache API', async () => {
    setNavigator({ serviceWorker: worker(() => ({ state: 'ready' })).serviceWorker })
    globalThis.location = { protocol: 'http:' }
    expect(offlineSupported()).toBe(false)
    expect(await getOfflineStatus('de')).toEqual({ state: 'unsupported' })
    globalThis.location = { protocol: 'https:' }
    delete globalThis.caches
    expect(await getOfflineStatus('de')).toEqual({ state: 'unsupported' })
  })

  it('is unknown, never ready, when no worker controls the page', async () => {
    setNavigator({ serviceWorker: { controller: null, addEventListener() {} } })
    expect(await getOfflineStatus('de')).toEqual({ state: 'unknown' })
  })

  it('asks the worker about the base language of the one shown, and passes its answer on', async () => {
    const w = worker(m => ({ state: 'partial', shell: 0, lazy: 1, lang: 0 }))
    setNavigator({ serviceWorker: w.serviceWorker })
    expect(await getOfflineStatus('de-CH')).toMatchObject({ state: 'partial', lazy: 1 })
    expect(w.posted).toEqual([{ type: 'status', lang: 'de' }])
  })

  it('is unknown when the worker never answers, or answers with something else', async () => {
    vi.useFakeTimers()
    setNavigator({ serviceWorker: worker(() => undefined).serviceWorker })
    const silent = getOfflineStatus('en')
    await vi.advanceTimersByTimeAsync(10001)
    expect(await silent).toEqual({ state: 'unknown' })
    vi.useRealTimers()
    setNavigator({ serviceWorker: worker(() => ({ state: 'fine!' })).serviceWorker })
    expect(await getOfflineStatus('en')).toEqual({ state: 'unknown' })
  })

  it('a repair answers with the status after it, unknown when the worker cannot be reached', async () => {
    setNavigator({ serviceWorker: worker(m => ({ state: 'ready', shell: 0, lazy: 0, lang: 0 })).serviceWorker })
    expect((await repairOffline('id')).state).toBe('ready')
    setNavigator({ serviceWorker: { controller: null, addEventListener() {} } })
    expect((await repairOffline('id')).state).toBe('unknown')
  })
})

describe('the reset of the app cache', () => {
  it('passes the worker\'s answer on, refusals included', async () => {
    setNavigator({ serviceWorker: worker(() => ({ ok: false, error: 'offline' })).serviceWorker })
    expect(await resetOfflineCache('en')).toEqual({ ok: false, error: 'offline' })
    setNavigator({ serviceWorker: worker(() => ({ ok: true, state: 'ready' })).serviceWorker })
    expect(await resetOfflineCache('en')).toMatchObject({ ok: true, state: 'ready' })
  })
  it('is a failure, not a success, when there is no worker or its answer is nonsense', async () => {
    setNavigator({ serviceWorker: { controller: null, addEventListener() {} } })
    expect(await resetOfflineCache('en')).toEqual({ ok: false, error: 'no-worker' })
    setNavigator({ serviceWorker: worker(() => 'what').serviceWorker })
    expect(await resetOfflineCache('en')).toEqual({ ok: false, error: 'failed' })
  })
})

describe('telling the worker the language', () => {
  it('sends the base language, and again when a worker takes control', () => {
    const w = worker()
    setNavigator({ serviceWorker: w.serviceWorker })
    announceLanguage('de-CH')
    expect(w.posted).toEqual([{ type: 'lang', lang: 'de' }])
    w.listeners.controllerchange()
    expect(w.posted).toEqual([{ type: 'lang', lang: 'de' }, { type: 'lang', lang: 'de' }])
  })
  it('says nothing where there is no worker to tell', () => {
    setNavigator({})
    expect(() => announceLanguage('de')).not.toThrow()
  })
})

describe('the copy', () => {
  it('speaks Indonesian and falls back to English, and never calls a partial state ready', () => {
    expect(offlineCopy('id').ready).toBe('Siap offline')
    expect(offlineCopy('xx').ready).toBe('Ready offline')
    for (const l of ['en', 'id', 'pt-BR']) expect(offlineCopy(l).footer).toMatch(/\S/)
  })
})
