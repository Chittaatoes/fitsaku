import { useStore } from '../store/useStore.js'
import { t, getLang, useLang } from '../lib/i18n.js'
import { ambientVolumeOf } from '../lib/ambient-plan.js'
import { Switch } from './ui.jsx'

// The few words of these controls that are new, in the languages the app's other notices speak (English for the rest).
const COPY = {
  en: { auto: 'Play music in a workout', note: 'Music plays while you train and stops when a set is done, for the calm rest sound. The volume sets both.' },
  id: { auto: 'Putar musik saat latihan', note: 'Musik diputar saat latihan dan berhenti saat satu set selesai, diganti suara istirahat yang tenang. Volume mengatur keduanya.' },
  'pt-BR': { auto: 'Tocar música no treino', note: 'A música toca enquanto você treina e para quando uma série termina, dando lugar ao som calmo do descanso. O volume ajusta os dois.' },
}
const copy = () => { const l = getLang(); return COPY[l] || COPY[String(l).split('-')[0]] || COPY.en }

/* The workout sound's settings: the volume (the loudness of the workout's own music, lib/music.js, and of the calm rest sound
   it hands over to) and whether the music plays in a workout. Used in Profile and in the workout's music card. */
export default function AmbientControls({ compact = false }) {
  useLang()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const vol = ambientVolumeOf(S)
  const c = copy()
  const auto = S.musicAuto !== false
  return <div className={'amb' + (compact ? ' compact' : '')}>
    <div className="amb-t">{t('Workout sound')}</div>
    <label className="amb-vol">
      <span className="small muted">{t('Volume')}</span>
      <input type="range" min="0" max="100" step="5" value={Math.round(vol * 100)} aria-label={t('Volume')}
        onChange={e => update(s => { s.ambientVol = Number(e.target.value) / 100 })} />
    </label>
    <div className="mp-auto">
      <span>{c.auto}</span>
      <Switch checked={auto} aria-label={c.auto} onChange={v => update(s => { s.musicAuto = v })} />
    </div>
    {!compact && <p className="small muted amb-note">{c.note}</p>}
    {!S.sound && <p className="small amb-warn">{t('Sound is off, so nothing plays. Turn it on in Settings.')}</p>}
  </div>
}
