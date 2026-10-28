import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds } from '../lib/history.js'
import { exCount, weekOrder, weekStartOf, DAYS, DAYN } from '../lib/format.js'
import { useLocalToday } from '../lib/use-local-today.js'
import { completedToday, doneCard } from '../lib/day-summary.js'
import { bpLabel } from '../lib/body-parts.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import { startFlow } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { loadDraft, isEmptyDraft } from '../lib/workout-draft.js'

export default function Train() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  // Today on the person's own clock, kept current: the card below follows the day, not the day the screen was opened.
  const today = useLocalToday()
  const todayRoutines = effectiveRoutines(S, today)
  const routineIds = effectiveRoutineIds(S, today)
  // Finished today (at least one set done, saved in the store the moment it was finished, synced or not): the card says
  // so instead of offering to start the day's plan again. A session in progress is not finished.
  const finished = !S.active ? completedToday(S, today) : null
  const card = finished ? doneCard(finished, { unit: S.unit, label: bpLabel }) : null
  // A workout started in Create your own and left unfinished (kept on this device).
  const draft = loadDraft()
  const hasDraft = !isEmptyDraft(draft)
  const order = weekOrder(weekStartOf(S))
  const daysOf = id => order.filter(d => [].concat(S.week[d] || []).includes(id))
  const todayDow = new Date(today + 'T12:00:00').getDay()

  const handleStartWorkout = () => {
    if (routineIds.length > 0) startFlow(routineIds)
    else nav('/workout')
  }

  return (
    <div className="narrow train">
      <div className="hdr">
        <h1>{t('Train')}</h1>
        <div className="sub">{t('Plan & Execute')}</div>
      </div>

      {/* A session in progress comes first: it is the one thing that is waiting for you. */}
      {S.active && <button type="button" className="train-live" onClick={() => nav('/workout')}>
        <span className="train-live-i"><Icon name="play" /></span>
        <span className="train-live-m">
          <span className="train-live-t">{S.active.editingWorkoutId ? S.active.name : t('{0} (in progress)', S.active.name)}</span>
          <span className="small">{t('Continue Session')}</span>
        </span>
        <Icon name="chevronRight" className="train-create-c" />
      </button>}

      {/* Today, once a workout is finished: what was done, and no button to start the day again. */}
      {card && <section className="card train-today train-done" aria-live="polite">
        <div className="train-done-top">
          <span className="train-done-i"><Icon name="checkCircle" /></span>
          <div>
            <div className="train-done-t">{card.title}</div>
            <div className="train-done-m">{card.message}</div>
          </div>
        </div>
        {(card.parts.length > 0 || card.chips.length > 0 || card.prs > 0) && <div className="train-done-chips">
          {card.parts.map(p => <span key={'bp-' + p} className="part">{p}</span>)}
          {card.chips.map(c => <span key={c}>{c}</span>)}
          {card.prs > 0 && <span className="pr">{card.prs} PR</span>}
        </div>}
      </section>}

      {/* Today: what is planned and one big way to start it. */}
      {!card && <section className="card train-today">
        <div className="train-h">{t("Today's Workout")}</div>
        {todayRoutines.length > 0 ? <>
          <ul className="train-today-list">
            {todayRoutines.map(r => <li key={r.id}>
              <span className="train-today-n">{r.name}</span>
              <span className="small muted">{exCount(r.ex?.length || 0)}</span>
            </li>)}
          </ul>
          <Button variant="primary" icon="play" className="train-go" disabled={!!S.active} onClick={handleStartWorkout}>{t('Start Workout')}</Button>
        </> : <div className="train-empty">
          <span className="train-empty-i"><Icon name="calendar" /></span>
          <div>{t('No workout planned for today.')}</div>
          <Button size="sm" variant="tinted" onClick={() => nav('/plan')}>{t('View Schedule')}</Button>
        </div>}
        {!S.active && <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={() => nav('/workout')}>{t('Choose a different workout')}</Button>}
      </section>}

      {/* Make your own: one tap target (views/CreateWorkout.jsx). */}
      <button type="button" className="card train-create" onClick={() => nav('/train/new')}>
        <span className="train-create-i"><Icon name="plus" /></span>
        <span className="train-create-m">
          <span className="train-create-t">{hasDraft ? t('Continue your draft') : t('Create your own workout')}</span>
          <span className="small muted">{hasDraft ? (draft.name.trim() || t('Unnamed workout')) + ' · ' + exCount(draft.ex.length) : t('Build a workout from any exercise, then choose the days you do it.')}</span>
        </span>
        <Icon name="chevronRight" className="train-create-c" />
      </button>

      {S.routines.length > 0 && <section className="train-sec">
        <div className="train-h train-h-out">{t('Your workouts')}</div>
        <div className="train-routines">
          {S.routines.map(r => {
            const days = daysOf(r.id)
            return <div key={r.id} className="card train-routine">
              <button type="button" className="train-routine-m" onClick={() => nav('/plan/r/' + r.id)} aria-label={t('Edit') + ': ' + r.name}>
                <span className="train-routine-n">{r.name}</span>
                <span className="small muted">{exCount(r.ex?.length || 0)}</span>
                {days.length > 0 && <span className="train-days" aria-label={days.map(d => t(DAYN[d])).join(', ')}>
                  {days.map(d => <span key={d} className={'train-day' + (d === todayDow ? ' today' : '')}>{t(DAYS[d])}</span>)}
                </span>}
              </button>
              <Button size="sm" variant="tinted" icon="play" className="train-start" disabled={!!S.active || !r.ex?.length} onClick={() => startFlow([r.id])}>{t('Start')}</Button>
            </div>
          })}
        </div>
      </section>}

      <section className="train-sec">
        <div className="train-h train-h-out">{t('Browse & Plan')}</div>
        <div className="train-browse">
          <button type="button" className="train-tile" onClick={() => nav('/plan')}><span style={{ background: 'var(--indigo)' }}><Icon name="calendar" /></span>{t('Schedule')}</button>
          <button type="button" className="train-tile" onClick={() => nav('/library')}><span style={{ background: 'var(--blue)' }}><Icon name="dumbbell" /></span>{t('Exercises')}</button>
          <button type="button" className="train-tile" onClick={() => nav('/history')}><span style={{ background: 'var(--orange)' }}><Icon name="history" /></span>{t('History')}</button>
        </div>
      </section>
    </div>
  )
}
