// Two notices that can sit over any page: "FitSaku was just updated" and the one-time ask to allow notifications.
// The decisions are pure (and tested here); components/AppNotices.jsx draws them.
//
// The copy lives in this file rather than the locale packs: it is a handful of lines in the languages the
// push messages (api/push-messages.js) already speak, English for the rest.
import { getLang } from './i18n.js'

const COPY = {
  en: {
    updated: 'FitSaku was just updated', reload: 'Reload',
    askTitle: 'Turn on notifications?', askBody: 'Get a heads-up when FitSaku is updated, plus rest-timer and workout reminders.',
    allow: 'Allow', later: 'Not now', on: 'Notifications are on', failed: 'Could not turn on notifications',
  },
  id: {
    updated: 'FitSaku baru saja diupdate', reload: 'Muat ulang',
    askTitle: 'Aktifkan notifikasi?', askBody: 'Dapatkan kabar saat FitSaku diupdate, plus pengingat timer istirahat dan hari latihan.',
    allow: 'Izinkan', later: 'Nanti saja', on: 'Notifikasi diaktifkan', failed: 'Tidak dapat mengaktifkan notifikasi',
  },
  'pt-BR': {
    updated: 'O FitSaku acabou de ser atualizado', reload: 'Recarregar',
    askTitle: 'Ativar notificações?', askBody: 'Receba um aviso quando o FitSaku for atualizado, além dos lembretes de descanso e de treino.',
    allow: 'Permitir', later: 'Agora não', on: 'Notificações ativadas', failed: 'Não foi possível ativar as notificações',
  },
}
export const noticeCopy = (lang = getLang()) => COPY[lang] || COPY[String(lang).split('-')[0]] || COPY.en

// "Not now" is remembered for this long, so the ask comes back once in a while rather than on every load.
export const ASK_AGAIN_MS = 7 * 24 * 3600 * 1000
const ASKED_KEY = 'fs_notify_asked'

export const askedAt = () => { try { return Number(localStorage.getItem(ASKED_KEY)) || 0 } catch { return 0 } }
export const rememberAsked = (now = Date.now()) => { try { localStorage.setItem(ASKED_KEY, String(now)) } catch { /* private mode: asked again next load */ } }

/** Whether to offer the notification permission now. Never once it is granted (or refused: the browser would not
 *  show its own prompt again, and the Settings toggle explains that), never signed out (a subscription is filed
 *  under an account), never in a browser that cannot push, and not again within ASK_AGAIN_MS of a "Not now". */
export function shouldAskNotifications({ supported, permission, signedIn, askedAt: at = 0, now = Date.now() }) {
  if (!supported || !signedIn) return false
  if (permission !== 'default') return false
  return !(at && now - at < ASK_AGAIN_MS)
}

/** Calls `onUpdate` when a new build of the app takes over from the one this page loaded with, or the worker is told
 *  by a push that one is out. A first install (no controller before) is not an update. Returns the stop function. */
export function watchAppUpdates(onUpdate, nav = typeof navigator !== 'undefined' ? navigator : null) {
  const sw = nav && nav.serviceWorker
  if (!sw) return () => {}
  const had = !!sw.controller
  const onMessage = e => { if (e.data && e.data.type === 'fs-update') onUpdate() }
  const onChange = () => { if (had) onUpdate() }
  sw.addEventListener('message', onMessage)
  sw.addEventListener('controllerchange', onChange)
  return () => { sw.removeEventListener('message', onMessage); sw.removeEventListener('controllerchange', onChange) }
}
