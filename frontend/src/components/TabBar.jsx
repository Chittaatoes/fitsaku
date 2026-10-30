import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'
import { approach, settled, locateTab, settleOn, PILL_TAU, BUBBLE_TAU } from '../lib/tab-slide.js'

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

/* The tab bar, as iOS draws one: four equal tabs, an icon over its name, and one soft glass pill behind the lit tab. The pill is a
   single element that slides from tab to tab (it never changes size, and the colour of the lit tab goes where it goes).

   Press and hold anywhere on the bar, or press and drag, and the same pill lifts into a glass bubble under the finger: it follows the
   finger along the bar, the tab under it lights up, and letting go goes to that tab while the bubble settles onto it. A plain tap is
   still a tap.

   All the motion is one loop (`frame`), running only while something is on its way: the pill and the bubble ease toward where they
   are going every frame (lib/tab-slide.js approach), so they glide whatever the finger or the layout does in between. */
export const HOLD_MS = 180      // a press this long, still, lifts the bubble
export const SLIDE_PX = 6       // a drag this far lifts it at once
const SETTLE_MS = 600           // after a release, the pill heads for the tab that was chosen until the route has caught up

const raf = typeof window !== 'undefined' && window.requestAnimationFrame ? cb => window.requestAnimationFrame(cb) : cb => setTimeout(() => cb(Date.now()), 16)
const caf = typeof window !== 'undefined' && window.cancelAnimationFrame ? id => window.cancelAnimationFrame(id) : id => clearTimeout(id)
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches } catch { return false } }

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const trouble = useConnectionTrouble()
  const navRef = useRef(null)
  const pillRef = useRef(null)
  const [lift, setLift] = useState(null)          // null, or { idx }: the pill is lifted into a bubble over this tab
  const g = useRef({ id: null, x0: 0, x: 0, engaged: false, timer: 0, suppress: 0 })
  const eng = useRef({ raf: 0, at: 0, last: 0, hold: 0, pill: null, drag: null, settle: null, settleUntil: 0 })
  const tabsRef = useRef([])
  const activeRef = useRef(0)

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
  tabsRef.current = tabs
  const activeIdx = Math.max(0, tabs.findIndex(tab => tab.active))
  activeRef.current = activeIdx

  // ---- the motion ----
  const geometry = () => {
    const bar = navRef.current
    if (!bar) return null
    const barBox = bar.getBoundingClientRect()
    return { bar, barBox, inset: bar.clientLeft || 0, boxes: [...bar.querySelectorAll('.pill-btn')].map(b => b.getBoundingClientRect()) }
  }
  const frame = now => {
    const e = eng.current
    e.raf = 0
    const geo = geometry()
    const pill = pillRef.current
    if (!geo || !pill) return
    const dt = e.last ? Math.min(64, now - e.last) : 16
    e.last = now
    const reduced = reducedMotion()
    // Where the pill is going: under the finger while it is lifted, else onto the tab just chosen (until the route has caught
    // up with the choice), else onto the lit tab.
    if (e.settle != null && (activeRef.current === e.settle || clock() > e.settleUntil)) e.settle = null
    let tx, tw, tau
    if (e.drag) { tx = e.drag.tx; tw = e.drag.tw; tau = BUBBLE_TAU }
    else {
      const r = geo.boxes[e.settle != null ? e.settle : activeRef.current]
      if (!r) return
      tx = r.left - geo.barBox.left - geo.inset; tw = r.width; tau = PILL_TAU
    }
    const lit = geo.boxes[activeRef.current] || geo.boxes[0]
    const p = e.pill || (e.pill = { x: tx, w: tw })          // the first time it appears where it belongs, not sliding in
    p.x = reduced ? tx : approach(p.x, tx, dt, tau)
    p.w = reduced ? tw : approach(p.w, tw, dt, tau)
    pill.style.transform = `translateX(${p.x}px)`
    pill.style.width = p.w + 'px'
    pill.style.top = (lit.top - geo.barBox.top - (geo.bar.clientTop || 0)) + 'px'
    pill.style.height = lit.height + 'px'
    pill.classList.add('ready')
    const busy = !!e.drag || e.settle != null || !settled(p.x, tx) || !settled(p.w, tw)
    if (busy || now < e.hold) { e.raf = raf(frame); e.at = clock() }
    else e.last = 0
  }
  const kick = (holdMs = 0) => {
    const e = eng.current
    e.hold = Math.max(e.hold, clock() + holdMs)
    // A frame that was asked for and has not come in a quarter of a second is not coming (a page that is not being drawn, a
    // browser that throttles): ask again, rather than wait on it for ever.
    if (e.raf && clock() - e.at > 250) { caf(e.raf); e.raf = 0 }
    if (!e.raf) { e.raf = raf(frame); e.at = clock() }
  }
  const labelsKey = tabs.map(x => x.label + (x.since ? '*' : '')).join('|')

  // Another tab lit, or a tab changed (Train turns into Resume while a workout runs): the pill goes to the lit tab.
  useLayoutEffect(() => { kick(400) }, [activeIdx, labelsKey])         // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onResize = () => kick(120)
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); caf(eng.current.raf); eng.current.raf = 0; clearTimeout(g.current.timer) }
  }, [])                                                               // eslint-disable-line react-hooks/exhaustive-deps

  if (!user && !isGuest) return null

  const aim = clientX => {
    const geo = geometry()
    return geo && { geo, at: locateTab(geo.boxes, clientX, geo.barBox, geo.inset) }
  }
  const raise = clientX => {
    const a = aim(clientX)
    if (!a || !a.at) return
    g.current.engaged = true
    eng.current.drag = { tx: a.at.x, tw: a.at.w }
    eng.current.settle = null
    if (pillRef.current) { pillRef.current.dataset.tx = String(a.at.x); pillRef.current.dataset.tw = String(a.at.w) }
    setLift({ idx: a.at.idx })
    kick()
  }
  const follow = clientX => {
    const a = aim(clientX)
    const d = eng.current.drag
    if (!a || !a.at || !d) return
    d.tx = a.at.x; d.tw = a.at.w
    if (pillRef.current) { pillRef.current.dataset.tx = String(a.at.x); pillRef.current.dataset.tw = String(a.at.w) }
    setLift(prev => {
      if (!prev || prev.idx === a.at.idx) return prev
      // A new tab under the bubble is a small tick on the phones that can give one.
      try { navigator.vibrate?.(6) } catch { /* no haptics here */ }
      return { idx: a.at.idx }
    })
    kick()
  }

  const onPointerDown = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const s = g.current
    clearTimeout(s.timer)
    s.id = e.pointerId; s.x0 = e.clientX; s.x = e.clientX; s.engaged = false
    s.timer = setTimeout(() => { if (s.id != null && !s.engaged) raise(s.x) }, HOLD_MS)
  }
  const onPointerMove = e => {
    const s = g.current
    if (s.id == null || e.pointerId !== s.id) return
    s.x = e.clientX
    if (s.engaged) { follow(e.clientX); return }
    if (Math.abs(e.clientX - s.x0) > SLIDE_PX) {
      clearTimeout(s.timer)
      try { navRef.current?.setPointerCapture(e.pointerId) } catch { /* a pointer that is already gone */ }
      raise(e.clientX)
    }
  }
  const finish = (e, commit) => {
    const s = g.current
    if (s.id == null || e.pointerId !== s.id) return
    clearTimeout(s.timer)
    const was = s.engaged
    s.id = null; s.engaged = false
    if (!was) return
    const a = aim(e.clientX)
    try { navRef.current?.releasePointerCapture(e.pointerId) } catch { /* not captured */ }
    // The bubble lets go of the finger and settles onto the tab that was chosen, the pill it is again; if the touch was taken away
    // it goes back to the lit tab.
    const choice = commit && a && a.at ? a.at.idx : null
    eng.current.drag = null
    eng.current.settle = choice
    eng.current.settleUntil = clock() + SETTLE_MS
    setLift(null)
    kick(SETTLE_MS)
    // The click that follows a slide is not a tap on whatever it ended over.
    s.suppress = Date.now() + 400
    if (choice != null && tabsRef.current[choice]) tabsRef.current[choice].onClick()
  }
  const onClickCapture = e => {
    const s = g.current
    if (s.suppress && Date.now() < s.suppress) { e.preventDefault(); e.stopPropagation() }
    s.suppress = 0
  }

  return (
    <nav id="tabbar" className="floating-pill">
      <div className={'pill-nav' + (lift ? ' sliding' : '')} ref={navRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={e => finish(e, true)} onPointerCancel={e => finish(e, false)}
        onClickCapture={onClickCapture}>
        <span className={'pill-active' + (lift ? ' lifted' : '')} ref={pillRef} data-testid="pill-active" data-idx={lift ? lift.idx : undefined} aria-hidden="true" />
        {tabs.map((tab, i) => (
          <PillButton key={tab.key} active={tab.active} peek={!!lift && lift.idx === i}
            icon={tab.icon} label={tab.label} dot={tab.dot} since={tab.since} onClick={tab.onClick} />
        ))}
      </div>
    </nav>
  )
}
