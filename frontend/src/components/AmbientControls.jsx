import { useStore } from '../store/useStore.js'
import { t, getLang, useLang } from '../lib/i18n.js'
import { ambientSettingOf, ambientVolumeOf } from '../lib/ambient-plan.js'

// Functions, so each word is a literal t() call the string checks can see.
const OPTIONS = [
  ['off', () => t('Off')],
  ['rest', () => t('Rest only')],
]

const NOTE = {
  en: 'A calm sound while you rest. The volume sets the workout music and this sound.',
  id: 'Suara tenang saat istirahat. Volume mengatur musik latihan dan suara ini.',
  'pt-BR': 'Um som calmo durante o descanso. O volume ajusta a música do treino e este som.',
}
const note = () => { const l = getLang(); return NOTE[l] || NOTE[String(l).split('-')[0]] || NOTE.en }

/* The workout sound's settings: the calm sound while resting (on or off), and the volume, which is the loudness of the
   workout's own music (lib/music.js) as well as of that sound. Used in Profile and in the workout's music card. */
export default function AmbientControls({ compact = false }) {
  useLang()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const setting = ambientSettingOf(S)
  const vol = ambientVolumeOf(S)
  return <div className={'amb' + (compact ? ' compact' : '')}>
    <div className="amb-t">{t('Workout sound')}</div>
    <div className="amb-opts" role="radiogroup" aria-label={t('Workout sound')}>
      {OPTIONS.map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={setting === key}
        className={'chip' + (setting === key ? ' on' : '')} onClick={() => update(s => { s.ambient = key })}>{label()}</button>)}
    </div>
    <label className="amb-vol">
      <span className="small muted">{t('Volume')}</span>
      <input type="range" min="0" max="100" step="5" value={Math.round(vol * 100)} aria-label={t('Volume')}
        onChange={e => update(s => { s.ambientVol = Number(e.target.value) / 100 })} />
    </label>
    {!compact && <p className="small muted amb-note">{note()}</p>}
    {!S.sound && <p className="small amb-warn">{t('Sound is off, so nothing plays. Turn it on in Settings.')}</p>}
  </div>
}
