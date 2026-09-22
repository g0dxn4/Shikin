import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { classificationCatalog } from '@shikin/finance-core'
import { ClassificationTypesSettings } from '../classification-types-settings'
import {
  archiveClassificationType,
  createClassificationType,
  listClassificationTypes,
  reviseClassificationType,
} from '@/lib/classification-type-service'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/lib/classification-type-service', () => ({
  listClassificationTypes: vi.fn(),
  createClassificationType: vi.fn(),
  reviseClassificationType: vi.fn(),
  archiveClassificationType: vi.fn(),
}))

const mockList = vi.mocked(listClassificationTypes)
const mockCreate = vi.mocked(createClassificationType)
const mockRevise = vi.mocked(reviseClassificationType)
const mockArchive = vi.mocked(archiveClassificationType)

function catalog(name = 'Family support', revisionId = 'revision-1', archived: 0 | 1 = 0) {
  const type = {
    id: 'custom-type',
    current_revision_id: revisionId,
    archived,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  } as const
  const revision = {
    id: revisionId,
    type_id: type.id,
    version: revisionId === 'revision-1' ? 1 : 2,
    name,
    financial_treatment: 'other_income' as const,
    created_at: '2026-01-01',
  }
  return {
    definitions: classificationCatalog([type], [revision], true),
    types: [type],
    revisions: [revision],
  }
}

describe('ClassificationTypesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue(catalog())
    mockCreate.mockResolvedValue({
      type: catalog().types[0],
      revision: catalog().revisions[0],
    })
    mockRevise.mockResolvedValue({
      type: catalog('Updated', 'revision-2').types[0],
      revision: catalog('Updated', 'revision-2').revisions[0],
      changed: true,
    })
    mockArchive.mockResolvedValue({
      type: catalog('Family support', 'revision-1', 1).types[0],
      changed: true,
    })
  })

  it('shows fixed built-ins as read-only and creates a custom type with an optional audit note', async () => {
    const user = userEvent.setup()
    render(<ClassificationTypesSettings />)

    expect(await screen.findByText('Family support')).toBeInTheDocument()
    expect(screen.getAllByText('classificationTypes.builtin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('roles.other_income').length).toBeGreaterThan(0)

    await user.type(screen.getByLabelText('classificationTypes.name'), '  Gift receipts  ')
    await user.selectOptions(
      screen.getByLabelText('classificationTypes.treatment'),
      'principal_recovery'
    )
    await user.type(screen.getByLabelText('classificationTypes.auditNote'), 'Reviewed policy')
    await user.click(screen.getByRole('button', { name: 'classificationTypes.create' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: '  Gift receipts  ',
        financialTreatment: 'principal_recovery',
        auditNote: 'Reviewed policy',
      })
    )
  })

  it('requests archived rows explicitly and archives against the displayed revision', async () => {
    const user = userEvent.setup()
    render(<ClassificationTypesSettings />)
    await screen.findByText('Family support')

    await user.click(screen.getByLabelText('classificationTypes.showArchived'))
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(true))

    await user.type(screen.getByLabelText('classificationTypes.archiveAuditNote'), 'No longer used')
    await user.click(screen.getByRole('button', { name: 'classificationTypes.archive' }))
    await waitFor(() =>
      expect(mockArchive).toHaveBeenCalledWith({
        typeId: 'custom-type',
        expectedRevisionId: 'revision-1',
        auditNote: 'No longer used',
      })
    )
  })

  it('refreshes after a stale revision failure without silently applying or discarding the draft', async () => {
    const user = userEvent.setup()
    mockRevise.mockRejectedValueOnce(
      new Error('Classification type changed. Refresh and use its current revision.')
    )
    mockList
      .mockResolvedValueOnce(catalog())
      .mockResolvedValueOnce(catalog('Server-side latest name', 'revision-2'))

    render(<ClassificationTypesSettings />)
    await user.click(await screen.findByRole('button', { name: 'classificationTypes.revise' }))
    const editName = screen.getAllByLabelText('classificationTypes.name')[1]
    await user.clear(editName)
    await user.type(editName, 'My unsaved operator draft')
    await user.click(screen.getByRole('button', { name: 'classificationTypes.saveRevision' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Classification type changed')
    expect(editName).toHaveValue('My unsaved operator draft')
    expect(mockRevise).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevisionId: 'revision-1',
        name: 'My unsaved operator draft',
      })
    )
    expect(mockList).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Server-side latest name')).not.toBeInTheDocument()
  })

  it('keeps controls disabled while creation is pending', async () => {
    let resolveCreate!: (value: Awaited<ReturnType<typeof createClassificationType>>) => void
    mockCreate.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)))
    const user = userEvent.setup()
    render(<ClassificationTypesSettings />)
    await screen.findByText('Family support')

    await user.type(screen.getByLabelText('classificationTypes.name'), 'Pending type')
    await user.click(screen.getByRole('button', { name: 'classificationTypes.create' }))
    expect(screen.getByRole('button', { name: 'classificationTypes.creating' })).toBeDisabled()
    expect(screen.getByLabelText('classificationTypes.name')).toBeDisabled()

    resolveCreate({ type: catalog().types[0], revision: catalog().revisions[0] })
    await waitFor(() => expect(screen.getByLabelText('classificationTypes.name')).toBeEnabled())
    expect(screen.getByRole('button', { name: 'classificationTypes.create' })).toBeDisabled()
  })
})
