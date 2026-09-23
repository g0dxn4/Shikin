import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { OverviewCategories } from '../overview-categories'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('OverviewCategories', () => {
  it('scales unsorted amounts against the true maximum without inflating zero spending', () => {
    render(
      <MemoryRouter>
        <OverviewCategories
          items={[
            { categoryId: 'small', name: 'Smaller', amount: 10000, percent: 33, color: null },
            { categoryId: 'large', name: 'Larger', amount: 20000, percent: 67, color: null },
            { categoryId: 'zero', name: 'Zero', amount: 0, percent: 0, color: null },
          ]}
          total={30000}
          displayCurrency="USD"
          comparisonLabel="Last month"
          dateFrom="2026-09-01"
          dateTo="2026-09-30"
        />
      </MemoryRouter>
    )

    for (const [name, width] of [
      ['Smaller', '50%'],
      ['Larger', '100%'],
      ['Zero', '0%'],
    ]) {
      expect(
        screen.getByRole('link', { name: new RegExp(name) }).querySelector('[style]')
      ).toHaveStyle({ width })
    }
  })

  it('uses extra width for expanded categories instead of a single tall column', async () => {
    const user = userEvent.setup()
    const items = Array.from({ length: 6 }, (_, index) => ({
      categoryId: `cat-${index}`,
      name: `Category ${index}`,
      amount: (index + 1) * 1000,
      percent: 10,
      color: null,
    }))

    const { container } = render(
      <MemoryRouter>
        <OverviewCategories
          items={items}
          total={21000}
          displayCurrency="USD"
          comparisonLabel="Last month"
          dateFrom="2026-09-01"
          dateTo="2026-09-30"
        />
      </MemoryRouter>
    )

    const list = container.querySelector('.grid.gap-1\\.5')
    expect(list).not.toHaveClass('md:grid-cols-2')

    await user.click(screen.getByRole('button', { name: 'overview.showAllCategories' }))
    expect(list).toHaveClass('md:grid-cols-2')
    expect(screen.getAllByRole('link')).toHaveLength(6)
  })
})
