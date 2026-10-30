// Quick Activities on Home: three small things worth doing any day (a drink of water, a few deep breaths, a stretch), each ticked
// once a day. Nothing to count or time. A tick pays a little XP through the core ledger (lib/gamification.js
// awardQuickActivityXp, recorded in S.xpAwarded: that record is also what makes the tick stick, so there is no state of
// its own here) and answers with a check that draws itself, a few words of thanks, a light burst of confetti, a short sound, a
// "+XP" that floats up and the XP bar moving, with a special moment when it is a new level.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t, useLang } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { useLocalToday } from '../lib/use-local-today.js'
import { QUICK_ACTIVITIES, quickDone } from '../lib/quick-activities.js'
import { awardQuickActivityXp, calculateLevel, xpToNextLevel, levelProgress } from '../lib/gamification.js'
import { actionSound } from '../lib/action-sound.js'
import Icon from './Icon.jsx'

// Each word is a literal t() call, in a function, so the string checks can see it.
const WORDS = {
  water: { name: () => t('Drink Water'), about: () => t('Take a moment to hydrate'), cat: () => t('Hydration') },
  breath: { name: () => t('Deep Breathing'), about: () => t('Take a few deep breaths'), cat: () => t('Mindfulness') },
  stretch: { name: () => t('Body Stretch'), about: () => t('Give your body a little movement'), cat: () => t('Mobility & Flexibility') },
}
const PRAISE = [() => t('Nice work!'), () => t("You're taking care of yourself!"), () => t('Small habits, big progress.'), () => t('Keep it up!')]

export const CARD_FX_MS = 2600
const CONFETTI = ['var(--acc)', 'var(--orange)', 'var(--blue)', 'var(--indigo)', 'var(--green)']
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false } }

let lastPraise = -1
/** A line of thanks, never the same twice in a row. */
export function pickPraise(random = Math.random) {
  let i = Math.floor(random() * PRAISE.length) % PRAISE.length
  if (i === lastPraise) i = (i + 1) % PRAISE.length
  lastPraise = i
  return PRAISE[i]
}

// A light burst from the tick: spread evenly round the circle, a little different each.
function Confetti({ n }) {
  return <span className="qa-conf" aria-hidden="true">
    {Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.17
      const d = 24 + (i % 4) * 9 + (n > 14 ? 10 : 0)
      return <i key={i} style={{ '--dx': Math.round(Math.cos(a) * d) + 'px', '--dy': Math.round(Math.sin(a) * d) + 'px', '--r': (i * 83) % 360 + 'deg', '--c': CONFETTI[i % CONFETTI.length], animationDelay: (i % 4) * 25 + 'ms' }} />
    })}
  </span>
}

export default function QuickActivities({ embedded = false }) {
  useLang()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const today = useLocalToday()
  const done = useMemo(() => quickDone(S, today), [S.xpAwarded, today])      // eslint-disable-line react-hooks/exhaustive-deps
  const [fx, setFx] = useState(null)               // what the last tick is showing: { id, n, gain, say, levelUp }
  const busy = useRef(false)
  const timer = useRef(0)
  const seq = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])

  const tick = id => {
    if (busy.current || done.has(id)) return
    busy.current = true
    const xp0 = Number(useStore.getState().S.xp) || 0
    let gain = 0, before = calculateLevel(xp0), after = before
    update(s => { gain = awardQuickActivityXp(s, id, today); after = calculateLevel(Number(s.xp) || 0) })
    // Nothing earned: it was already ticked (another tab, another device) or the day moved on under an open screen.
    if (!gain) { busy.current = false; return }
    const levelUp = after > before
    actionSound(levelUp ? 'levelup' : 'check')
    clearTimeout(timer.current)
    const xp1 = xp0 + gain
    setFx({ id, n: ++seq.current, gain, say: pickPraise(), levelUp, level: after, xp: xp1, from: levelUp ? 0 : levelProgress(xp0), to: levelProgress(xp1), next: xpToNextLevel(xp1) })
    timer.current = setTimeout(() => { setFx(null) }, CARD_FX_MS)
    setTimeout(() => { busy.current = false }, 350)          // a double tap is one tick
  }

  const motion = !reducedMotion()
  const Shell = embedded ? 'div' : 'section'
  return <Shell className={'qa' + (embedded ? ' qa-in' : ' card')} aria-label={t('Quick Activities')} data-testid="quick-activities">
    <div className="qa-hd" role="status" aria-live="polite">
      {fx ? <>
        <span key={fx.n} className={fx.levelUp ? 'qa-levelup' : 'qa-praise'}>
          {fx.levelUp ? t('Level up! You reached level {0}.', fx.level) : fx.say()}
        </span>
        <span className="qa-xp" key={'x' + fx.n}>
          <span className={'qa-lv' + (fx.levelUp ? ' up' : '')}>{t('Level {0}', fx.level)}</span>
          <span className="qa-num">{fx.next ? t('{0} / {1} XP', fmtNum(fx.next.current), fmtNum(fx.next.needed)) : t('{0} total XP', fmtNum(fx.xp))}</span>
          <span className="qa-bar" role="presentation"><i style={{ '--from': fx.from + '%', '--to': fx.to + '%' }} /></span>
        </span>
      </> : <>
        <h2 id="qa-h">{t('Quick Activities')}</h2>
        <span className="qa-count">{t('{0} of {1} done today', done.size, QUICK_ACTIVITIES.length)}</span>
      </>}
    </div>
    <div className="qa-list">
      {QUICK_ACTIVITIES.map(a => {
        const w = WORDS[a.id]
        const isDone = done.has(a.id)
        const mine = fx && fx.id === a.id
        return <button key={a.id} type="button" role="checkbox" aria-checked={isDone} className={'qa-row' + (isDone ? ' done' : '')}
          aria-label={isDone ? t('{0}, done', w.name()) : t('Mark {0} as done', w.name())} title={w.about()} onClick={() => tick(a.id)}>
          <span className="qa-ic"><Icon name={a.icon} /></span>
          <b>{w.name()}</b>
          <span className={'qa-box' + (isDone ? ' on' : '')} aria-hidden="true">
            {isDone && <svg className={'qa-tick' + (mine ? ' fresh' : '')} viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 7.8" /></svg>}
            {mine && motion && <Confetti key={fx.n} n={fx.levelUp ? 26 : 12} />}
          </span>
          {mine && <span className="qa-float" key={'f' + fx.n} aria-hidden="true">{t('+{0} XP', fx.gain)}</span>}
        </button>
      })}
    </div>
  </Shell>
}
