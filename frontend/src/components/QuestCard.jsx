import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

export default function QuestCard({ quest, onClick }) {
  const progressPercent = Math.round((quest.progress / quest.target) * 100)
  const isComplete = quest.progress >= quest.target

  const questIcons = {
    weekly: 'target',
    onboarding: 'book',
    consistency: 'flame',
  }

  return (
    <div className="quest-card" onClick={onClick}>
      <div className="quest-header">
        <div className="quest-icon">
          <Icon name={questIcons[quest.type] || 'target'} />
        </div>
        <div className="quest-info">
          <h3>{quest.title}</h3>
          <p>{quest.description}</p>
        </div>
      </div>

      <div className="quest-progress">
        {isComplete ? (
          <div className="quest-check">✓</div>
        ) : (
          <div className="quest-status">
            <div>{quest.progress}/{quest.target}</div>
            <div style={{ fontSize: '11px', color: 'var(--label-3)' }}>
              {progressPercent}%
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
