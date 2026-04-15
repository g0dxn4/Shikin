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
    return 'A database request failed.'
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
