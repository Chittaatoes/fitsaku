// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login.jsx'
import { PhoneSignInSheet, PhoneRegisterForm, looksLikePhone, isPin } from '../components/PhonePinAuth.jsx'
import { phoneLogin, phoneRegister } from '../lib/api.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Phone number + 4-digit PIN sign-in. Only an instance that advertises `phone_login` shows it; the PIN
   field takes digits only, the checks that need no round trip are made first, and the server's answers
   are shown in the UI language. */
const mocks = vi.hoisted(() => {
  const state = { webauthn: true, config: null, sheets: [], setUser: vi.fn() }
  state.snapshot = () => ({
    config: state.config, S: {},
    setUser: state.setUser, adoptProfile: vi.fn(), setGuest: vi.fn(), loadConfig: vi.fn(async () => state.config),
    pushState: vi.fn(), pullState: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
  phoneLogin: vi.fn(), phoneRegister: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const buttons = host => [...host.querySelectorAll('button')].map(b => b.textContent)
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const submit = host => act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
const input = (host, sel) => host.querySelector(sel)
const fail = (status, data) => Object.assign(new Error('x'), { status, data })

beforeEach(() => { mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0; vi.clearAllMocks() })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('what the sign-in screen offers', () => {
  it('shows the phone button only when the instance has it', () => {
    expect(buttons(mount(<Login />))).not.toContain('Sign in with phone number')
    mocks.config = { phone_login: true }
    const page = mount(<Login />)
    expect(buttons(page)).toContain('Sign in with phone number')
    act(() => [...page.querySelectorAll('button')].find(b => b.textContent === 'Sign in with phone number').click())
    expect(mocks.sheets).toHaveLength(1)
  })
  it('is the way in (with sign-up) for a browser without passkeys', () => {
    mocks.webauthn = false; mocks.config = { phone_login: true }
    const page = mount(<Login />)
    expect(buttons(page)).toEqual(expect.arrayContaining(['Sign in with phone number', 'Create new profile']))
    expect(page.textContent).toContain('phone number and PIN instead')
  })
})

describe('the checks made before anything is sent', () => {
  it('knows a phone number and a PIN when it sees one', () => {
    for (const p of ['0812 3456 7890', '+62 812-3456-7890', '(0812) 3456 7890']) expect(looksLikePhone(p), p).toBe(true)
    for (const p of ['', '123', 'abc', '12-34']) expect(looksLikePhone(p), p).toBe(false)
    expect(isPin('4827')).toBe(true)
    for (const p of ['482', '48270', 'abcd', '4 27']) expect(isPin(p), p).toBe(false)
  })
})

describe('signing in', () => {
  const open = () => mount(<PhoneSignInSheet close={vi.fn()} />)
  it('takes digits only in the PIN field, at most four, and hides it', () => {
    const h = open(); const pin = input(h, 'input[name=pin]')
    type(pin, '48a2-7x9')
    expect(pin.value).toBe('4827')
    expect(pin.type).toBe('password')
  })
  it('does not call the server for a bad number or a short PIN', async () => {
    const h = open()
    type(input(h, 'input[name=tel]'), '12'); type(input(h, 'input[name=pin]'), '48')
    await submit(h)
    expect(phoneLogin).not.toHaveBeenCalled()
    expect(h.querySelector('[role=alert]').textContent).toBe('Enter a valid phone number and a 4-digit PIN.')
  })
  it('signs in, sending the number as typed and the PIN, and signs the user in', async () => {
    phoneLogin.mockResolvedValue({ id: 'u1', name: 'Ana' })
    const close = vi.fn(); const h = mount(<PhoneSignInSheet close={close} />)
    type(input(h, 'input[name=tel]'), ' 0812 3456 7890 '); type(input(h, 'input[name=pin]'), '4827')
    await submit(h)
    expect(phoneLogin).toHaveBeenCalledWith('0812 3456 7890', '4827')
    expect(mocks.setUser).toHaveBeenCalledWith({ id: 'u1', name: 'Ana' }, { adopt: true })
    expect(close).toHaveBeenCalled()
  })
  it('says what the server said, in words, and clears the PIN', async () => {
    const h = open()
    type(input(h, 'input[name=tel]'), '0812 3456 7890'); type(input(h, 'input[name=pin]'), '1357')
    phoneLogin.mockRejectedValueOnce(fail(401, { code: 'bad-credentials' }))
    await submit(h)
    expect(h.querySelector('[role=alert]').textContent).toBe('Wrong phone number or PIN.')
    expect(input(h, 'input[name=pin]').value).toBe('')
    type(input(h, 'input[name=pin]'), '1357')
    phoneLogin.mockRejectedValueOnce(fail(429, { retryAfter: 300 }))
    await submit(h)
    expect(h.querySelector('[role=alert]').textContent).toMatch(/^Too many attempts\. Try again/)
  })
})

describe('creating a profile', () => {
  const form = (over = {}) => mount(<PhoneRegisterForm {...{ close: vi.fn(), inviteOnly: false, name: 'Ana', setName: vi.fn(), code: '', setCode: vi.fn(), ...over }} />)
  it('asks for the same PIN twice, and for the invite code on an invite-only instance', async () => {
    const h = form({ inviteOnly: true })
    type(input(h, 'input[name=tel]'), '0812 3456 7890'); type(input(h, 'input[name=new-pin]'), '4827'); type(input(h, 'input[name=new-pin-again]'), '4828')
    await submit(h)
    expect(h.querySelector('[role=alert]').textContent).toBe('The two PINs are not the same.')
    type(input(h, 'input[name=new-pin-again]'), '4827')
    await submit(h)
    expect(h.querySelector('[role=alert]').textContent).toBe('An invite code is required')
    expect(phoneRegister).not.toHaveBeenCalled()
  })
  it('sends name, number, PIN and code, and shows the refusal of a taken number or a weak PIN', async () => {
    const h = form({ code: 'GOODCODE', inviteOnly: true })
    type(input(h, 'input[name=tel]'), '0812 3456 7890'); type(input(h, 'input[name=new-pin]'), '4827'); type(input(h, 'input[name=new-pin-again]'), '4827')
    phoneRegister.mockRejectedValueOnce(fail(409, { code: 'phone-taken' }))
    await submit(h)
    expect(phoneRegister).toHaveBeenCalledWith('Ana', '0812 3456 7890', '4827', 'GOODCODE')
    expect(h.querySelector('[role=alert]').textContent).toBe('Another profile already uses this phone number.')
    type(input(h, 'input[name=new-pin]'), '4827'); type(input(h, 'input[name=new-pin-again]'), '4827')
    phoneRegister.mockRejectedValueOnce(fail(400, { code: 'pin-weak' }))
    await submit(h)
    expect(h.querySelector('[role=alert]').textContent).toMatch(/too easy to guess/)
  })
})
