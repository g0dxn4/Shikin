import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExtensionsPage } from '../extensions'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

describe('ExtensionsPage', () => {
  it('renders without crashing', () => {
    render(<ExtensionsPage />)
    expect(screen.getByText('extensions.title')).toBeInTheDocument()
    expect(screen.getByText('extensions.items.csvImport.title')).toBeInTheDocument()
    expect(screen.getByText('extensions.items.mcp.title')).toBeInTheDocument()
  })
})
