export const REDACTED_FIELD_PATTERN =
  /(?:account[_-]?number|routing[_-]?number|card[_-]?number|iban|swift|secret|token|password|private[_-]?key|payer|project[_-]?reference|invoice[_-]?reference|notes?|description|url|value|summary|tags|source|reason|import[_-]?external[_-]?id|import[_-]?fingerprint|before_json|after_json|scope_json|pattern|highlights_json|breakdown_json|document_ref|replacement_transaction_ids_json|source_before_json|mirror_before_json)/i

export function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, stableJsonValue(nested)])
  )
}

export function redactStableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactStableJsonValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [
        key,
        REDACTED_FIELD_PATTERN.test(key) ? '[REDACTED]' : redactStableJsonValue(nested),
      ])
  )
}
