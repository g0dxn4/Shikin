import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import enGoals from '@/i18n/locales/en/goals.json'
import esGoals from '@/i18n/locales/es/goals.json'
import { GoalIcon } from '../goal-icon'
import { GOAL_ICON_LABEL_KEYS, GOAL_ICONS } from '../goal-icons'

const LEGACY_EMOJI_PATTERN = /🎯|🏠|✈️|🚗|🎓|💰|🏖️|💍|🏥|📱/

describe('GoalIcon', () => {
  it.each([...GOAL_ICONS])('renders legacy icon %s as SVG without emoji text', (icon) => {
    const { container } = render(<GoalIcon icon={icon} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toMatch(LEGACY_EMOJI_PATTERN)
  })

  it('falls back to a target SVG when the stored icon is unknown or empty', () => {
    const unknown = render(<GoalIcon icon="not-a-goal-icon" />)
    const empty = render(<GoalIcon icon={null} />)

    expect(unknown.container.querySelector('svg')).toBeInTheDocument()
    expect(empty.container.querySelector('svg')).toBeInTheDocument()
    expect(unknown.container.textContent ?? '').not.toMatch(LEGACY_EMOJI_PATTERN)
    expect(empty.container.textContent ?? '').not.toMatch(LEGACY_EMOJI_PATTERN)
  })

  it('defines human-readable EN and ES labels for every picker icon', () => {
    for (const icon of GOAL_ICONS) {
      const key = GOAL_ICON_LABEL_KEYS[icon]
      const enLabel = enGoals.form.iconLabels[key]
      const esLabel = esGoals.form.iconLabels[key]

      expect(enLabel).toBeTruthy()
      expect(esLabel).toBeTruthy()
      expect(enLabel).not.toMatch(LEGACY_EMOJI_PATTERN)
      expect(esLabel).not.toMatch(LEGACY_EMOJI_PATTERN)
      expect(enLabel).not.toBe(icon)
      expect(esLabel).not.toBe(icon)
    }
  })
})
