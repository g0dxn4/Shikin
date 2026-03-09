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
  isKeylessProvider: vi.fn().mockReturnValue(false),
  isStaticModelList: vi.fn().mockReturnValue(false),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(''),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  }),
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

function getAISaveButton() {
  // The AI save button is the first 'actions.save' button (inside the config panel)
  // The second one is the data API keys save button
  const buttons = screen.getAllByRole('button', { name: /actions\.save/ })
  return buttons[0]
}

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

  it('renders provider cards', () => {
    render(<SettingsPage />)

    expect(screen.getAllByText('OpenAI').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Ollama')).toBeInTheDocument()
  })

  it('shows config panel when provider is selected', () => {
    render(<SettingsPage />)

    // OpenAI is selected by default
    expect(screen.getByText('ai.apiKey')).toBeInTheDocument()
    expect(screen.getByText('ai.model')).toBeInTheDocument()
  })

  it('save button calls saveSettings', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    // Wait for models to load and re-render to settle
    await waitFor(() => {
      expect(getAISaveButton()).toBeInTheDocument()
    })

    await user.click(getAISaveButton())

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled()
    })
  })

  it('shows success toast on save', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    render(<SettingsPage />)

    await waitFor(() => {
      expect(getAISaveButton()).toBeInTheDocument()
    })

    await user.click(getAISaveButton())

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('status.success')
    })
  })

  it('shows error toast when saveSettings rejects', async () => {
    const { toast } = await import('sonner')
    const user = userEvent.setup()
    mockSaveSettings.mockRejectedValueOnce(new Error('fail'))
    render(<SettingsPage />)

    await user.click(getAISaveButton())

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('status.error')
    })
  })
})
