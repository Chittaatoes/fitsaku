import { t } from './i18n.js';
import { LEVEL_THRESHOLDS, calculateLevel } from './xp.js';

export { calculateLevel };

/* REPO Gamification System — XP, levels, and progression logic
   Non-destructive, idempotent, local-first design. */

// XP per action: awards are tracked by workout date + action to prevent duplicates
const XP_AWARDS = {
  workoutCompleted: 50,     // per session
  workoutPR: 25,            // bonus for hitting a new 1RM
  trainingWeekComplete: 100, // bonus for finishing all planned sessions in a week
  consistencyMilestone: 50,  // bonuses at 5, 10, 20, 50+ workout milestones
};

// ISO date + n days, by calendar arithmetic (no timezone involved).
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function xpToNextLevel(totalXp) {
  const currentLevel = calculateLevel(totalXp);
  if (currentLevel >= LEVEL_THRESHOLDS.length) return null; // max level
  const nextThreshold = LEVEL_THRESHOLDS[currentLevel];
  return {
    current: totalXp - LEVEL_THRESHOLDS[currentLevel - 1],
    needed: nextThreshold - LEVEL_THRESHOLDS[currentLevel - 1],
  };
}

export function levelProgress(totalXp) {
  const progress = xpToNextLevel(totalXp);
  if (!progress) return 100;
  return Math.round((progress.current / progress.needed) * 100);
}

// Generate weekly quests from user's training schedule
export function generateQuests(S, weekStartISO) {
  if (!S.routines || S.routines.length === 0) {
    return [{
      id: 'welcome',
      title: t('Build your first routine'),
      description: t('Create or load a training plan to start'),
      target: 1,
      progress: 0,
      completed: false,
      type: 'onboarding',
    }];
  }

  const quests = [];
  // This week's sessions only: a workout dated before the week start is not progress on it.
  const weekEnd = weekStartISO ? addDays(weekStartISO, 7) : null;
  const doneDays = new Set((S.workouts || [])
    .filter(w => !weekStartISO || (w.d >= weekStartISO && w.d < weekEnd))
    .map(w => w.d));

  // Quest 1: Complete weekly target (aim for 3-4 sessions per week)
  const targetSessions = Math.min(S.routines.length, 4);
  quests.push({
    id: 'weekly-sessions',
    title: t('Complete {0} sessions', targetSessions),
    description: t('Hit this week’s training target'),
    target: targetSessions,
    progress: doneDays.size,
    completed: doneDays.size >= targetSessions,
    type: 'weekly',
  });

  // Quest 2: Log bodyweight
  quests.push({
    id: 'weigh-in',
    title: t('Log body weight'),
    description: t('Check in with a weight reading'),
    target: 1,
    progress: S.bodyweight?.length > 0 ? 1 : 0,
    completed: S.bodyweight?.length > 0,
    type: 'weekly',
  });

  return quests;
}

// XP rule: a saved workout that holds at least one completed set earns workoutCompleted, plus
// workoutPR when it set a new weight PR. Awarded once per workout id (`S.xpAwarded[id]` holds
// what it earned), so a retried finish, a reopened summary or a re-run of this never pays twice.
// `s` is the store draft: call it inside the same update() that saves the workout, so the
// workout, the award and the level land in one write. Returns the XP added (0 when none).
export function awardWorkoutXp(s, w) {
  if (!w || w.id == null || !Array.isArray(w.entries) || !w.entries.length) return 0;
  if (!s.xpAwarded || typeof s.xpAwarded !== 'object') s.xpAwarded = {};
  if (Object.hasOwn(s.xpAwarded, w.id)) return 0;
  const earned = XP_AWARDS.workoutCompleted + (w.prs?.length ? XP_AWARDS.workoutPR : 0);
  s.xpAwarded[w.id] = earned;
  s.xp = (Number(s.xp) || 0) + earned;
  s.level = calculateLevel(s.xp);
  return earned;
}

// Check for achievement unlocks
export function checkAchievements(S) {
  const unlocked = [];
  const workoutCount = S.workouts?.length || 0;
  const achievements = S.achievements || [];

  // First workout
  if (workoutCount >= 1 && !achievements.some(a => a.id === 'first-workout')) {
    unlocked.push({ id: 'first-workout', title: 'First Step', description: 'Complete your first workout' });
  }

  // 10 workouts
  if (workoutCount >= 10 && !achievements.some(a => a.id === 'ten-workouts')) {
    unlocked.push({ id: 'ten-workouts', title: 'Getting Started', description: 'Complete 10 workouts' });
  }

  // 50 workouts
  if (workoutCount >= 50 && !achievements.some(a => a.id === 'fifty-workouts')) {
    unlocked.push({ id: 'fifty-workouts', title: 'Consistent Lifter', description: 'Complete 50 workouts' });
  }

  return unlocked;
}
