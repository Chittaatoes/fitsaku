import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { ambientSettingOf, ambientVolumeOf } from '../lib/ambient-plan.js'

// Functions, so each word is a literal t() call the string checks can see.
const OPTIONS = [
  ['off', () => t('Off')],
  ['rest', () => t('Rest only')],
  ['all', () => t('Workout + rest')],
]

/* The built-in workout sound's settings: off, only while resting, or a beat while training and calm
   while resting, and how loud. Used in Profile and in the workout's music panel. */
export default function AmbientControls({ compact = false }) {
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
    {setting !== 'off' && <label className="amb-vol">
      <span className="small muted">{t('Volume')}</span>
      <input type="range" min="0" max="100" step="5" value={Math.round(vol * 100)} aria-label={t('Volume')}
        onChange={e => update(s => { s.ambientVol = Number(e.target.value) / 100 })} />
    </label>}
    {!compact && <p className="small muted amb-note">{t('A built-in beat while you train and a calm sound while you rest. It follows your Sound setting and stays quiet while the workout music plays.')}</p>}
    {setting !== 'off' && !S.sound && <p className="small amb-warn">{t('Sound is off, so nothing plays. Turn it on in Settings.')}</p>}
  </div>
}
