// The short guide shown once, in the middle of the screen, the first time a workout is opened: how a set is logged.
// Which device has seen it is kept on the device (localStorage), not in the profile: it is a hint about this screen on
// this phone, not data, and it must not touch the state the sync engine carries.
//
// The copy lives here, in the languages the other notices speak (lib/app-notices.js), English for the rest.
import { getLang } from './i18n.js'

const COPY = {
  en: {
    title: 'How to log your workout',
    s1: 'Finished a set? Tap the circle at the right end of its row.',
    s2: 'With equipment, set the weight you lift by typing it in, or with the − / + buttons.',
    s3: 'All sets done? Tap Next to move on to the next exercise.',
    ok: 'Got it', reopen: 'How to log a workout',
  },
  id: {
    title: 'Cara mencatat latihan',
    s1: 'Selesai satu set? Ketuk lingkaran di sebelah kanan baris set.',
    s2: 'Kalau pakai alat, atur berat yang diangkat dengan mengetik angkanya atau dengan tombol − / +.',
    s3: 'Semua set selesai? Tekan Berikutnya untuk lanjut ke latihan berikutnya.',
    ok: 'Mengerti', reopen: 'Panduan mencatat latihan',
  },
  'pt-BR': {
    title: 'Como registrar o treino',
    s1: 'Terminou uma série? Toque no círculo à direita da linha.',
    s2: 'Com equipamento, defina o peso que você levanta digitando ou com os botões − / +.',
    s3: 'Todas as séries feitas? Toque em Próximo para seguir para o próximo exercício.',
    ok: 'Entendi', reopen: 'Como registrar o treino',
  },
}
export const tipsCopy = (lang = getLang()) => COPY[lang] || COPY[String(lang).split('-')[0]] || COPY.en

const KEY = 'fs_workout_tips_v1'
export const tipsSeen = () => { try { return localStorage.getItem(KEY) === '1' } catch { return true } }   // no storage: never nag
export const markTipsSeen = () => { try { localStorage.setItem(KEY, '1') } catch { /* private mode: it may show again next time */ } }

/** Whether to show the guide now: a workout being done (not a past one being edited or back-filled), with something in
 *  it, by someone who has not been shown it on this device. */
export function shouldShowWorkoutTips({ seen, active }) {
  if (seen || !active) return false
  if (active.editingWorkoutId || active.backfill) return false
  return Array.isArray(active.entries) && active.entries.length > 0
}
