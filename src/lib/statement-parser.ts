/**
 * OFX/QFX/QIF bank statement parsers.
 * Returns parsed transactions with main-unit amounts (caller converts to centavos).
 */

export interface ParsedTransaction {
  date: string // ISO 8601 date (YYYY-MM-DD)
  amount: number // Positive magnitude; type carries direction
  description: string
  type: 'expense' | 'income'
  externalId?: string
  /** Currency declared by the source statement. Undefined means the format did not provide one. */
  currency?: string
}

const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/
const STRICT_GROUPED_NUMBER_PATTERN = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d*)?$/

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

function parseStrictAmount(raw: string, label: string, allowGroupedThousands = false): number {
  const token = raw.trim()
  const pattern = allowGroupedThousands ? STRICT_GROUPED_NUMBER_PATTERN : STRICT_NUMBER_PATTERN
  if (!pattern.test(token)) throw new Error(`${label} has invalid amount "${raw}"`)
  const amount = Number(token.replace(/,/g, ''))
  const centavos = Math.round(Math.abs(amount) * 100)
  if (!Number.isFinite(amount) || !Number.isSafeInteger(centavos) || centavos <= 0) {
    throw new Error(`${label} amount is not a positive safe centavo value`)
  }
  return amount
}

function declaredOfxCurrency(content: string): string | undefined {
  const currencies = [...content.matchAll(/<CURDEF>\s*([^<\r\n]+)/gi)].map((match) =>
    match[1].trim().toUpperCase()
  )
  for (const currency of currencies) {
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`OFX statement has invalid CURDEF currency "${currency}"`)
    }
  }
  const unique = [...new Set(currencies)]
  if (unique.length > 1) {
    throw new Error(`OFX statement contains multiple currencies (${unique.join(', ')})`)
  }
  return unique[0]
}

function assertSupportedOfxScope(content: string): void {
  const statementScopes = content.match(/<(?:STMTRS|CCSTMTRS|INVSTMTRS)>/gi) ?? []
  const accountScopes = content.match(/<(?:BANKACCTFROM|CCACCTFROM|INVACCTFROM)>/gi) ?? []
  if (statementScopes.length > 1 || accountScopes.length > 1) {
    throw new Error('OFX statement contains multiple account scopes; split it before importing')
  }
}

/** Parse one OFX/QFX statement, rejecting every malformed recognized transaction row. */
export function parseOFX(content: string): ParsedTransaction[] {
  assertSupportedOfxScope(content)
  const currency = declaredOfxCurrency(content)
  const transactions: ParsedTransaction[] = []
  const stmtTrnRegex =
    /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST|<\/STMTRS|<\/CCSTMTRS|<\/INVSTMTRS))/gi
  const blocks = [...content.matchAll(stmtTrnRegex)]
  const recognizedRowCount = content.match(/<STMTTRN>/gi)?.length ?? 0
  if (blocks.length !== recognizedRowCount) {
    throw new Error(
      `OFX transaction ${blocks.length + 1} has a malformed or unclosed STMTTRN block`
    )
  }

  let rowIndex = 0
  for (const match of blocks) {
    rowIndex++
    const block = match[1]
    const dateRaw = extractOFXField(block, 'DTPOSTED')
    const amountRaw = extractOFXField(block, 'TRNAMT')
    const name = extractOFXField(block, 'NAME')
    const memo = extractOFXField(block, 'MEMO')
    const externalId = extractOFXField(block, 'FITID')

    if (!dateRaw) throw new Error(`OFX transaction ${rowIndex} is missing DTPOSTED`)
    if (!amountRaw) throw new Error(`OFX transaction ${rowIndex} is missing TRNAMT`)
    const date = parseOFXDate(dateRaw, rowIndex)
    const amount = parseStrictAmount(amountRaw, `OFX transaction ${rowIndex}`)
    const description = (
      name && memo && name !== memo ? `${name} - ${memo}` : name || memo || 'Unknown'
    ).trim()

    transactions.push({
      date,
      amount: Math.abs(amount),
      description,
      type: amount >= 0 ? 'income' : 'expense',
      ...(externalId ? { externalId } : {}),
      ...(currency ? { currency } : {}),
    })
  }
  return transactions
}

function extractOFXField(block: string, tag: string): string | null {
  const xmlMatch = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))
  if (xmlMatch) return xmlMatch[1].trim()
  const sgmlMatch = block.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i'))
  return sgmlMatch ? sgmlMatch[1].trim() : null
}

function parseOFXDate(raw: string, rowIndex: number): string {
  const cleaned = raw.replace(/\[.*?\]/, '').trim()
  if (!/^\d{8}(?:\d{6}(?:\.\d+)?)?$/.test(cleaned)) {
    throw new Error(`OFX transaction ${rowIndex} has invalid DTPOSTED "${raw}"`)
  }
  const iso = `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`
  if (!isRealIsoDate(iso)) {
    throw new Error(`OFX transaction ${rowIndex} has invalid calendar date "${raw}"`)
  }
  return iso
}

/** Parse QIF records, rejecting malformed recognized financial records instead of omitting them. */
export function parseQIF(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []
  const lines = content.split(/\r?\n/)
  let currentDate: string | null = null
  let currentAmount: number | null = null
  let currentPayee = ''
  let currentMemo = ''
  let hasData = false
  let recordIndex = 1

  const flush = () => {
    if (!hasData) return
    if (!currentDate) throw new Error(`QIF transaction ${recordIndex} is missing a valid date`)
    if (currentAmount === null)
      throw new Error(`QIF transaction ${recordIndex} is missing an amount`)
    transactions.push({
      date: currentDate,
      amount: Math.abs(currentAmount),
      description: currentPayee || currentMemo || 'Unknown',
      type: currentAmount >= 0 ? 'income' : 'expense',
    })
    currentDate = null
    currentAmount = null
    currentPayee = ''
    currentMemo = ''
    hasData = false
    recordIndex++
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('!')) continue
    const code = line[0]
    const value = line.substring(1).trim()
    switch (code) {
      case 'D':
        hasData = true
        currentDate = parseQIFDate(value, recordIndex)
        break
      case 'T':
      case 'U':
        hasData = true
        currentAmount = parseStrictAmount(value, `QIF transaction ${recordIndex}`, true)
        break
      case 'P':
        currentPayee = value
        hasData = true
        break
      case 'M':
        currentMemo = value
        hasData = true
        break
      case '^':
        flush()
        break
      default:
        break
    }
  }
  flush()
  return transactions
}

function parseQIFDate(raw: string, recordIndex: number): string {
  const token = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    if (!isRealIsoDate(token)) {
      throw new Error(`QIF transaction ${recordIndex} has invalid calendar date "${raw}"`)
    }
    return token
  }
  const parts = token.replace(/'/g, '/').replace(/-/g, '/').split('/')
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`QIF transaction ${recordIndex} has invalid date "${raw}"`)
  }
  const month = Number(parts[0])
  const day = Number(parts[1])
  let year = Number(parts[2])
  if (year < 100) year += year < 50 ? 2000 : 1900
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!isRealIsoDate(iso)) {
    throw new Error(`QIF transaction ${recordIndex} has invalid calendar date "${raw}"`)
  }
  return iso
}

export function parseStatement(content: string, filename: string): ParsedTransaction[] {
  const ext = filename.toLowerCase().split('.').pop()
  switch (ext) {
    case 'ofx':
    case 'qfx':
      return parseOFX(content)
    case 'qif':
      return parseQIF(content)
    default:
      throw new Error(`Unsupported file format: .${ext}. Supported formats: .ofx, .qfx, .qif`)
  }
}
