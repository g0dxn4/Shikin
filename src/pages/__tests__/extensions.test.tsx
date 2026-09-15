import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ExtensionsPage } from '../extensions'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ExtensionsPage', () => {
  it('renders real capability destinations without a redundant route heading', () => {
    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    )

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByText('capabilitiesTitle')).toBeInTheDocument()
    expect(screen.getByText('items.csvImport.title')).toBeInTheDocument()
    expect(screen.getByText('items.mcp.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /items.csvImport.action/ })).toHaveAttribute(
      'href',
      '/transactions'
    )
  })
})
