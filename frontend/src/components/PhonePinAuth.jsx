// Phone number + 4-digit PIN sign-in and sign-up, on an instance that offers it
// (GET /api/config -> `phone_login`). The rules are the server's (api/phone-pin.js and the phone block in
// api/server.js); this only words them. The number is an identifier, not proof of ownership: nothing is
// ever sent to it. The PIN is typed into password-type fields, never shown or kept.
import { useEffect, useRef, useState } from 'react'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { phoneLogin, phoneRegister } from '../lib/api.js'
import { askAddDeviceData } from '../sheets.jsx'
import { Button } from './ui.jsx'
import { passwordError } from './PasswordAuth.jsx'

export const phoneOn = config => !!config?.phone_login

// What the server accepts as a phone number, loosely: digits with the usual separators, 8 to 15 digits. The server decides.
export const looksLikePhone = s => /^[+\d\s().-]{6,40}$/.test(String(s || '')) && (String(s).match(/\d/g) || []).length >= 8
export const isPin = s => /^\d{4}$/.test(String(s || ''))

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const errStyle = { color: 'var(--red)', marginTop: 10 }
const numeric = { inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'off', autoCorrect: 'off', spellCheck: false }

// The server's answer in the UI language: the shared ones, then the phone and PIN specific ones.
export function phoneError(e) {
  switch (e?.data?.code) {
    case 'bad-credentials': return t('Wrong phone number or PIN.')
    case 'phone-invalid': case 'pin-format': case 'missing': return t('Enter a valid phone number and a 4-digit PIN.')
    case 'pin-weak': return t('That PIN is too easy to guess. Avoid 1234, 0000 and the like.')
    case 'phone-taken': return t('Another profile already uses this phone number.')
  }
  return passwordError(e)
}

function PinField({ value, onChange, placeholder, name, autoComplete = 'off' }) {
  return <input className="input" type="password" name={name} {...numeric} autoComplete={autoComplete} maxLength={4} placeholder={placeholder}
    value={value} onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} style={{ letterSpacing: '.4em', textAlign: 'center', fontWeight: 600 }} />
}

export function PhoneSignInSheet({ close }) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const bad = !looksLikePhone(phone) || !isPin(pin) ? t('Enter a valid phone number and a 4-digit PIN.') : null
    if (bad) { setErr(bad); return }
    setBusy(true); setErr(null)
    try {
      const u = await phoneLogin(phone.trim(), pin)
      const st = useStore.getState()
      st.setUser(u, { adopt: true }); close()
      await st.adoptProfile(askAddDeviceData)
      toast(t('Welcome back, {0}', u.name))
    } catch (e) { setErr(phoneError(e)) }
    finally { setBusy(false); setPin('') }
  }
  return <>
    <h3>{t('Sign in with phone number')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Use your phone number and your 4-digit PIN.')}</div>
    <form onSubmit={submit} noValidate>
      <input ref={ref} className="input" type="tel" name="tel" autoComplete="tel" inputMode="tel" placeholder={t('Phone number')} maxLength={40}
        value={phone} onChange={e => setPhone(e.target.value)} />
      <div style={{ height: 10 }} />
      <PinField name="pin" value={pin} onChange={setPin} placeholder={t('PIN (4 digits)')} />
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy}>{t('Sign in')}</Button>
    </form>
  </>
}
export const openPhoneSignIn = () => ui().openSheet(close => <PhoneSignInSheet close={close} />)

/* The phone half of creating a profile. Name and invite code are the caller's state, so switching
   between ways to register keeps what was typed. */
export function PhoneRegisterForm({ close, inviteOnly, name, setName, code, setCode }) {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const n = name.trim()
    const bad = !n ? t('Enter a name')
      : !looksLikePhone(phone) || !isPin(pin) ? t('Enter a valid phone number and a 4-digit PIN.')
      : pin !== again ? t('The two PINs are not the same.')
      : inviteOnly && !code.trim() ? t('An invite code is required')
      : null
    if (bad) { setErr(bad); return }
    setBusy(true); setErr(null)
    try {
      const u = await phoneRegister(n, phone.trim(), pin, code.trim())
      const st = useStore.getState()
      st.setUser(u); close()
      if (hasData(useStore.getState().S)) { await st.pushState(); toast(t('Profile created, and this device’s data moved into it')) }
      else { await st.pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { setErr(phoneError(e)) }
    finally { setBusy(false); setPin(''); setAgain('') }
  }
  return <form onSubmit={submit} noValidate>
    <input className="input" name="username" autoComplete="nickname" placeholder={t('Your name')} maxLength={40}
      value={name} onChange={e => setName(e.target.value)} autoCapitalize="words" />
    <div style={{ height: 10 }} />
    <input className="input" type="tel" name="tel" autoComplete="tel" inputMode="tel" placeholder={t('Phone number')} maxLength={40}
      value={phone} onChange={e => setPhone(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <div style={{ height: 10 }} />
    <PinField name="new-pin" value={pin} onChange={setPin} placeholder={t('PIN (4 digits)')} />
    <div style={{ height: 10 }} />
    <PinField name="new-pin-again" value={again} onChange={setAgain} placeholder={t('Repeat the PIN')} />
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
    <div style={{ height: 12 }} />
    <Button type="submit" variant="primary" disabled={busy}>{t('Create profile')}</Button>
  </form>
}
