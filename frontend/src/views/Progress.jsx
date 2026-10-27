import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { lastBW, workoutDay } from '../lib/history.js'
import { todayISO, fmtDate, fmtNum, isoOf, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { workoutDetailSheet } from '../sheets.jsx'
import LineChart from '../components/LineChart.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import MuscleActivityMap from '../components/MuscleActivityMap.jsx'

export default function Progress() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [dateRange, setDateRange] = useState(365)

  // Workout history
  const workouts = S.workouts || []
  const completedWorkouts = workouts.length

  // Body weight trend
  const bw = lastBW(S)
  const prevBW = S.bodyweight?.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const bwDelta = bw && prevBW ? bw.w - prevBW.w : null

  // Recent workouts (last 10)
  const recentWorkouts = useMemo(() => {
    return workouts.slice(-10).reverse().map(w => ({
      ...w,
      date: w.d,
      time: workoutDay(w),
    }))
  }, [workouts])

  // Chart data for body weight (last 30 entries)
  const bwPoints = useMemo(() => {
    return S.bodyweight?.slice(-30).map(b => ({
      t: new Date(b.d).getTime(),
      y: b.w,
      d: b.d,
    })) || []
  }, [S.bodyweight])

  // Training stats
  const trainingDays = useMemo(() => {
    const days = new Set(workouts.map(w => w.d))
    return days.size
  }, [workouts])

  return (
    <div className="narrow">
      <div className="hdr">
        <h1>{t('Progress')}</h1>
        <div className="sub">{t('Training & Strength')}</div>
      </div>

      {/* XP and Gamification Progress */}
      {(S.xp || S.level) && (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 0 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--label-3)', marginBottom: 4 }}>{t('Level')}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--acc)' }}>{S.level || 1}</div>
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--label-3)', marginBottom: 4 }}>{t('XP')}</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{(S.xp || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}

      {/* Workout Stats */}
      <div className="card">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{t('Training Stats')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: 'var(--r)' }}>
            <div style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: 4 }}>{t('Total Workouts')}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{completedWorkouts}</div>
          </div>
          <div style={{ padding: '12px', background: 'var(--surface-2)', borderRadius: 'var(--r)' }}>
            <div style={{ fontSize: 12, color: 'var(--label-3)', marginBottom: 4 }}>{t('Training Days')}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{trainingDays}</div>
          </div>
        </div>
      </div>

      {/* Body Weight */}
      {bwPoints.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{t('Body Weight')}</h2>
          {bw && (
            <div style={{ marginBottom: 12, padding: '8px 0', borderBottom: '1px solid var(--sep)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--label-3)' }}>{t('Current')}</div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{fmtNum(bw.w, 1)} {S.unit}</div>
                </div>
                {bwDelta !== null && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--label-3)' }}>{t('Change')}</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: bwDelta < 0 ? 'var(--green)' : 'var(--orange)' }}>
                      {bwDelta > 0 ? '+' : ''}{fmtNum(bwDelta, 1)}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 4 }}>{t('as of {0}', fmtDate(bw.d))}</div>
            </div>
          )}
          {bwPoints.length > 1 && (
            <div style={{ height: 200 }}>
              <LineChart data={bwPoints} color="var(--acc)" yLabel={S.unit} />
            </div>
          )}
        </div>
      )}

      {/* Muscle activity: where recent logged sets went, fading with time */}
      <MuscleActivityMap />

      {/* Recent Workouts */}
      {recentWorkouts.length > 0 && (
        <div className="card">
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{t('Recent Workouts')}</h2>
          {recentWorkouts.slice(0, 5).map((w, i) => (
            <div
              key={w.d + i}
              style={{
                padding: '10px 0',
                borderBottom: i < Math.min(5, recentWorkouts.length) - 1 ? '1px solid var(--sep)' : 'none',
                cursor: 'pointer',
              }}
              onClick={() => workoutDetailSheet(w)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{w.name || t('Workout')}</div>
                  <div style={{ fontSize: 12, color: 'var(--label-3)' }}>{fmtDate(w.d)}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--label-2)' }}>{exCount(w.entries?.length || 0)}</div>
              </div>
            </div>
          ))}
          {recentWorkouts.length > 5 && (
            <Button size="sm" variant="ghost" onClick={() => nav('/history')} style={{ marginTop: 8, width: '100%' }}>
              {t('View All')} →
            </Button>
          )}
        </div>
      )}

      {/* Empty State */}
      {completedWorkouts === 0 && (
        <div className="card">
          <div className="empty">
            <Icon name="moon" style={{ fontSize: 32, marginBottom: 8 }} />
            <div>{t('No workouts yet.')}</div>
            <div style={{ marginTop: 10 }}>
              <Button size="sm" variant="tinted" onClick={() => nav('/train')}>
                {t('Start Training')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
