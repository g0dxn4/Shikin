import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ExtensionsPage } from '../extensions'

const runtimeState = vi.hoisted(() => ({ isTauri: false }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/runtime', () => ({
  get isTauri() {
    return runtimeState.isTauri
  },
}))

describe('ExtensionsPage', () => {
  beforeEach(() => {
    runtimeState.isTauri = false
  })

  it('renders real capability destinations without a redundant route heading', () => {
    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    )

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.queryByText('description')).not.toBeInTheDocument()
    expect(screen.queryByText('capabilitiesDescription')).not.toBeInTheDocument()
    expect(screen.getByText('capabilitiesTitle')).toBeInTheDocument()
    expect(screen.getByText('items.csvImport.title')).toBeInTheDocument()
    expect(screen.getByText('items.mcp.title')).toBeInTheDocument()
    const description = screen.getByText('items.csvImport.description')
    expect(description).toHaveClass('sr-only')
    expect(screen.getByRole('link', { name: /items.csvImport.action/ })).toHaveAttribute(
      'href',
      '/transactions'
    )
    expect(screen.getByRole('link', { name: /items.mcp.action/ })).toHaveAttribute(
      'href',
      '/settings?section=integrations#hosted-access'
    )
    expect(screen.getByRole('link', { name: /items.marketData.action/ })).toHaveAttribute(
      'href',
      '/settings?section=integrations#market-data'
    )
    expect(screen.getByRole('link', { name: /items.localData.action/ })).toHaveAttribute(
      'href',
      '/settings?section=data#backups'
    )
    expect(screen.getByRole('link', { name: /items.updates.action/ })).toHaveAttribute(
      'href',
      '/settings?section=data#updates'
    )

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(5)
    for (const link of links) {
      expect(link.querySelector('button')).toBeNull()
    }
    expect(links[4].closest('li')).toHaveClass('sm:col-span-2')
    expect(links[0].closest('li')).not.toHaveClass('sm:col-span-2')
    expect(links[0].querySelector('[data-status]')).toHaveAttribute('data-status', 'ready')
    expect(links[1].querySelector('[data-status]')).toHaveAttribute('data-status', 'configure')
    expect(links[2].querySelector('[data-status]')).toHaveAttribute('data-status', 'configure')
    expect(links[3].querySelector('[data-status]')).toHaveAttribute('data-status', 'ready')
    expect(links[4].querySelector('[data-status]')).toHaveAttribute('data-status', 'desktop')
  })

  it('marks signed updates ready in Tauri without treating MCP as desktop-only', () => {
    runtimeState.isTauri = true
    render(
      <MemoryRouter>
        <ExtensionsPage />
      </MemoryRouter>
    )

    const links = screen.getAllByRole('link')
    expect(links[1].querySelector('[data-status]')).toHaveAttribute('data-status', 'configure')
    expect(links[4].querySelector('[data-status]')).toHaveAttribute('data-status', 'ready')
    expect(links[4]).toHaveAttribute('href', '/settings?section=data#updates')
  })
})
