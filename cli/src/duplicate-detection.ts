import dayjs from 'dayjs'
import { query } from './database.js'

export const TRANSACTION_DUPLICATE_WINDOW_DAYS = 7
export const TRANSACTION_DUPLICATE_SIMILARITY_THRESHOLD = 0.86

export type TransactionDuplicateKind = 'exact_duplicate' | 'potential_duplicate'

export type TransactionDuplicateInput = {
  accountId: string
  date: string
  amountCentavos: number
  type: 'expense' | 'income' | 'transfer'
  status?: 'pending' | 'posted' | 'cleared' | null
  transferToAccountId?: string | null
  description: string
  excludeTransactionId?: string
}

export type TransactionDuplicateMatch = {
  kind: TransactionDuplicateKind
  existingTransactionId: string
  accountId: string
  date: string
  amountCentavos: number
  type: 'expense' | 'income' | 'transfer'
  status: 'pending' | 'posted' | 'cleared'
  transferToAccountId: string | null
  description: string
  normalizedDescription: string
  candidateNormalizedDescription: string
  descriptionSimilarity: number
  daysApart: number
  windowDays: number
  similarityThreshold: number
}

export type TransactionDuplicateCheck = {
  input: {
    accountId: string
    date: string
    amountCentavos: number
    type: 'expense' | 'income' | 'transfer'
    status: 'pending' | 'posted' | 'cleared'
    transferToAccountId: string | null
    normalizedDescription: string
  }
  windowDays: number
  similarityThreshold: number
  match: TransactionDuplicateMatch | null
}

type DuplicateCandidateRow = {
  id: string
  account_id: string
  date: string
  amount: number
  type: 'expense' | 'income' | 'transfer'
  status: 'pending' | 'posted' | 'cleared' | null
  transfer_to_account_id: string | null
  description: string
}

