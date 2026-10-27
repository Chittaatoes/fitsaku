import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { uid, exerciseNameText, exCount, weekOrder, weekStartOf, DAYS, DAYN } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { defaultConfig, exLine } from '../lib/history.js'
import { DEFAULT_GLYPH } from '../lib/glyphs.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { loadDraft, saveDraft, clearDraft, isEmptyDraft } from '../lib/workout-draft.js'
import { exercisePicker, exConfigSheet, startFlow } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const NAME_MAX = 40

/** Builds a routine from a draft. Pure, so it is tested without the screen: a trimmed name, a copy
 *  of each exercise, and the weekdays it goes on appended to what those days already hold (two
 *  routines on one day make a combined day, as Plan's day sheet does). */
export function addCustomWorkout(s, { name, ex, days }, id = uid()) {
  const routine = { id, name: String(name).trim().slice(0, NAME_MAX), emoji: DEFAULT_GLYPH, ex: ex.map(e => ({ ...e })) }
  s.routines.push(routine)
  for (const d of days) {
    const ids = [].concat(s.week[d] || [])
    if (!ids.includes(id)) s.week[d] = [...ids, id]
  }
  return routine
}

/* Train → Create your own workout: name it, pick exercises from the library, choose the days. One
   screen, saved in one step; the routine then lives in Plan like any other and can be edited there. */
export default function CreateWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  // What was typed and picked before the app was left (a phone may drop the page in the background)
  // comes back; every change is written to this device as it happens (lib/workout-draft.js).
  const [saved] = useState(loadDraft)
  const [name, setName] = useState(saved.name)
  const [ex, setEx] = useState(saved.ex)
  const [days, setDays] = useState(saved.days)
  useEffect(() => { saveDraft({ name, ex, days }) }, [name, ex, days])
  const dirty = !isEmptyDraft({ name, ex, days })
  const startOver = () => { setName(''); setEx([]); setDays([]); clearDraft() }
  const unit = S.unit || 'kg'
  const loop = scheduleModeOf(S) === 'rotation'
  const order = weekOrder(weekStartOf(S))
  const ready = name.trim().length > 0 && ex.length > 0

  const addExercise = () => exercisePicker((picked, quick) => {
    if (quick) setEx(cur => [...cur, { id: picked.id, ...defaultConfig(picked.id) }])
    else exConfigSheet(picked, null, cfg => setEx(cur => [...cur, { id: picked.id, ...cfg }]), null, null, null, null, undefined, { backups: true })
  })
  const move = (i, to) => setEx(cur => {
    if (to < 0 || to >= cur.length) return cur
    const next = [...cur]; const [m] = next.splice(i, 1); next.splice(to, 0, m); return next
  })
  const toggleDay = d => setDays(cur => (cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d]))
  const planned = d => [].concat(S.week[d] || []).map(id => S.routines.find(r => r.id === id)?.name).filter(Boolean)

  const save = start => {
    if (!ready) return
    clearDraft()
    let made = null
    update(s => { made = addCustomWorkout(s, { name, ex, days: loop ? [] : days }) })
    useUI.getState().toast(t('“{0}” saved', made.name))
    if (start && !useStore.getState().S.active) startFlow([made.id])
    nav('/train', { replace: true })
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/train" aria-label={t('Back')} onClick={() => nav('/train')}><Icon name="chevronLeft" /></button>
      <div><h1>{t('Create your own workout')}</h1><div className="sub">{t('Pick the exercises, then the days you do it.')}</div></div>
    </div>

    <div className="card cw-card">
      <label className="cw-label" htmlFor="cw-name">{t('Name')}</label>
      <input id="cw-name" className="cw-input" value={name} maxLength={NAME_MAX} autoComplete="off"
        placeholder={t('e.g. Arm day')} onChange={e => setName(e.target.value)} />
    </div>

    <div className="card cw-card">
      <div className="row between">
        <div className="cw-label">{t('Exercises')}{ex.length > 0 && <span className="muted small"> · {exCount(ex.length)}</span>}</div>
        <Button size="sm" variant="tinted" icon="plus" onClick={addExercise}>{t('Add exercise')}</Button>
      </div>
      {ex.length === 0 ? <p className="small muted">{t('No exercises yet.')}</p> : <ul className="cw-list">
        {ex.map((e, i) => {
          const item = exOr(e.id)
          return <li key={i + ':' + e.id} className="cw-ex">
            <div className="cw-ex-m">
              <div className="cw-ex-t">{exerciseNameFor(item)}</div>
              <div className="small muted">{exLine(e, unit)}</div>
            </div>
            <span className="cw-ex-b">
              <button type="button" className="iconbtn" aria-label={t('Move up')} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="arrowUp" /></button>
              <button type="button" className="iconbtn" aria-label={t('Move down')} disabled={i === ex.length - 1} onClick={() => move(i, i + 1)}><Icon name="arrowDown" /></button>
              <button type="button" className="iconbtn" aria-label={t('Remove {0}', exerciseNameText(item))} onClick={() => setEx(cur => cur.filter((_, k) => k !== i))}><Icon name="xmark" /></button>
            </span>
          </li>
        })}
      </ul>}
    </div>

    <div className="card cw-card">
      <div className="cw-label">{t('Days')}</div>
      {loop
        ? <p className="small muted">{t('Your plan runs as a loop, so weekdays do not apply. Add this workout to the loop in Plan.')}</p>
        : <>
          <p className="small muted">{t('Pick the days you do this workout. You can change them any time in Plan.')}</p>
          <div className="cw-days" role="group" aria-label={t('Days')}>
            {order.map(d => <button key={d} type="button" className={'cw-day' + (days.includes(d) ? ' on' : '')} aria-pressed={days.includes(d)}
              aria-label={t(DAYN[d])} onClick={() => toggleDay(d)}>{t(DAYS[d])}</button>)}
          </div>
          {days.some(d => planned(d).length) && <p className="small muted">
            {t('Already planned: {0}', days.filter(d => planned(d).length).map(d => t(DAYN[d]) + ' (' + planned(d).join(', ') + ')').join('; '))}
          </p>}
        </>}
    </div>

    {dirty && <div className="row between cw-hint small muted" style={{ gap: 8 }}>
      <span>{t('Draft saved on this device, so you can come back to it.')}</span>
      <button type="button" className="chip" onClick={startOver}>{t('Start over')}</button>
    </div>}
    {!ready && <p className="small muted cw-hint">{t('Add a name and at least one exercise to save.')}</p>}
    <div className="cw-actions">
      <Button variant="primary" disabled={!ready} onClick={() => save(false)}>{t('Save workout')}</Button>
      <Button variant="tinted" disabled={!ready || !!S.active} onClick={() => save(true)}>{t('Save and start')}</Button>
    </div>
  </div>
}
