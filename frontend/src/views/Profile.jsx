import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, LANGS } from '../lib/i18n.js'
import { effectiveLang } from '../lib/default-lang.js'
import { goalSheet } from '../sheets.jsx'
import { ACCENTS, ACCENT_NAMES } from '../lib/format.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, SelectRow, Switch, Button } from '../components/ui.jsx'
import SpotifyCard from '../components/SpotifyCard.jsx'
import AmbientControls from '../components/AmbientControls.jsx'

export default function Profile() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const config = useStore(s => s.config)
  const { update } = useStore()

  // Saved on the profile like the Settings page does it (App then applies it everywhere), never just set on screen.
  const handleLanguageChange = lang => update(s => { s.lang = lang; s.langAuto = false })

  const handleThemeChange = (theme) => {
    update(s => { s.theme = theme })
  }

  const handleAccentChange = (accent) => {
    update(s => { s.accent = accent })
  }

  return (
    <div className="narrow">
      <div className="hdr">
        <h1>{t('Profile')}</h1>
        <div className="sub">{t('Account & Settings')}</div>
      </div>

      {/* User Account Card */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--acc)',
              color: 'var(--on-acc)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 20,
            }}
          >
            {user ? user.name.charAt(0).toUpperCase() : 'G'}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, marginBottom: 2 }}>
              {user ? user.name : t('Guest')}
            </h2>
            <div style={{ fontSize: 13, color: 'var(--label-3)' }}>
              {isGuest ? t('Local data only') : t('Account synced')}
            </div>
          </div>
        </div>
      </div>

      {/* Preferences */}
      <Section title={t('Preferences')}>
        <SelectRow
          title={t('Language')}
          value={effectiveLang(S, config)}
          options={Object.entries(LANGS).map(([code, name]) => ({ value: code, label: name }))}
          onChange={handleLanguageChange}
        />
        <SelectRow
          title={t('Theme')}
          value={S.theme || 'dark'}
          options={[
            { value: 'dark', label: t('Dark') },
            { value: 'light', label: t('Light') },
            { value: 'system', label: t('System') },
          ]}
          onChange={handleThemeChange}
        />
        <SelectRow
          title={t('Accent Color')}
          value={S.accent || 'lime'}
          options={Object.entries(ACCENTS).map(([key, color]) => ({ value: key, label: t(ACCENT_NAMES[key] || key) }))}
          onChange={handleAccentChange}
        />
      </Section>

      {/* Training Preferences */}
      <Section title={t('Training')}>
        <Row title={t('Equipment')} onClick={() => nav('/settings/equipment')}>
          <Icon name="settings" className="chev" />
        </Row>
        <Row title={t('Goals')} onClick={() => goalSheet()}>
          <Icon name="settings" className="chev" />
        </Row>
        <Row title={t('Units')} onClick={() => nav('/settings/units')}>
          <div style={{ fontSize: 13, color: 'var(--label-2)' }}>{S.unit || 'kg'}</div>
        </Row>
      </Section>

      {/* Built-in workout sound */}
      <Section title={t('Music')}>
        <div className="card"><AmbientControls /></div>
      </Section>

      {/* Spotify (optional) */}
      <SpotifyCard />

      {/* Data & Backup */}
      <Section title={t('Data & Backup')}>
        <Row title={t('Backups')} onClick={() => nav('/settings/data')}>
          <Icon name="settings" className="chev" />
        </Row>
        <Row title={t('Import / Export')} onClick={() => nav('/settings/data', { state: { find: 'Import backup' } })}>
          <Icon name="settings" className="chev" />
        </Row>
      </Section>

      {/* Account & Security */}
      {!isGuest && (
        <Section title={t('Account')}>
          <Row title={t('Passkeys')} onClick={() => nav('/settings/account', { state: { find: 'Passkeys' } })}>
            <Icon name="settings" className="chev" />
          </Row>
          <Row title={t('Sign Out')} onClick={() => nav('/settings/account')}>
            <Icon name="chevronRight" className="chev" />
          </Row>
        </Section>
      )}

      {/* Help & About */}
      <Section title={t('Help')}>
        <Row title={t('About')} onClick={() => nav('/settings/about')}>
          <Icon name="chevronRight" className="chev" />
        </Row>
        <Row title={t('Help')} onClick={() => nav('/settings/about')}>
          <Icon name="chevronRight" className="chev" />
        </Row>
      </Section>

      {/* Logout for Guests */}
      {isGuest && (
        <div className="card">
          <Button variant="ghost" className="dim" onClick={() => nav('/home')} style={{ width: '100%' }}>
            {t('Continue as Guest')}
          </Button>
        </div>
      )}
    </div>
  )
}
