import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GoalProgressRing } from '../goal-progress-ring'
import { LEGACY_GOAL_SWATCH } from '../goal-presentation'

describe('GoalProgressRing', () => {
  it('draws a thin stored-color arc and exposes amount text without emoji', () => {
    const { container } = render(
      <GoalProgressRing
        progress={40}
        color="#22c55e"
        icon="🏠"
        label="House progress"
        valueText="MX$40.00 of MX$100.00, 40%"
      />
    )

    const progress = screen.getByRole('progressbar', { name: 'House progress' })
    expect(progress).toHaveAttribute('aria-valuenow', '40')
    expect(progress).toHaveAttribute('aria-valuetext', 'MX$40.00 of MX$100.00, 40%')
    expect(progress).toHaveTextContent('40%')
    const circles = container.querySelectorAll('circle')
    expect(circles).toHaveLength(2)
    expect(circles[0]).toHaveAttribute('fill', 'none')
    expect(circles[1]).toHaveAttribute('stroke', '#22c55e')
    expect(circles[1]).toHaveAttribute('fill', 'none')
    expect(Number(circles[1].getAttribute('stroke-width'))).toBeLessThanOrEqual(3)
    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(container.textContent ?? '').not.toContain('🏠')
    expect(container.querySelector('.text-primary')).not.toBeInTheDocument()
  })

  it('keeps a zero ring empty instead of painting a fallback field', () => {
    const { container } = render(
      <GoalProgressRing
        progress={0}
        color={LEGACY_GOAL_SWATCH}
        icon={null}
        label="Empty progress"
        valueText="— of —, 0%"
      />
    )

    const ring = container.querySelector('svg')
    expect(ring?.querySelectorAll('circle')).toHaveLength(1)
    expect(ring?.querySelector('circle')).toHaveAttribute('stroke', 'var(--color-border)')
  })
})
