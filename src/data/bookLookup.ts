import { normalizeIsbn } from '../domain/isbn'

export interface BookMatch { isbn: string; title: string; author: string; pages?: number; sourceUrl: string }
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
class LookupError extends Error {}

export function parseBook(data: unknown, isbn: string): BookMatch | null {
  const book = object(object(data)?.['ISBN:' + isbn])
  if (!book || !clean(book.title)) return null
  return {
    isbn, title: clean(book.title),
    author: Array.isArray(book.authors) ? book.authors.map(a => clean(object(a)?.name)).filter(Boolean).join(', ') : '',
    pages: typeof book.number_of_pages === 'number' && Number.isInteger(book.number_of_pages) && book.number_of_pages > 0 && book.number_of_pages <= 100000 ? book.number_of_pages : undefined,
    sourceUrl: 'https://openlibrary.org/isbn/' + isbn,
  }
}

const cache = new Map<string, { until: number; value: BookMatch | null }>()
let nextRequest = 0

/** Explicit, single-edition lookups only; no background or bulk requests. */
export async function lookupBook(input: string, signal: AbortSignal): Promise<BookMatch | null> {
  const isbn = normalizeIsbn(input)
  if (!isbn) throw Error('ISBN 10자리 또는 13자리와 마지막 확인 숫자를 확인해 주세요.')
  signal.throwIfAborted()
  const cached = cache.get(isbn)
  if (cached && cached.until > Date.now()) return cached.value
  if (Date.now() < nextRequest) throw Error('검색 요청이 너무 빨라요. 잠시 후 다시 검색해 주세요.')
  nextRequest = Date.now() + 1100
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const query = new URLSearchParams({ bibkeys: 'ISBN:' + isbn, format: 'json', jscmd: 'data' })
    const response = await fetch('https://openlibrary.org/api/books?' + query, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (response.status === 429) throw new LookupError('도서 서비스가 혼잡해요. 잠시 후 다시 검색하거나 직접 입력해 주세요.')
    if (!response.ok) throw new LookupError('도서 정보를 불러오지 못했어요. 다시 검색하거나 직접 입력해 주세요.')
    const data: unknown = await response.json()
    signal.throwIfAborted()
    const value = parseBook(data, isbn)
    if (cache.size >= 100) cache.delete(cache.keys().next().value!)
    cache.set(isbn, { until: Date.now() + 60 * 60 * 1000, value })
    return value
  } catch (error) {
    signal.throwIfAborted()
    if (controller.signal.aborted) throw Error('검색 시간이 초과됐어요. 다시 검색하거나 직접 입력해 주세요.', { cause: error })
    if (error instanceof TypeError) throw Error('도서 서비스에 연결할 수 없어요. 연결을 확인하거나 직접 입력해 주세요.', { cause: error })
    if (error instanceof LookupError) throw error
    throw Error('도서 정보를 읽을 수 없어요. 다시 검색하거나 직접 입력해 주세요.', { cause: error })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
