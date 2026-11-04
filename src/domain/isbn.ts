const checkDigit = (body: string) => String((10 - [...body].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0) % 10) % 10)

/** Validates the check digit and returns the canonical ISBN-13. No catalogue claim is made. */
export function normalizeIsbn(input: string): string | null {
  const value = input.trim().replace(/^ISBN(?:-1[03])?\s*:?\s*/i, '').replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{9}[\dX]$/.test(value)) {
    const total = [...value].reduce((sum, digit, i) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - i), 0)
    if (total % 11) return null
    const body = '978' + value.slice(0, 9)
    return body + checkDigit(body)
  }
  return /^97[89]\d{10}$/.test(value) && !value.startsWith('9790') && checkDigit(value.slice(0, 12)) === value[12] ? value : null
}
