import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '../settings'

const mockChangeLanguage = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: mockChangeLanguage },
  }),
}))

vi.mock('@/ai/models', () => ({
  fetchModels: vi.fn().mockResolvedValue([
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  ]),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockLoadSettings = vi.fn()
const mockSaveSettings = vi.fn()

vi.mock('@/stores/ai-store', () => ({
  useAIStore: () => ({
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    loadSettings: mockLoadSettings,
    saveSettings: mockSaveSettings,
  }),
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveSettings.mockResolvedValue(undefined)
  })

  it('calls loadSettings on mount', () => {
    render(<SettingsPage />)

    expect(mockLoadSettings).toHaveBeenCalled()
  })

  it('renders General and AI sections', () => {
    render(<SettingsPage />)

    expect(screen.getByText('sections.general')).toBeInTheDocument()
    expect(screen.getByText('sections.ai')).toBeInTheDocument()
  })

  it('renders language selector with SUPPORTED_LANGUAGES options', () => {
    render(<SettingsPage />)

    const select = screen.getByDisplayValue('English')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Español')).toBeInTheDocument()
  })

  it('renders AI section with provider, apiKey, and model fields', () => {
    render(<SettingsPage />)

    expect(screen.getByText('ai.provider')).toBeInTheDocument()
    expect(screen.getByText('ai.apiKey')).toBeInTheDocument()
    expect(screen.getByText('ai.model')).toBeInTheDocument()
  })

  it('save button calls saveSettings', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled()
    })
  })

  it('shows success toast on save', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('status.success')
    })
  })

  it('shows error toast when saveSettings rejects', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockSaveSettings.mockRejectedValueOnce(new Error('fail'))
    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'actions.save' }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('status.error')
    })
  })
})
