// The body parts the exercise catalogue files its exercises under (`bp`), and the words for them. The labels are
// translation keys that already exist in every language.
import { t } from './i18n.js'

export const BP_LABEL = { back: 'Back muscles', cardio: 'Cardio', chest: 'Chest', 'lower arms': 'Forearms', 'lower legs': 'Calves', neck: 'Neck', shoulders: 'Shoulders', 'upper arms': 'Arms', 'upper legs': 'Legs', waist: 'Core', other: 'Other' }
export const bpLabel = bp => t(BP_LABEL[bp] || bp)
