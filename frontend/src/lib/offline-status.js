// The page's side of the service worker's offline readiness (public/sw.js): whether the app can start with no network,
// a repair for what is missing, and a reset of the app's cache.
//
// Everything here is a question put to the worker that controls this page. No worker (an http page, a first visit
// before it took over, a browser without the Cache API) or no answer is "unknown", never "ready": the app does not say
// it works offline on a guess. None of it touches what the person has made: workouts, the account, what waits to sync,
// photos and videos, notifications. The worker deletes only its own build caches.
import { baseLang } from './i18n-core.js'

const COPY = {
  en: {
    title: 'Offline',
    ready: 'Ready offline', partial: 'Partly ready', none: 'Not ready offline', unknown: 'Cannot tell yet', checking: 'Checking…', unsupported: 'Not available here',
    readyAbout: 'The app and your language are stored on this device.',
    partialAbout: '{0} file(s) are not stored yet. Tap Complete, with a connection.',
    noneAbout: 'The app files are not all stored. Connect, then tap Reset app cache.',
    unknownAbout: 'The app could not confirm what is stored. Open it once with a connection and check again.',
    unsupportedAbout: 'This browser or address cannot keep the app for offline use (it needs https and a service worker).',
    footer: 'Exercise pictures and videos you have not opened or downloaded, and anything that needs the server (sync, sign-in, Coach), still need internet.',
    check: 'Check again', complete: 'Complete', reset: 'Reset app cache',
    confirmTitle: 'Reset app cache?', confirmBody: 'The app files on this device are downloaded again and rebuilt. It needs a connection. Your workouts, account, waiting changes, photos and notifications are not touched.', confirmOk: 'Reset',
    done: 'App cache rebuilt', doneNotReady: 'Rebuilt, but not everything is stored yet.',
    errOffline: 'Reset needs a connection. Nothing was changed.', errNewer: 'A newer version is being installed. Wait a moment and try again. Nothing was changed.', errFailed: 'Reset failed. The app is not confirmed ready offline.', errNoWorker: 'The offline worker is not running yet.',
  },
  id: {
    title: 'Offline',
    ready: 'Siap offline', partial: 'Sebagian siap', none: 'Belum siap offline', unknown: 'Belum bisa dipastikan', checking: 'Memeriksa…', unsupported: 'Tidak tersedia di sini',
    readyAbout: 'Aplikasi dan bahasa kamu tersimpan di perangkat ini.',
    partialAbout: '{0} berkas belum tersimpan. Ketuk Lengkapi, dengan koneksi.',
    noneAbout: 'Berkas aplikasi belum semuanya tersimpan. Sambungkan internet, lalu ketuk Reset cache aplikasi.',
    unknownAbout: 'Aplikasi belum bisa memastikan apa yang tersimpan. Buka sekali dengan koneksi lalu periksa lagi.',
    unsupportedAbout: 'Peramban atau alamat ini tidak bisa menyimpan aplikasi untuk offline (perlu https dan service worker).',
    footer: 'Gambar dan video latihan yang belum dibuka atau diunduh, serta apa pun yang butuh server (sinkronisasi, masuk akun, Coach), tetap perlu internet.',
    check: 'Periksa ulang', complete: 'Lengkapi', reset: 'Reset cache aplikasi',
    confirmTitle: 'Reset cache aplikasi?', confirmBody: 'Berkas aplikasi di perangkat ini diunduh ulang dan dibangun kembali. Perlu koneksi. Workout, akun, perubahan yang menunggu sinkron, foto, dan notifikasi tidak disentuh.', confirmOk: 'Reset',
    done: 'Cache aplikasi dibangun ulang', doneNotReady: 'Dibangun ulang, tetapi belum semuanya tersimpan.',
    errOffline: 'Reset butuh koneksi. Tidak ada yang diubah.', errNewer: 'Versi yang lebih baru sedang dipasang. Tunggu sebentar lalu coba lagi. Tidak ada yang diubah.', errFailed: 'Reset gagal. Aplikasi belum dinyatakan siap offline.', errNoWorker: 'Pekerja offline belum berjalan.',
  },
  'pt-BR': {
    title: 'Offline',
    ready: 'Pronto offline', partial: 'Parcialmente pronto', none: 'Não está pronto offline', unknown: 'Ainda não dá para saber', checking: 'Verificando…', unsupported: 'Indisponível aqui',
    readyAbout: 'O app e o seu idioma estão guardados neste dispositivo.',
    partialAbout: '{0} arquivo(s) ainda não foram guardados. Toque em Completar, com conexão.',
    noneAbout: 'Os arquivos do app não estão todos guardados. Conecte-se e toque em Redefinir cache do app.',
    unknownAbout: 'O app não conseguiu confirmar o que está guardado. Abra uma vez com conexão e verifique de novo.',
    unsupportedAbout: 'Este navegador ou endereço não pode guardar o app para uso offline (precisa de https e service worker).',
    footer: 'Imagens e vídeos de exercícios que você não abriu ou baixou, e tudo que precisa do servidor (sincronização, login, Coach), ainda precisam de internet.',
    check: 'Verificar de novo', complete: 'Completar', reset: 'Redefinir cache do app',
    confirmTitle: 'Redefinir o cache do app?', confirmBody: 'Os arquivos do app neste dispositivo são baixados de novo e reconstruídos. Precisa de conexão. Seus treinos, conta, alterações pendentes, fotos e notificações não são tocados.', confirmOk: 'Redefinir',
    done: 'Cache do app reconstruído', doneNotReady: 'Reconstruído, mas nem tudo está guardado ainda.',
    errOffline: 'Redefinir precisa de conexão. Nada foi alterado.', errNewer: 'Uma versão mais nova está sendo instalada. Espere um pouco e tente de novo. Nada foi alterado.', errFailed: 'Falha ao redefinir. O app não está confirmado como pronto offline.', errNoWorker: 'O worker offline ainda não está ativo.',
  },
}
export const offlineCopy = (lang = 'en') => COPY[lang] || COPY[String(lang).split('-')[0]] || COPY.en

