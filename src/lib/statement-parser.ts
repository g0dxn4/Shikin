/**
 * OFX/QFX/QIF bank statement parsers.
 * Returns parsed transactions with dollar amounts (caller converts to centavos).
 */

export interface ParsedTransaction {
  date: string // ISO 8601 date (YYYY-MM-DD)
  amount: number // Dollar amount (positive = income, negative = expense)
  description: string
  type: 'expense' | 'income'
}

/**
 * Parse an OFX or QFX file (SGML/XML-like format).
 * Extracts STMTTRN blocks containing DTPOSTED, TRNAMT, NAME, and MEMO fields.
 */
export function parseOFX(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []

  // OFX can be SGML (no closing tags) or XML. We handle both.
  // Split on STMTTRN blocks
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST|<\/STMTRS))/gi
  const blocks = content.matchAll(stmtTrnRegex)

  for (const match of blocks) {
    const block = match[1]

    const dateRaw = extractOFXField(block, 'DTPOSTED')
    const amountRaw = extractOFXField(block, 'TRNAMT')
    const name = extractOFXField(block, 'NAME')
    const memo = extractOFXField(block, 'MEMO')

    if (!dateRaw || !amountRaw) continue

    const date = parseOFXDate(dateRaw)
    const amount = parseFloat(amountRaw)
    if (isNaN(amount)) continue

    // Use NAME if available, fall back to MEMO, combine if both exist
    let description = ''
    if (name && memo && name !== memo) {
      description = `${name} - ${memo}`
    } else {
      description = name || memo || 'Unknown'
    }
    description = description.trim()

    transactions.push({
      date,
      amount: Math.abs(amount),
      description,
      type: amount >= 0 ? 'income' : 'expense',
    })
  }

  return transactions
}

/**
 * Extract a field value from an OFX SGML block.
 * Handles both SGML style (<TAG>value) and XML style (<TAG>value</TAG>).
 */
function extractOFXField(block: string, tag: string): string | null {
  // XML style: <TAG>value</TAG>
  const xmlRegex = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i')
  const xmlMatch = block.match(xmlRegex)
  if (xmlMatch) return xmlMatch[1].trim()

  // SGML style: <TAG>value (terminated by newline or next tag)
  const sgmlRegex = new RegExp(`<${tag}>([^<\\r\\n]+)`, 'i')
  const sgmlMatch = block.match(sgmlRegex)
  if (sgmlMatch) return sgmlMatch[1].trim()

  return null
}

/**
 * Parse OFX date format: YYYYMMDD or YYYYMMDDHHMMSS or YYYYMMDDHHMMSS.XXX[TZ]
 * Returns ISO 8601 date string (YYYY-MM-DD).
 */
function parseOFXDate(raw: string): string {
  // Strip timezone info in brackets like [0:GMT] or [-5:EST]
  const cleaned = raw.replace(/\[.*?\]/, '').trim()
  const year = cleaned.substring(0, 4)
  const month = cleaned.substring(4, 6)
  const day = cleaned.substring(6, 8)
  return `${year}-${month}-${day}`
}

/**
 * Parse a QIF (Quicken Interchange Format) file.
 * Line-based format where each field starts with a type character:
 *   D = date, T = amount, P = payee, M = memo, ^ = end of record
 */
export function parseQIF(content: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = []
  const lines = content.split(/\r?\n/)

  let currentDate = ''
  let currentAmount = 0
  let currentPayee = ''
  let currentMemo = ''
  let hasData = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Skip header lines (e.g., !Type:Bank)
    if (line.startsWith('!')) continue

    const code = line[0]
    const value = line.substring(1).trim()

    switch (code) {
      case 'D':
        currentDate = parseQIFDate(value)
        hasData = true
        break
      case 'T':
      case 'U': // U is the "amount" field in some QIF variants
        currentAmount = parseQIFAmount(value)
        hasData = true
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
        // End of record — flush if we have data
        if (hasData && currentDate) {
          const description = currentPayee || currentMemo || 'Unknown'
          transactions.push({
            date: currentDate,
            amount: Math.abs(currentAmount),
            description,
            type: currentAmount >= 0 ? 'income' : 'expense',
          })
        }
        // Reset for next record
        currentDate = ''
        currentAmount = 0
        currentPayee = ''
        currentMemo = ''
        hasData = false
        break
      default:
        // Ignore other field types (N=check number, C=cleared, L=category, etc.)
        break
    }
  }

  // Handle last record if file doesn't end with ^
  if (hasData && currentDate) {
    const description = currentPayee || currentMemo || 'Unknown'
    transactions.push({
      date: currentDate,
      amount: Math.abs(currentAmount),
      description,
      type: currentAmount >= 0 ? 'income' : 'expense',
    })
  }

  return transactions
}

/**
 * Parse QIF date formats:
 *   M/D/YYYY, M/D'YYYY, MM/DD/YYYY, M-D-YYYY, etc.
 * Returns ISO 8601 date string (YYYY-MM-DD).
 */
function parseQIFDate(raw: string): string {
  // Replace apostrophe separator (used in some QIF files for years)
  const cleaned = raw.replace(/'/g, '/').replace(/-/g, '/')
  const parts = cleaned.split('/')

  if (parts.length !== 3) {
    // Try ISO format directly
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10)
    return new Date().toISOString().substring(0, 10)
  }

  let month = parseInt(parts[0], 10)
  let day = parseInt(parts[1], 10)
  let year = parseInt(parts[2], 10)

  // Handle 2-digit years
  if (year < 100) {
    year += year < 50 ? 2000 : 1900
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Parse QIF amount string, removing commas and handling negatives.
 */
function parseQIFAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim()
  const amount = parseFloat(cleaned)
  return isNaN(amount) ? 0 : amount
}

/**
 * Detect format from filename extension and parse accordingly.
 */
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
