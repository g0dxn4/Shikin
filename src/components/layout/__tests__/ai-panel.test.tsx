import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AIPanel } from '../ai-panel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { returnObjects?: boolean }) =>
      opts?.returnObjects ? ['How much did I spend?', 'Show my balance'] : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const mockSetAIPanelOpen = vi.fn()
let mockAiPanelOpen = true

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    aiPanelOpen: mockAiPanelOpen,
    setAIPanelOpen: mockSetAIPanelOpen,
  }),
}))

let mockIsConfigured = true

vi.mock('@/stores/ai-store', () => ({
  useAIStore: () => ({
    provider: 'openai',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    isConfigured: mockIsConfigured,
    authMode: 'api_key',
    oauthAccessToken: null,
    codexAccountId: null,
    getEffectiveApiKey: vi.fn().mockResolvedValue('sk-test'),
  }),
}))

const mockStartNewConversation = vi.fn().mockResolvedValue('conv-1')
const mockPersistMessage = vi.fn().mockResolvedValue(undefined)
const mockLoadConversations = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/conversation-store', () => ({
  useConversationStore: Object.assign(
    () => ({
      currentConversationId: null,
      conversations: [],
      isLoading: false,
      hasOlderMessages: false,
      loadedMessageCount: 0,
      loadConversations: mockLoadConversations,
      startNewConversation: mockStartNewConversation,
      switchConversation: vi.fn().mockResolvedValue([]),
      prependOlderMessages: vi.fn().mockResolvedValue([]),
      persistMessage: mockPersistMessage,
      autoTitle: vi.fn().mockResolvedValue(undefined),
      removeConversation: vi.fn().mockResolvedValue(undefined),
    }),
    { getState: () => ({ conversations: [] }) }
  ),
}))

const mockSendMessage = vi.fn()
let mockMessages: unknown[] = []
let mockStatus = 'ready'

vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: mockMessages,
    setMessages: vi.fn(),
    sendMessage: mockSendMessage,
    status: mockStatus,
  }),
}))

vi.mock('@/ai/transport', () => ({
  createTransport: vi.fn().mockReturnValue({}),
}))

vi.mock('@/ai/agent', () => ({
  createLanguageModel: vi.fn(),
}))

vi.mock('@/ai/compaction', () => ({
  shouldCompact: vi.fn().mockReturnValue(false),
  compactMessages: vi.fn(),
}))

describe('AIPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiPanelOpen = true
    mockIsConfigured = true
    mockMessages = []
    mockStatus = 'ready'
  })

  it('returns null when aiPanelOpen is false', () => {
    mockAiPanelOpen = false

    const { container } = render(<AIPanel />)

    expect(container.firstChild).toBeNull()
  })

  it('shows "noProvider" message when not configured', () => {
    mockIsConfigured = false

    render(<AIPanel />)

    expect(screen.getByText('errors.noProvider')).toBeInTheDocument()
  })

  it('configured + empty: renders suggestions and title', () => {
    render(<AIPanel />)

    expect(screen.getByText('panel.empty.title')).toBeInTheDocument()
    expect(screen.getByText('How much did I spend?')).toBeInTheDocument()
    expect(screen.getByText('Show my balance')).toBeInTheDocument()
  })

  it('suggestion click calls sendMessage', async () => {
    const user = userEvent.setup()
    render(<AIPanel />)

    await user.click(screen.getByText('How much did I spend?'))

    expect(mockSendMessage).toHaveBeenCalledWith({ text: 'How much did I spend?' })
  })

  it('close (X) button calls setAIPanelOpen(false)', async () => {
    const user = userEvent.setup()
    render(<AIPanel />)

    // Find the X close button - it's the standalone button in the header, not inside the dropdown toggle
    const closeButtons = screen.getAllByRole('button')
    // The close button has the X icon - find it by looking for buttons that aren't in conversation area
    const closeButton = closeButtons.find(
      (btn) =>
        btn.querySelector('svg') && btn.closest('.flex.h-14') && !btn.querySelector('.font-heading')
    )
    if (closeButton) {
      await user.click(closeButton)
    } else {
      // Fallback: click the last button in the header area (close button is at the end)
      await user.click(closeButtons[1])
    }

    expect(mockSetAIPanelOpen).toHaveBeenCalledWith(false)
  })

  it('input disabled when not configured', () => {
    mockIsConfigured = false

    render(<AIPanel />)

    const input = screen.getByPlaceholderText('panel.placeholder')
    expect(input).toBeDisabled()
  })

  it('input disabled when isLoading (status=streaming)', () => {
    mockStatus = 'streaming'

    render(<AIPanel />)

    const input = screen.getByPlaceholderText('panel.placeholder')
    expect(input).toBeDisabled()
  })
})
