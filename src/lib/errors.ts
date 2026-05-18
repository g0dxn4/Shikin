function getDataServerErrorDetail(rawMessage: string): string | null {
  const match = rawMessage.match(/DB request failed(?:\s*\(\d+\))?:\s*([\s\S]*)$/i)
  const body = match?.[1]?.trim()

  if (!body) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(body)

    if (typeof parsed === 'string' && parsed.trim().length > 0) {
      return parsed
    }

    if (parsed && typeof parsed === 'object') {
      const details = parsed as Record<string, unknown>
      const message = details.error ?? details.message

      if (typeof message === 'string' && message.trim().length > 0) {
        return message
      }
    }
  } catch {
    // Non-JSON response bodies can still carry useful server details.
  }

  return body
}

export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  const rawMessage =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string' && error.trim().length > 0
        ? error
        : null

  if (!rawMessage) {
    return fallback
  }

  if (/Cannot reach data server/i.test(rawMessage)) {
    return 'Unable to connect to the local data service.'
  }

  if (/DB request failed/i.test(rawMessage)) {
    return getDataServerErrorDetail(rawMessage) ?? 'A database request failed.'
  }

  if (/Storage request failed/i.test(rawMessage)) {
    return 'A settings request failed.'
  }

  if (/Failed to (write|create|remove) file/i.test(rawMessage)) {
    return 'A file operation failed.'
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return fallback
}
