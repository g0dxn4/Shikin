import { Target } from 'lucide-react'
import { GOAL_ICON_MAP } from './goal-icons'

interface GoalIconProps {
  icon?: string | null
  size?: number
  className?: string
}

export function GoalIcon({ icon, size = 16, className }: GoalIconProps) {
  const Icon =
    icon && Object.prototype.hasOwnProperty.call(GOAL_ICON_MAP, icon) ? GOAL_ICON_MAP[icon] : Target
  return <Icon size={size} className={className} aria-hidden="true" />
}
