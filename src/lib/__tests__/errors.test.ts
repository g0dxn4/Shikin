import { describe, expect, it } from 'vitest'
import { getErrorMessage } from '@/lib/errors'

describe('getErrorMessage', () => {
  it('extracts JSON error details from data-server database failures', () => {
    expect(
      getErrorMessage(
        new Error('DB request failed (500): {"error":"SQLITE_CONSTRAINT: duplicate value"}')
      )
    ).toBe('SQLITE_CONSTRAINT: duplicate value')
  })

  it('extracts JSON message details from data-server database failures', () => {
    expect(
      getErrorMessage(
        new Error('DB request failed (400): {"message":"Account acc-1 is archived."}')
      )
    ).toBe('Account acc-1 is archived.')
  })

  it('falls back to plain response bodies for data-server database failures', () => {
    expect(getErrorMessage(new Error('DB request failed (500): database is locked'))).toBe(
      'database is locked'
    )
  })

  it('keeps generic database text when the data-server response has no detail', () => {
    expect(getErrorMessage(new Error('DB request failed (500): '))).toBe(
      'A database request failed.'
    )
  })

  it('keeps local data-service connection guidance', () => {
    expect(getErrorMessage(new Error('Cannot reach data server at http://127.0.0.1:1480'))).toBe(
      'Unable to connect to the local data service.'
    )
  })
})
