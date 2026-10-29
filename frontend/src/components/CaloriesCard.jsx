// "Calories burned" on the Progress page: today's workouts, each with its estimate and the day's total, and the last 7 and
// 30 days. The figures are estimates (lib/calories.js: MET x body weight x time) and the card says so.
import { useStore } from '../store/useStore.js'
import { t, getLang, useLang } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { useLocalToday } from '../lib/use-local-today.js'
import { kcalOfDay, kcalLastDays, kcalUnit, DEFAULT_WEIGHT_KG } from '../lib/calories.js'
import { workoutDetailSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

const COPY = {
  en: {
    title: 'Calories burned', none: 'No workout yet today.',
    note: 'An estimate from how long you trained and your body weight. Not a measurement.',
    noWeight: 'Counted at {0} kg: log your body weight for a closer figure.',
    noTime: 'Some workouts have no start and end time, so their time is estimated from the sets.',
    min: '{0} min',
  },
  id: {
    title: 'Kalori terbakar', none: 'Belum ada latihan hari ini.',
    note: 'Perkiraan dari lama latihan dan berat badanmu. Bukan hasil pengukuran.',
    noWeight: 'Dihitung dengan {0} kg: catat berat badanmu agar lebih mendekati.',
    noTime: 'Sebagian latihan tidak punya jam mulai dan selesai, jadi waktunya diperkirakan dari jumlah set.',
    min: '{0} mnt',
  },
  'pt-BR': {
    title: 'Calorias queimadas', none: 'Nenhum treino hoje ainda.',
    note: 'Uma estimativa a partir da duração do treino e do seu peso. Não é uma medição.',
    noWeight: 'Calculado com {0} kg: registre seu peso para um valor mais próximo.',
    noTime: 'Alguns treinos não têm hora de início e fim, então o tempo é estimado pelas séries.',
    min: '{0} min',
  },
}
const copy = () => { const l = getLang(); return COPY[l] || COPY[String(l).split('-')[0]] || COPY.en }

export default function CaloriesCard() {
  useLang()
  const S = useStore(s => s.S)
  const today = useLocalToday()
  const c = copy()
  const unit = kcalUnit()
  const day = kcalOfDay(S, today)
  const week = kcalLastDays(S, today, 7)
  const month = kcalLastDays(S, today, 30)
  const items = day ? day.items : []
  const noWeight = [day, week, month].some(r => r && r.items.some(i => !i.est.weightKnown))
  const noTime = [day, week, month].some(r => r && r.items.some(i => !i.est.timeKnown))
  return <section className="card cal" aria-label={c.title} data-testid="calories-card">
    <h2><Icon name="flame" style={{ color: 'var(--orange)' }} /> {c.title}</h2>
    <div className="cal-hero">
      <div className="cal-v">{day ? fmtNum(day.kcal) : '–'}<span>{unit}</span></div>
      <div className="cal-s">{t('Today')}</div>
    </div>
    {items.length > 0
      ? <div className="cal-list">{items.map(({ w, est }) =>
        <button type="button" key={w.id || w.start} className="cal-row" onClick={() => workoutDetailSheet(w)}>
          <span className="cal-n">{w.name || t('Workout')}</span>
          <span className="cal-m">{c.min.replace('{0}', String(est.minutes))}</span>
          <strong className="cal-k">{fmtNum(est.kcal)} {unit}</strong>
        </button>)}</div>
      : <p className="small muted cal-none">{c.none}</p>}
    <div className="cal-sum">
      <div><span className="muted small">{t('Last 7 days')}</span><b>{week ? fmtNum(week.kcal) : '–'} <small>{unit}</small></b></div>
      <div><span className="muted small">{t('Last 30 days')}</span><b>{month ? fmtNum(month.kcal) : '–'} <small>{unit}</small></b></div>
    </div>
    <p className="small muted cal-note">{c.note}</p>
    {noWeight && <p className="small muted cal-note">{c.noWeight.replace('{0}', String(DEFAULT_WEIGHT_KG))}</p>}
    {noTime && <p className="small muted cal-note">{c.noTime}</p>}
  </section>
}