const swOf = () => (typeof navigator !== 'undefined' && navigator.serviceWorker) || null
const secure = () => typeof location !== 'undefined' && location.protocol === 'https:'
/** Whether this page could have an offline worker at all. */
export const offlineSupported = () => !!swOf() && secure() && typeof caches !== 'undefined'

/** One question to the controlling worker, answered over a private channel. Rejects when there is no worker or no reply. */
export function askWorker(message, ms = 10000) {
  const ctl = swOf()?.controller
  if (!ctl) return Promise.reject(Object.assign(new Error('no worker'), { code: 'no-worker' }))
  return new Promise((resolve, reject) => {
    const ch = new MessageChannel()
    const timer = setTimeout(() => reject(Object.assign(new Error('no reply'), { code: 'timeout' })), ms)
    ch.port1.onmessage = e => { clearTimeout(timer); resolve(e.data) }
    ctl.postMessage(message, [ch.port2])
  })
}

const langOf = lang => baseLang(lang || 'en')

/** { state: 'ready' | 'partial' | 'none' | 'unknown' | 'unsupported', shell, lazy, lang } — never 'ready' unless the worker
 *  checked every file of its build, and of the language shown, in its cache and found it. */
export async function getOfflineStatus(lang) {
  if (!offlineSupported()) return { state: 'unsupported' }
  try {
    const r = await askWorker({ type: 'status', lang: langOf(lang) })
    return ['ready', 'partial', 'none'].includes(r?.state) ? r : { state: 'unknown' }
  } catch { return { state: 'unknown' } }
}

/** Fetches what is missing (the worker does it, from the network) and answers the status after. */
export async function repairOffline(lang) {
  try {
    const r = await askWorker({ type: 'repair', lang: langOf(lang) }, 120000)
    return ['ready', 'partial', 'none'].includes(r?.state) ? r : { state: 'unknown' }
  } catch { return { state: 'unknown' } }
}

/** Rebuilds the app's cache. { ok: true, state } or { ok: false, error: 'offline' | 'newer' | 'failed' | 'no-worker' }. */
export async function resetOfflineCache(lang) {
  try {
    const r = await askWorker({ type: 'reset', lang: langOf(lang) }, 180000)
    return r && typeof r.ok === 'boolean' ? r : { ok: false, error: 'failed' }
  } catch (e) { return { ok: false, error: e.code === 'no-worker' ? 'no-worker' : 'failed' } }
}

// The worker fetches the packs of the language shown at install and when told. Told here whenever the language changes,
// and again when a worker takes control (the first one, or an update's) because a message to the old one is lost.
let lastLang = null
let watching = false
function send() {
  const ctl = swOf()?.controller
  if (ctl && lastLang) { try { ctl.postMessage({ type: 'lang', lang: lastLang }) } catch { /* next change says it again */ } }
}
export function announceLanguage(lang) {
  if (!offlineSupported()) return
  lastLang = langOf(lang)
  send()
  if (!watching) {
    watching = true
    swOf().addEventListener('controllerchange', send)
  }
}
