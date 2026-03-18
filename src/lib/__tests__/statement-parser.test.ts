import { describe, it, expect } from 'vitest'
import { parseOFX, parseQIF, parseStatement } from '../statement-parser'

describe('statement-parser', () => {
  describe('parseOFX', () => {
    it('parses STMTTRN blocks with SGML style', () => {
      const ofx = `
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115
<TRNAMT>-42.50
<NAME>WHOLE FOODS
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240131
<TRNAMT>3000.00
<NAME>DIRECT DEPOSIT
</STMTTRN>`

      const result = parseOFX(ofx)
      expect(result).toHaveLength(2)

      expect(result[0].date).toBe('2024-01-15')
      expect(result[0].amount).toBe(42.50)
      expect(result[0].type).toBe('expense')
      expect(result[0].description).toBe('WHOLE FOODS')

      expect(result[1].date).toBe('2024-01-31')
      expect(result[1].amount).toBe(3000)
      expect(result[1].type).toBe('income')
      expect(result[1].description).toBe('DIRECT DEPOSIT')
    })

    it('parses XML-style OFX', () => {
      const ofx = `
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20240201120000</DTPOSTED>
<TRNAMT>-15.99</TRNAMT>
<NAME>NETFLIX</NAME>
<MEMO>Monthly subscription</MEMO>
</STMTTRN>`

      const result = parseOFX(ofx)
      expect(result).toHaveLength(1)
      expect(result[0].description).toBe('NETFLIX - Monthly subscription')
      expect(result[0].amount).toBe(15.99)
      expect(result[0].date).toBe('2024-02-01')
    })

    it('handles OFX dates with timezone brackets', () => {
      const ofx = `
<STMTTRN>
<DTPOSTED>20240315120000.000[-5:EST]
<TRNAMT>-25.00
<NAME>COFFEE SHOP
</STMTTRN>`

      const result = parseOFX(ofx)
      expect(result[0].date).toBe('2024-03-15')
    })

    it('returns empty array for empty content', () => {
      expect(parseOFX('')).toEqual([])
    })

    it('skips entries with missing date or amount', () => {
      const ofx = `
<STMTTRN>
<NAME>NO DATE OR AMOUNT
</STMTTRN>
<STMTTRN>
<DTPOSTED>20240101
<NAME>NO AMOUNT
</STMTTRN>`

      const result = parseOFX(ofx)
      expect(result).toHaveLength(0)
    })

    it('handles NAME and MEMO being the same', () => {
      const ofx = `
<STMTTRN>
<DTPOSTED>20240101
<TRNAMT>-10.00
<NAME>STORE
<MEMO>STORE
</STMTTRN>`

      const result = parseOFX(ofx)
      expect(result[0].description).toBe('STORE')
    })
  })

  describe('parseQIF', () => {
    it('parses QIF records with D/T/P/^ fields', () => {
      const qif = `!Type:Bank
D01/15/2024
T-42.50
PWhole Foods
^
D01/31/2024
T3000.00
PDirect Deposit
^`

      const result = parseQIF(qif)
      expect(result).toHaveLength(2)

      expect(result[0].date).toBe('2024-01-15')
      expect(result[0].amount).toBe(42.50)
      expect(result[0].type).toBe('expense')
      expect(result[0].description).toBe('Whole Foods')

      expect(result[1].date).toBe('2024-01-31')
      expect(result[1].amount).toBe(3000)
      expect(result[1].type).toBe('income')
    })

    it('handles last record without trailing ^', () => {
      const qif = `D03/01/2024
T-10.00
PCoffee`

      const result = parseQIF(qif)
      expect(result).toHaveLength(1)
      expect(result[0].description).toBe('Coffee')
    })

    it('handles M/D apostrophe YYYY date format', () => {
      const qif = `D1/5'2024
T-20.00
PStore
^`
      const result = parseQIF(qif)
      expect(result[0].date).toBe('2024-01-05')
    })

    it('handles 2-digit years', () => {
      const qif = `D03/15/24
T-5.00
PStore
^`
      const result = parseQIF(qif)
      expect(result[0].date).toBe('2024-03-15')
    })

    it('uses memo when payee is absent', () => {
      const qif = `D01/01/2024
T-15.00
MTransaction memo
^`
      const result = parseQIF(qif)
      expect(result[0].description).toBe('Transaction memo')
    })

    it('returns empty array for empty content', () => {
      expect(parseQIF('')).toEqual([])
    })

    it('handles amounts with commas', () => {
      const qif = `D01/01/2024
T-1,500.00
PBig Purchase
^`
      const result = parseQIF(qif)
      expect(result[0].amount).toBe(1500)
    })

    it('handles U field as amount alternative', () => {
      const qif = `D01/01/2024
U-25.00
PStore
^`
      const result = parseQIF(qif)
      expect(result[0].amount).toBe(25)
      expect(result[0].type).toBe('expense')
    })
  })

  describe('parseStatement', () => {
    it('routes .ofx files to OFX parser', () => {
      const ofx = `<STMTTRN><DTPOSTED>20240101<TRNAMT>-10.00<NAME>Test</STMTTRN>`
      const result = parseStatement(ofx, 'statement.ofx')
      expect(result).toHaveLength(1)
    })

    it('routes .qfx files to OFX parser', () => {
      const ofx = `<STMTTRN><DTPOSTED>20240101<TRNAMT>-10.00<NAME>Test</STMTTRN>`
      const result = parseStatement(ofx, 'statement.qfx')
      expect(result).toHaveLength(1)
    })

    it('routes .qif files to QIF parser', () => {
      const qif = `D01/01/2024\nT-10.00\nPTest\n^`
      const result = parseStatement(qif, 'export.qif')
      expect(result).toHaveLength(1)
    })

    it('throws for unsupported file formats', () => {
      expect(() => parseStatement('data', 'file.csv')).toThrow('Unsupported file format')
    })

    it('is case-insensitive for file extension', () => {
      const ofx = `<STMTTRN><DTPOSTED>20240101<TRNAMT>-10.00<NAME>Test</STMTTRN>`
      const result = parseStatement(ofx, 'STATEMENT.OFX')
      expect(result).toHaveLength(1)
    })
  })
})
