import {
  Banknote,
  Car,
  Gem,
  GraduationCap,
  Home,
  Hospital,
  Palmtree,
  Plane,
  Smartphone,
  Target,
  type LucideIcon,
} from 'lucide-react'

export const DEFAULT_GOAL_ICON = '🎯'

export const GOAL_ICONS = ['🎯', '🏠', '✈️', '🚗', '🎓', '💰', '🏖️', '💍', '🏥', '📱'] as const

export type GoalIconValue = (typeof GOAL_ICONS)[number]

export const GOAL_ICON_LABEL_KEYS = {
  '🎯': 'target',
  '🏠': 'home',
  '✈️': 'travel',
  '🚗': 'car',
  '🎓': 'education',
  '💰': 'savings',
  '🏖️': 'vacation',
  '💍': 'wedding',
  '🏥': 'health',
  '📱': 'phone',
} as const satisfies Record<GoalIconValue, string>

export const GOAL_ICON_MAP: Record<string, LucideIcon> = {
  '🎯': Target,
  '🏠': Home,
  '✈️': Plane,
  '🚗': Car,
  '🎓': GraduationCap,
  '💰': Banknote,
  '🏖️': Palmtree,
  '💍': Gem,
  '🏥': Hospital,
  '📱': Smartphone,
}
