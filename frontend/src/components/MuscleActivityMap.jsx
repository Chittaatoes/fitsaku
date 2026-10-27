import { useMemo, useState } from 'react'
import { t, tn } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { EXDB } from '../lib/exercises-data.js'
import { exerciseNameText, fmtDate, fmtDaysAgo, isoOf } from '../lib/format.js'
import { MUSCLES, MUSCLE_NAME, musclesOf } from '../lib/muscles.js'
import { cachedMuscleActivity, activityColor, TREND_WEEKS } from '../lib/muscle-activity.js'
import { exerciseDetailSheet } from '../sheets.jsx'
import BodyMap from './BodyMap.jsx'

const setsText = n => tn('{0} set', '{0} sets', n)
const nameOf = slug => t(MUSCLE_NAME[slug])

// "2 days ago", "yesterday", in the app's language (Intl, as the Last time line of a workout does).
const agoText = (at, now) => fmtDaysAgo(isoOf(new Date(at)), isoOf(new Date(now)))

/* Progress → Muscle activity: the body drawn in one red-orange hue, stronger where recent logged
   sets are heavier on that muscle (lib/muscle-activity.js: a 10-day half-life over every session,
   a bounded 0–100 score). Front and back, each muscle selectable; selecting one shows what is behind
   its colour. The same numbers are available as a list, so nothing is only a colour. */
export default function MuscleActivityMap({ now = Date.now() }) {
  const workouts = useStore(s => s.S.workouts)
  const body = useStore(s => s.S.body)
  const [view, setView] = useState('front')
  const [selected, setSelected] = useState(null)
  const [list, setList] = useState(false)

  const activity = cachedMuscleActivity(workouts, now)
  const fills = useMemo(() => Object.fromEntries(MUSCLES.map(m => [m, activityColor(activity[m].score)])), [activity])
  const pick = slug => setSelected(cur => (cur === slug ? null : slug))
  const any = MUSCLES.some(m => activity[m].last != null)

  return <section className="card ama" aria-labelledby="ama-h">
    <div className="ama-hd">
      <div>
        <h2 id="ama-h" className="ama-t">{t('Muscle activity')}</h2>
        <p className="small muted ama-sub">{t('From the sets you logged. Older sessions count less and fade over time. Not a measure of muscle size.')}</p>
      </div>
      <div className="ama-seg" role="group" aria-label={t('Body side')}>
        {[['front', t('Front view')], ['back', t('Back view')]].map(([key, label]) =>
          <button key={key} type="button" className={'chip' + (view === key ? ' on' : '')} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
      </div>
    </div>

    <BodyMap className="tappable act-map" body={body} fills={fills} view={view} selected={selected} onMuscle={pick} />
    <div className="ama-legend" aria-hidden="true"><span>{t('Less')}</span><i /><span>{t('More')}</span></div>
    {!any && <p className="small muted ama-empty">{t('Nothing logged yet. Finish a workout and the muscles you trained will light up.')}</p>}

    {selected
      ? <Details slug={selected} row={activity[selected]} now={now} onClose={() => setSelected(null)} />
      : <p className="small muted ama-hint">{t('Tap a muscle to see its details.')}</p>}

    <button type="button" className="chip ama-list-btn" aria-expanded={list} onClick={() => setList(v => !v)}>{list ? t('Hide list') : t('Show as list')}</button>
    {list && <ul className="ama-list">
      {[...MUSCLES].sort((a, b) => activity[b].score - activity[a].score || MUSCLES.indexOf(a) - MUSCLES.indexOf(b)).map(m =>
        <li key={m}>
          <button type="button" className={selected === m ? 'on' : ''} onClick={() => pick(m)}>
            <span className="ama-ln">{nameOf(m)}</span>
            <span className="ama-ls">{activity[m].last == null ? t('Not trained yet') : agoText(activity[m].last, now)}</span>
            <span className="ama-lv">{Math.round(activity[m].score)}</span>
          </button>
        </li>)}
    </ul>}
  </section>
}

function Details({ slug, row, now, onClose }) {
  const never = row.last == null
  // Exercises the app already has for this muscle that the log does not show feeding it.
  const suggestions = useMemo(() => {
    const had = new Set(row.exercises.map(e => String(e.id)))
    return EXDB.filter(e => musclesOf(e)[slug] === 1 && !had.has(String(e.id))).slice(0, 4)
  }, [slug, row.exercises])
  const peak = Math.max(1, ...row.trend)
  return <div className="ama-d" role="region" aria-label={nameOf(slug)}>
    <div className="ama-d-hd">
      <h3 className="ama-d-t">{nameOf(slug)}</h3>
      <button type="button" className="iconbtn" aria-label={t('Close')} onClick={onClose}>×</button>
    </div>
    {never
      ? <p className="small muted">{t('No activity recorded for this muscle yet.')}</p>
      : <>
        <div className="ama-score" aria-label={t('Activity score: {0} / 100', Math.round(row.score))}>
          <div className="ama-bar"><i style={{ width: Math.max(2, row.score) + '%', background: activityColor(Math.max(row.score, 25)) }} /></div>
          <strong>{Math.round(row.score)}</strong><span className="muted small">/ 100</span>
        </div>
        <dl className="ama-facts">
          <div><dt>{t('Last 7 days')}</dt><dd>{setsText(row.sets7)}</dd></div>
          <div><dt>{t('Last 30 days')}</dt><dd>{setsText(row.sets30)}</dd></div>
          <div><dt>{t('Last trained')}</dt><dd>{fmtDate(isoOf(new Date(row.last)), true)} · {agoText(row.last, now)}</dd></div>
        </dl>
        <div className="ama-sh">{t('Sets per week, last 6 weeks')}</div>
        <div className="ama-trend" role="img" aria-label={row.trend.join(', ')}>
          {row.trend.map((v, i) => <span key={i} title={String(v)}><i style={{ height: Math.max(v ? 8 : 2, v / peak * 100) + '%' }} /></span>)}
        </div>
        <div className="ama-sh">{t('Contributing exercises')}</div>
        <ul className="ama-ex">
          {row.exercises.slice(0, 5).map(e => <li key={e.id}><span className="ama-exn">{exerciseNameText(exOr(e.id))}</span><span className="muted small">{setsText(e.sets)}</span></li>)}
        </ul>
        <p className="small muted ama-note">{t('A set counts fully for a main muscle and 40% for a supporting one.')}</p>
      </>}
    {suggestions.length > 0 && <>
      <div className="ama-sh">{t('Exercises that train this muscle')}</div>
      <div className="ama-sug">
        {suggestions.map(e => <button key={e.id} type="button" className="chip" onClick={() => exerciseDetailSheet(e)}>{exerciseNameText(e)}</button>)}
      </div>
    </>}
  </div>
}

export { TREND_WEEKS }
