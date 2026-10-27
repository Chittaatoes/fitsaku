import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutVolume, effectiveRoutines, effectiveRoutineIds, nextTrainingDay, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, durPart, todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, starterPlanSheet, bwDeltaColor, weighInsSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import QueueRow from '../components/QueueRow.jsx'
import GameCard from '../components/GameCard.jsx'
import QuestCard from '../components/QuestCard.jsx'
import { queueOf, queueView, weekTally, pinState } from '../lib/queue.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { useConnectionTrouble } from '../components/SyncBanner.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { dayNoteOf } from '../lib/day-notes.js'
import { weighInAt } from '../lib/bodyweight.js'
import { generateQuests } from '../lib/gamification.js'

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  // The banner switched off and the sync stuck: a dot on the gear (Settings → Show connection status).
  const trouble = useConnectionTrouble()
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  // A weekday can hold several routines. `todayRoutines` is the whole day; `routine` is the
  // first, kept for the one-routine glyph. The derived session name joins them (§9).
  const todayRoutines = effectiveRoutines(S, todayISO())
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  // A fulfilled pin (a coach session pinned to today and since done) reads as no override.
  const todayOvr = S.dayPlan[todayISO()] !== undefined && pinState(S, S.dayPlan[todayISO()]) !== 'done'
  // An open editor on a saved workout (lib/session-edit.js) holds S.active too, but it is not a
  // session in progress: the row takes you back to it as an edit, the way the tab bar does.
  const editingSaved = !!S.active?.editingWorkoutId
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const ws = weekStartOf(S)
  // The first day of the shown week. Named for the role, not for Monday — which day that is
  // is the setting.
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  // The last session logged for today, if any — what the row below reports instead of asking
  // you to start the one you already did. Last wins, so a second session names itself. Only once
  // today's plan is covered, though: a freestyle session on a planned day, or the rotation's
  // first session done when its next one is today's too, leaves the row offering what is still
  // to do, as Start and the progress row already do. A queue session is never "covered" by an
  // earlier workout: the queue only names one it does not count as done yet.
  const loggedToday = S.workouts.filter(w => w.d === todayISO())
  const queueIds = queueOf(S)?.ids || []
  const coveredToday = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const doneToday = (todayRoutines.every(r => coveredToday(r.id)) && loggedToday.at(-1)) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    // A day off with a note (#261) reads as excused, not as a plan that went by.
    const dot = done ? ' done' : dayNoteOf(S, iso) ? ' noted' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // A coach week (S.queue) read through the same tolerant reader QueueRow uses, so a malformed
  // queue from another client shows the weekday dots, never an empty card.
  const queue = queueView(S, todayISO())
  // This card shows one thing or the other — QueueRow for a live queue, or Rotation chosen with
  // nothing built yet (S.scheduleMode), in which case there is no queue for QueueRow to render and
  // an empty-state card takes its place. Plan does the same in rotation mode: no weekday grid, only
  // the days that add a routine the loop does not have (Plan.jsx, "Also on fixed days").
  const rotating = scheduleModeOf(S) === 'rotation'
  // A planner-written queue (no rotationId) still names its weekday when it hasn't started yet —
  // that copy predates rotation and stays as it is. Our own rotation has no weekday of its own
  // (lib/rotation.js): naming one here — including on the pass's own one-day empty gap (THE
  // ONE-DAY BOUNDARY, rotation.js) or before a first routine is even added — would be the
  // fixed-week model leaking into a schedule that was never weekday-based.
  const liveQ = queueOf(S)
  const plannerQueue = !!queue && !liveQ?.rotationId
  // Ownership, not mere presence of a rotationId: a stale id left over from a rebuilt rotation
  // would otherwise still read as "this app manages it" (lib/rotation.js).
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  // On a rest day, saying when you train next beats leaving the row as a full stop.
  const next = !S.active && !todayRoutines.length && !(rotating && !plannerQueue) ? nextTrainingDay(S, todayISO()) : null
  // The streak card's fraction: this calendar week's workouts over the weekdays with a plan, or,
  // in a coach week, the queue's sessions and your own days together (lib/queue.js weekTally).
  const { done: doneThisWeek, planned: plannedPerWeek } = weekTally(S, todayISO())
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: weighInAt(b), y: b.w, d: b.d }))

  // REPO Gamification
  const ws_iso = isoOf(wkStart)
  const quests = generateQuests(S, ws_iso)

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, todayISO())); else dayOverrideSheet(todayISO()) }
  // A chip on the coach week's progress row starts that one routine, in any order. A session
  // already in progress wins, as on the today row — starting another would overwrite it.
  const onQueueStart = id => { if (S.active) nav('/workout'); else startFlow([id]) }

  // The session logged last, for the "Last workout" card: what you did and how long it took.
  const lastW = S.workouts.length ? S.workouts.reduce((a, b) => ((b.d || '') >= (a.d || '') ? b : a)) : null
  const lastDur = lastW && Number.isFinite(lastW.start) && Number.isFinite(lastW.end) ? lastW.end - lastW.start : 0
  const lastVol = lastW ? Math.round(workoutVolume(lastW)) : 0

  return <div className="narrow home">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : 'FitSaku'}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={trouble ? t('Settings') + ', ' + t('Connection problem') : t('Settings')}><Icon name="gear" />{trouble && <span className="tab-dot" aria-hidden="true" />}</button>
    </div>

    {/* Just getting started: the way in comes first, before anything that would be empty. */}
    {!S.routines.length && !S.active && (
      <div className="card home-welcome">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="calendar" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going, or grab a ready-made starter plan.')}</div>
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/train/new')}>{t('Build my own plan')}</Button>
      </div>
    )}

    {/* Hero: what to do now, then the week around it. */}
    <div className="card home-hero">
      {/* Once today's session is logged the row stops asking for it (issue #4). An in-progress
          session still wins. Tapping keeps working, so a second session is a tap away. */}
      <div className="today-row" {...tappable(onToday)}>
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)', color: !S.active && !doneToday && routine ? 'var(--on-acc)' : undefined }}>
            <Icon name={S.active ? (editingSaved ? 'pencil' : 'play') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
              style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? (editingSaved ? S.active.name : t('{0} (in progress)', S.active.name))
              : doneToday ? (doneToday.name ? t('{0} (done)', doneToday.name) : t('Workout done'))
              : routine ? todayName : t('Rest day')}{todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''}</div>
            {next && !doneToday && <div className="ss">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{editingSaved ? t('Edit') : t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>

      {/* A coach week runs by order, not by weekday, so its progress row stands in for the
          seven dots (components/QueueRow.jsx). */}
      <div className="home-week">
        {rotating ? (queue ? <QueueRow S={S} today={todayISO()} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
          {t('No rotation yet. Add routines to it in Plan.')}
          <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/plan')}>{t('Set up in Plan')}</Button></div>
        </div>) : <>
          <div className="row between" style={{ marginBottom: 6 }}>
            <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
            <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
            <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
          </div>
          <div className="week">{strip}</div>
        </>}
      </div>
      {/* The other way into the Start screen (a freestyle session, your other routines). */}
      {!S.active && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
        <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={() => nav('/workout')}>
          {t('Choose a different workout')}
        </Button>
      </div>}
    </div>

    {/* At a glance: streak, this week, total. Tapping opens the calendar. */}
    <div className="home-stats" {...tappable(() => calendarSheet())} aria-label={t('{0} week streak', streakWeeks(S))}>
      <div className="home-stat">
        <Icon name="flame" style={{ color: 'var(--orange)' }} />
        <b>{streakWeeks(S)}</b>
        <span>{t('Week streak')}</span>
      </div>
      <div className="home-stat">
        <Icon name="calendar" style={{ color: 'var(--acc)' }} />
        <b>{doneThisWeek}{plannedPerWeek ? <small>/{plannedPerWeek}</small> : null}</b>
        <span>{t('This week')}</span>
      </div>
      <div className="home-stat">
        <Icon name="dumbbell" style={{ color: 'var(--blue)' }} />
        <b>{S.workouts.length}</b>
        <span>{t('Workouts')}</span>
      </div>
    </div>

    {/* Quick actions: the things you reach for during a day. */}
    <div className="home-quick">
      <button type="button" className="home-q" onClick={() => nav('/workout')}><span style={{ background: 'var(--orange)' }}><Icon name="bolt" /></span>{t('Quick start')}</button>
      <button type="button" className="home-q" onClick={() => bwSheet()}><span style={{ background: 'var(--green)' }}><Icon name="scale" /></span>{t('Log weight')}</button>
      <button type="button" className="home-q" onClick={() => nav('/library')}><span style={{ background: 'var(--indigo)' }}><Icon name="dumbbell" /></span>{t('Exercises')}</button>
      {/* Jump to the gym check-in cards (QR membership codes); folds away via the Settings switch. */}
      {S.checkIn !== false && <button type="button" className="home-q" onClick={() => nav('/checkin')}><span style={{ background: 'var(--blue)' }}><Icon name="qr" /></span>{t('Check in')}</button>}
    </div>

    {lastW && <div className="card tappable home-last" {...tappable(() => nav('/history'))}>
      <div className="row between">
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Last workout')}</div>
          <div className="ttl">{lastW.name || t('Workout done')}</div>
          <div className="small muted">{[fmtDate(lastW.d, true), ...durPart(lastDur), lastVol > 0 ? fmtNum(lastVol) + ' ' + S.unit : null].filter(Boolean).join(' · ')}</div>
        </div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>}

    {/* REPO Gamification: XP/Level and the week's quests */}
    <GameCard xp={S.xp || 0} level={S.level || 1} />
    {quests.length > 0 && <div style={{ marginBottom: 12 }}>
      <div className="home-h">{t('This week')}</div>
      {quests.map(q => <QuestCard key={q.id} quest={q} />)}
    </div>}

    {S.showWeightCard !== false && <div className="card">
      <div className="row between bw-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginInlineStart: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
        {/* every weigh-in, week by week with its average (Discord 'Weight') */}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <Button size="sm" variant="ghost" trailingIcon="chevronRight" onClick={weighInsSheet}>{t('All weigh-ins')}</Button>
        </div>
      </> : <div className="muted small">{S.weighIn === false
        ? t('No weigh-ins yet. Log your weight to start the curve.')
        : t("No weigh-ins yet. Log your weight to start the curve (we also ask before every workout).")}</div>}
    </div>}
  </div>
}
