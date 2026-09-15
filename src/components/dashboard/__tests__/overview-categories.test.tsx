import { render, screen } from '@testing-library/react'
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
})
