import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { ALL_EQUIPMENT } from '../lib/equipment.js'
import { applyWorkoutPrefs } from '../lib/workout-prefs.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

// What people usually own at home, first; the rest (machines and the like) sits under "More equipment".
// Every value is one the equipment checklist in Settings already offers (ALL_EQUIPMENT): one source.
const HOME_FIRST = ['dumbbell', 'kettlebell', 'band', 'resistance band', 'barbell', 'weight plate', 'bench', 'pull-up bar',
  'suspension trainer', 'stability ball', 'medicine ball', 'dip bars', 'plyo box']

/* First run, once: Home Workout or Gym, and for Home which equipment there is. Skipping is always
   possible; Gym needs nothing more. What it stores, and how the lists use it, is lib/workout-prefs.js. */
export default function WorkoutOnboarding() {
  const nav = useNavigate()
  const update = useStore(s => s.update)
  const [step, setStep] = useState('style')          // 'style' | 'equipment'
  const [have, setHave] = useState([])
  const [more, setMore] = useState(false)
  const common = HOME_FIRST.filter(k => ALL_EQUIPMENT.includes(k))
  const rest = ALL_EQUIPMENT.filter(k => !common.includes(k))
  const toggle = k => setHave(cur => (cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]))

  const finish = (mode, equipment = []) => {
    update(s => applyWorkoutPrefs(s, { mode, equipment, homeName: t('Home') }))
    if (mode === 'home') useUI.getState().toast(t('Home Workout is on. The exercise list matches your equipment.'))
    nav('/home', { replace: true })
  }

  const chip = k => <button key={k} type="button" className={'chip nocap' + (have.includes(k) ? ' on' : '')} aria-pressed={have.includes(k)} onClick={() => toggle(k)}>{t(k)}</button>

  return <div className="narrow wob">
    {step === 'style' ? <>
      <div className="wob-hd">
        <div className="wob-ic"><Icon name="dumbbell" /></div>
        <h1>{t('How do you want to train?')}</h1>
        <p className="muted">{t('You can change this any time in Settings.')}</p>
      </div>
      <div className="wob-cards">
        <button type="button" className="wob-card" onClick={() => setStep('equipment')}>
          <span className="wob-card-i"><Icon name="house" /></span>
          <span className="wob-card-m">
            <span className="wob-card-t">{t('Home Workout')}</span>
            <span className="small muted">{t('Train at home with your own body weight and the equipment you have. No gear needed.')}</span>
          </span>
          <Icon name="chevronRight" className="wob-card-c" />
        </button>
        <button type="button" className="wob-card" onClick={() => finish('gym')}>
          <span className="wob-card-i"><Icon name="barbell" /></span>
          <span className="wob-card-m">
            <span className="wob-card-t">{t('Gym')}</span>
            <span className="small muted">{t('Train at a gym with all kinds of equipment. You see every exercise.')}</span>
          </span>
          <Icon name="chevronRight" className="wob-card-c" />
        </button>
      </div>
      <div className="wob-foot"><Button variant="ghost" onClick={() => finish(null)}>{t('Not now')}</Button></div>
    </> : <>
      <div className="wob-hd">
        <div className="wob-ic"><Icon name="house" /></div>
        <h1>{t('What equipment do you have at home?')}</h1>
        <p className="muted">{t('Pick what you have. REPO will suggest exercises you can do with it, and body-weight moves are always included. You can skip this.')}</p>
      </div>
      <div className="wob-chips" role="group" aria-label={t('Equipment')}>
        {common.map(chip)}
      </div>
      {rest.length > 0 && <>
        <button type="button" className="chip wob-more" aria-expanded={more} onClick={() => setMore(v => !v)}>{more ? t('Fewer') : t('More equipment')}</button>
        {more && <div className="wob-chips" role="group" aria-label={t('More equipment')}>{rest.map(chip)}</div>}
      </>}
      <p className="small muted wob-count" role="status">{have.length ? t('{0} selected', have.length) : t('Nothing selected: you will see body-weight exercises.')}</p>
      <div className="wob-foot">
        <Button variant="primary" onClick={() => finish('home', have)}>{have.length ? t('Continue') : t('Continue without equipment')}</Button>
        <Button variant="ghost" onClick={() => finish('home', [])}>{t('Skip for now')}</Button>
        <Button variant="ghost" onClick={() => setStep('style')}>{t('Back')}</Button>
      </div>
    </>}
  </div>
}
