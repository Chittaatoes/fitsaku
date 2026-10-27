/* Phone number + 4-digit PIN sign-in (PHONE_LOGIN=1). Pure helpers; the routes are in server.js.
 *
 * What this is and is not. A 4-digit PIN has only 10,000 values, so it is safe only because guessing
 * is made slow and the stored value is useless on its own:
 *   - guesses are limited per account, PERSISTENTLY (the counter lives on the account record, so a restart
 *     does not give an attacker a fresh allowance) and per address, with pauses that grow to a day;
 *   - the PIN is hashed with scrypt after being keyed with the server's secret (pepper), so a copy of the
 *     database alone cannot be searched offline for the 10,000 candidates;
 *   - trivial PINs (0000, 1234 ...) are refused.
 * The phone number is NOT verified (no SMS is sent): it is an identifier, not proof that the person owns
 * that number. Anyone can register an unused number, and an invite-only instance (the default for a
 * hosted deployment) is what keeps strangers from doing so. */
import crypto from 'node:crypto';

export const PIN_LENGTH = 4;
const WEAK = new Set(['1212', '2121', '1122', '2211', '1313', '2000', '1004', '2580', '6969', '0852', '1357', '2468']);

/** Digits of the default country calling code (62 = Indonesia). */
export const defaultCountry = env => (/^\d{1,3}$/.test(String(env.PHONE_DEFAULT_COUNTRY || '')) ? String(env.PHONE_DEFAULT_COUNTRY) : '62');

/** E.164 ("+628123456789") or null. 08..., 628..., +628..., 00628... all fold to the same value. */
export function normalizePhone(raw, cc = '62') {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let s = String(raw).normalize('NFKC').trim();
  if (!s || s.length > 40) return null;
  if (!/^[+\d\s().-]+$/.test(s)) return null;
  s = s.replace(/[\s().-]/g, '');
  let digits;
  if (s.startsWith('+')) digits = s.slice(1);
  else if (s.startsWith('00')) digits = s.slice(2);
  else if (s.startsWith('0')) digits = cc + s.slice(1);
  else if (s.startsWith(cc)) digits = s;
  else return null;                       // a foreign number has to say so with + or 00
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return '+' + digits;
}

export const maskPhone = p => (typeof p === 'string' && p.length > 6 ? p.slice(0, 3) + '*'.repeat(p.length - 6) + p.slice(-3) : '***');

/** null when acceptable, else 'pin-format' | 'pin-weak'. */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return 'pin-format';
  const d = [...pin].map(Number);
  if (d.every(x => x === d[0])) return 'pin-weak';
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return 'pin-weak';
  if (WEAK.has(pin)) return 'pin-weak';
  return null;
}

/** What is actually hashed: the PIN keyed with the server secret and the account, never the bare PIN. */
export const pinSecret = (secret, uid, pin) => crypto.createHmac('sha256', secret).update(`fitsaku-pin-v1:${uid}:${pin}`).digest('base64url');

/** Seconds of pause after the n-th wrong PIN in a row (0 for the first four). Grows to a day. */
export function pinLockSeconds(n) {
  if (n < 5) return 0;
  if (n === 5) return 5 * 60;
  if (n === 6) return 15 * 60;
  if (n < 10) return 3600;
  if (n < 15) return 6 * 3600;
  return 24 * 3600;
}
