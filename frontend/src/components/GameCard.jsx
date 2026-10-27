import { calculateLevel, levelProgress, xpToNextLevel } from '../lib/gamification.js'
import { t } from '../lib/i18n.js'

export default function GameCard({ xp, level }) {
  const currentLevel = calculateLevel(xp)
  const progress = xpToNextLevel(xp)
  const progressPercent = levelProgress(xp)

  if (!progress) {
    return (
      <div className="game-card max-level">
        <div className="level-badge">
          <div className="level-circle">
            <span className="level-num">{currentLevel}</span>
          </div>
          <span className="level-title">{t('Master')}</span>
        </div>
        <div className="xp-info">
          <div className="label">{t('Total Experience')}</div>
          <div className="xp-value">{xp.toLocaleString()} {t('XP')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="game-card">
      <div className="level-badge">
        <div className="level-circle">
          <span className="level-num">{currentLevel}</span>
        </div>
        <span className="level-title">{t('Level {0}', currentLevel)}</span>
      </div>

      <div className="xp-info">
        <div className="xp-header">
          <div className="label">{t('Progress to Level {0}', currentLevel + 1)}</div>
          <div className="xp-text">{progress.current} / {progress.needed}</div>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="xp-total">{t('{0} total XP', xp)}</div>
      </div>
    </div>
  )
}
