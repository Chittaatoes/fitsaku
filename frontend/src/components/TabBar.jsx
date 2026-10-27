import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import Elapsed from './Elapsed.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

// Floating pill nav button - module scope to avoid re-renders
function PillButton({ active, icon, label, onClick, dot, since }) {
  return (
    <button
      className={`pill-btn${active ? ' active' : ''}${since ? ' rec' : ''}`}
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

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const trouble = useConnectionTrouble()
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

  return (
    <nav id="tabbar" className="floating-pill">
      <div className="pill-nav">
        <PillButton
          active={isHome}
          icon="house"
          label={t('Home')}
          dot={trouble && isHome}
          onClick={() => nav('/home')}
        />
        <PillButton
          active={isTrain}
          icon="dumbbell"
          label={running ? t('Resume') : t('Train')}
          since={running ? S.active.start : 0}
          onClick={running ? () => nav('/workout') : handleTrain}
        />
        <PillButton
          active={isProgress}
          icon="chart"
          label={t('Progress')}
          onClick={() => nav('/progress')}
        />
        <PillButton
          active={isProfile}
          icon="person"
          label={t('Profile')}
          onClick={() => nav('/profile')}
        />
      </div>
    </nav>
  )
}