export function normalizeTransactionDescriptionForDuplicate(description: string): string {
  return description
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function transactionDuplicateReason(kind: TransactionDuplicateKind): string {
  return kind === 'exact_duplicate' ? 'duplicate_transaction' : 'potential_duplicate_transaction'
}

export function findTransactionDuplicate(
  input: TransactionDuplicateInput,
  options: {
    windowDays?: number
    similarityThreshold?: number
  } = {}
): TransactionDuplicateCheck {
  const windowDays = options.windowDays ?? TRANSACTION_DUPLICATE_WINDOW_DAYS
  const similarityThreshold =
    options.similarityThreshold ?? TRANSACTION_DUPLICATE_SIMILARITY_THRESHOLD
  const normalizedDescription = normalizeTransactionDescriptionForDuplicate(input.description)
  const status = normalizeTransactionStatus(input.status)
  const transferToAccountId = input.type === 'transfer' ? (input.transferToAccountId ?? null) : null
  const checkInput = {
    accountId: input.accountId,
    date: input.date,
    amountCentavos: input.amountCentavos,
    type: input.type,
    status,
    transferToAccountId,
    normalizedDescription,
  }

  const exactCandidates = filterExcluded(
    query<DuplicateCandidateRow>(
      `SELECT id, account_id, date, amount, type, COALESCE(NULLIF(TRIM(status), ''), 'posted') as status, transfer_to_account_id, description
       FROM transactions
       WHERE account_id = $1
          AND date = $2
          AND amount = $3
          AND type = $4
          AND COALESCE(NULLIF(TRIM(status), ''), 'posted') = $5
          AND ($6 IS NULL OR transfer_to_account_id = $7)
       ORDER BY created_at DESC, id DESC`,
      [
        input.accountId,
        input.date,
        input.amountCentavos,
        input.type,
        status,
        transferToAccountId,
        transferToAccountId,
      ]
    ) ?? [],
    input.excludeTransactionId
  )
  const exactCandidate = exactCandidates.find(
    (candidate) =>
      normalizeTransactionDescriptionForDuplicate(candidate.description) === normalizedDescription
  )

  if (exactCandidate) {
    return {
      input: checkInput,
      windowDays,
      similarityThreshold,
      match: buildDuplicateMatch({
        kind: 'exact_duplicate',
        candidate: exactCandidate,
        input,
        normalizedDescription,
        similarityThreshold,
        windowDays,
      }),
    }
  }

  const startDate = dayjs(input.date).subtract(windowDays, 'day').format('YYYY-MM-DD')
  const endDate = dayjs(input.date).add(windowDays, 'day').format('YYYY-MM-DD')
  const potentialCandidates = filterExcluded(
    query<DuplicateCandidateRow>(
      `SELECT id, account_id, date, amount, type, COALESCE(NULLIF(TRIM(status), ''), 'posted') as status, transfer_to_account_id, description
       FROM transactions
       WHERE account_id = $1
          AND amount = $2
          AND type = $3
          AND COALESCE(NULLIF(TRIM(status), ''), 'posted') = $4
          AND date >= $5
          AND date <= $6
          AND ($7 IS NULL OR transfer_to_account_id = $8)
        ORDER BY ABS(julianday(date) - julianday($9)) ASC, date DESC, created_at DESC, id DESC`,
      [
        input.accountId,
        input.amountCentavos,
        input.type,
        status,
        startDate,
        endDate,
        transferToAccountId,
        transferToAccountId,
        input.date,
      ]
    ) ?? [],
    input.excludeTransactionId
  )

  const scoredCandidates = potentialCandidates
    .map((candidate) => {
      const candidateNormalizedDescription = normalizeTransactionDescriptionForDuplicate(
        candidate.description
      )
      return {
        candidate,
        candidateNormalizedDescription,
        descriptionSimilarity: descriptionSimilarity(
          normalizedDescription,
          candidateNormalizedDescription
        ),
        daysApart: daysApart(input.date, candidate.date),
      }
    })
    .filter((candidate) => candidate.descriptionSimilarity >= similarityThreshold)
    .sort(
      (a, b) =>
        b.descriptionSimilarity - a.descriptionSimilarity ||
        a.daysApart - b.daysApart ||
        b.candidate.date.localeCompare(a.candidate.date) ||
        b.candidate.id.localeCompare(a.candidate.id)
    )

  const potentialCandidate = scoredCandidates[0]
  return {
    input: checkInput,
    windowDays,
    similarityThreshold,
    match: potentialCandidate
      ? buildDuplicateMatch({
          kind: 'potential_duplicate',
          candidate: potentialCandidate.candidate,
          input,
          normalizedDescription,
          candidateNormalizedDescription: potentialCandidate.candidateNormalizedDescription,
          descriptionSimilarity: potentialCandidate.descriptionSimilarity,
          daysApart: potentialCandidate.daysApart,
          similarityThreshold,
          windowDays,
        })
      : null,
  }
}

function filterExcluded(
  rows: DuplicateCandidateRow[],
  excludeTransactionId: string | undefined
): DuplicateCandidateRow[] {
  if (!excludeTransactionId) return rows
  return rows.filter((row) => row.id !== excludeTransactionId)
}

function buildDuplicateMatch({
  kind,
  candidate,
  input,
  normalizedDescription,
  candidateNormalizedDescription = normalizeTransactionDescriptionForDuplicate(
    candidate.description
  ),
  descriptionSimilarity = 1,
  daysApart: candidateDaysApart = daysApart(input.date, candidate.date),
  windowDays,
  similarityThreshold,
}: {
  kind: TransactionDuplicateKind
  candidate: DuplicateCandidateRow
  input: TransactionDuplicateInput
  normalizedDescription: string
  candidateNormalizedDescription?: string
  descriptionSimilarity?: number
  daysApart?: number
  windowDays: number
  similarityThreshold: number
}): TransactionDuplicateMatch {
  return {
    kind,
    existingTransactionId: candidate.id,
    accountId: candidate.account_id,
    date: candidate.date,
    amountCentavos: candidate.amount,
    type: candidate.type,
    status: normalizeTransactionStatus(candidate.status),
    transferToAccountId: candidate.transfer_to_account_id,
    description: candidate.description,
    normalizedDescription,
    candidateNormalizedDescription,
    descriptionSimilarity: roundSimilarity(descriptionSimilarity),
    daysApart: candidateDaysApart,
    windowDays,
    similarityThreshold,
  }
}

function normalizeTransactionStatus(
  status: 'pending' | 'posted' | 'cleared' | null | undefined
): 'pending' | 'posted' | 'cleared' {
  return status === 'pending' || status === 'cleared' ? status : 'posted'
}

function descriptionSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0

  const distance = levenshteinDistance(a, b)
  return 1 - distance / Math.max(a.length, b.length)
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  const current = Array.from({ length: b.length + 1 }, () => 0)

  for (let aIndex = 1; aIndex <= a.length; aIndex++) {
    current[0] = aIndex
    for (let bIndex = 1; bIndex <= b.length; bIndex++) {
      const substitutionCost = a[aIndex - 1] === b[bIndex - 1] ? 0 : 1
      current[bIndex] = Math.min(
        previous[bIndex] + 1,
        current[bIndex - 1] + 1,
        previous[bIndex - 1] + substitutionCost
      )
    }

    for (let index = 0; index < previous.length; index++) {
      previous[index] = current[index]
    }
  }

  return previous[b.length]
}

function daysApart(dateA: string, dateB: string): number {
  return Math.abs(dayjs(dateA).startOf('day').diff(dayjs(dateB).startOf('day'), 'day'))
}

function roundSimilarity(value: number): number {
  return Math.round(value * 1000) / 1000
}
