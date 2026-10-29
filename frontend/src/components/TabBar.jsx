import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

// Floating pill nav button - module scope to avoid re-renders
function PillButton({ active, peek, icon, label, onClick, dot, since }) {
  return (
    <button
      className={`pill-btn${active ? ' active' : ''}${peek ? ' peek' : ''}${since ? ' rec' : ''}`}
      onClick={onClick}
      data-label={label}
      aria-label={dot ? label + ', ' + t('Connection problem') : label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={icon} />
      {/* A minimized session's running time; the button is still named for what it does. */}
      {since > 0 && <Elapsed start={since} />}
      {dot && <span className="pill-dot" aria-hidden="true" />}
    </button>
  )
}

// The slide: press and hold anywhere on the bar, or press and drag, and a glass bubble lifts under the finger. It follows the
// finger along the bar, the tab under it lights up, and letting go goes to that tab. A plain tap is still a tap.
export const HOLD_MS = 180      // a press this long, still, lifts the bubble
export const SLIDE_PX = 6       // a drag this far lifts it at once
const BUBBLE_PAD = 14           // the bubble is a little wider than the tab it is over

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const trouble = useConnectionTrouble()
  const navRef = useRef(null)
  const [bubble, setBubble] = useState(null)          // null, or { idx, x, w }: where the bubble is and which tab it is over
  const g = useRef({ id: null, x0: 0, x: 0, engaged: false, timer: 0, suppress: 0 })
  if (!user && !isGuest) return null

  const cur = loc.pathname.split('/')[1] || 'home'
  // Map routes to REPO's four nav destinations:
  // Home: /home, /checkin, /mobile-onboarding, /permission-steps
  // Train: /plan, /workout, /library, /routine-edit
  // Progress: /stats, /history, /muscles, /structural-balance, /progress-photos, /measurements
  // Profile: /settings, /admin, /coach-chat, /coach-setup, /coach-intake
  const isHome = cur === 'home' || cur === 'checkin' || cur === 'mobile-onboarding' || cur === 'permission-steps'
  const isTrain = cur === 'train' || cur === 'plan' || cur === 'workout' || cur === 'library' || cur === 'routine-edit'
  const isProgress = cur === 'progress' || cur === 'stats' || cur === 'history' || cur === 'muscles' || cur === 'structural-balance' || cur === 'progress-photos' || cur === 'measurements'
  const isProfile = cur === 'profile' || cur === 'settings' || cur === 'admin' || cur === 'coach' || cur === 'coach-chat' || cur === 'coach-setup' || cur === 'coach-intake' || cur === 'watch-settings'

  const running = !!S.active && cur !== 'workout' && !S.active.editingWorkoutId && !S.active.backfill && S.active.start > 0
  // The Train tab always opens Train: it holds Start, your workouts and Create your own workout.
  const handleTrain = () => nav('/train')

  const tabs = [
    { key: 'home', active: isHome, icon: 'house', label: t('Home'), dot: trouble && isHome, onClick: () => nav('/home') },
    { key: 'train', active: isTrain, icon: 'dumbbell', label: running ? t('Resume') : t('Train'), since: running ? S.active.start : 0, onClick: running ? () => nav('/workout') : handleTrain },
    { key: 'progress', active: isProgress, icon: 'chart', label: t('Progress'), onClick: () => nav('/progress') },
    { key: 'profile', active: isProfile, icon: 'person', label: t('Profile'), onClick: () => nav('/profile') },
  ]

  // Which tab is under a finger at `clientX`, and where the bubble goes: centred on the finger, kept inside the bar.
  const locate = clientX => {
    const bar = navRef.current
    if (!bar) return null
    const barBox = bar.getBoundingClientRect()
    const boxes = [...bar.querySelectorAll('.pill-btn')].map(b => b.getBoundingClientRect())
    if (!boxes.length) return null
    let idx = 0, best = Infinity
    boxes.forEach((r, i) => {
      const d = clientX >= r.left && clientX <= r.right ? 0 : Math.abs(clientX - (r.left + r.right) / 2)
      if (d < best) { best = d; idx = i }
    })
    const w = boxes[idx].width + BUBBLE_PAD
    const x = Math.min(Math.max(clientX - barBox.left - w / 2, 2), Math.max(2, barBox.width - w - 2))
    return { idx, x, w }
  }
  const lift = clientX => { g.current.engaged = true; setBubble(locate(clientX)) }
  const move = clientX => {
    const next = locate(clientX)
    setBubble(prev => {
      // A new tab under the bubble is a small tick on the phones that can give one.
      if (prev && next && prev.idx !== next.idx) { try { navigator.vibrate?.(6) } catch { /* no haptics here */ } }
      return next
    })
  }

  const onPointerDown = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const s = g.current
    clearTimeout(s.timer)
    s.id = e.pointerId; s.x0 = e.clientX; s.x = e.clientX; s.engaged = false
    s.timer = setTimeout(() => { if (s.id != null && !s.engaged) lift(s.x) }, HOLD_MS)
  }
  const onPointerMove = e => {
    const s = g.current
    if (s.id == null || e.pointerId !== s.id) return
    s.x = e.clientX
    if (s.engaged) { move(e.clientX); return }
    if (Math.abs(e.clientX - s.x0) > SLIDE_PX) {
      clearTimeout(s.timer)
      try { navRef.current?.setPointerCapture(e.pointerId) } catch { /* a pointer that is already gone */ }
      lift(e.clientX)
    }
  }
  const finish = (e, commit) => {
    const s = g.current
    if (s.id == null || e.pointerId !== s.id) return
    clearTimeout(s.timer)
    const was = s.engaged
    s.id = null; s.engaged = false
    if (!was) return
    const at = locate(e.clientX)
    setBubble(null)
    try { navRef.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    // The click that follows a slide is not a tap on whatever it ended over.
    s.suppress = Date.now() + 400
    if (commit && at && tabs[at.idx]) tabs[at.idx].onClick()
  }
  const onClickCapture = e => {
    const s = g.current
    if (s.suppress && Date.now() < s.suppress) { e.preventDefault(); e.stopPropagation() }
    s.suppress = 0
  }

  return (
    <nav id="tabbar" className="floating-pill">
      <div className={'pill-nav' + (bubble ? ' sliding' : '')} ref={navRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={e => finish(e, true)} onPointerCancel={e => finish(e, false)}
        onClickCapture={onClickCapture}>
        {tabs.map((tab, i) => (
          <PillButton key={tab.key} active={tab.active} peek={!!bubble && bubble.idx === i}
            icon={tab.icon} label={tab.label} dot={tab.dot} since={tab.since} onClick={tab.onClick} />
        ))}
        {bubble && <span className="pill-bubble" data-testid="pill-bubble" data-idx={bubble.idx} aria-hidden="true"
          style={{ transform: `translateX(${bubble.x}px)`, width: bubble.w }} />}
      </div>
    </nav>
  )
}
