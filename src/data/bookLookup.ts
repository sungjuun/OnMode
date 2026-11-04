import { normalizeIsbn } from '../domain/isbn'

export interface BookDetails { isbn?: string; title: string; author: string; pages?: number; sourceUrl: string }
export interface BookMatch extends BookDetails { isbn: string }
export const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
export const clean = (value: unknown) => typeof value === 'string' ? value.trim() : ''
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

const cache = new Map<string, { until: number; value: unknown }>()
let nextRequest = 0

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/** Shared cache and rate limit for explicit, human-triggered Open Library requests. */
export async function requestBooks(path: string, signal: AbortSignal, wait = false): Promise<unknown> {
  if (!/^\/(?:api\/books\?|search\.json\?|works\/OL\d+W\/editions\.json\?)/.test(path)) throw Error('도서 요청 주소를 확인해 주세요.')
  signal.throwIfAborted()
  const cached = cache.get(path)
  if (cached && cached.until > Date.now()) return cached.value
  while (Date.now() < nextRequest) {
    if (!wait) throw Error('검색 요청이 너무 빨라요. 잠시 후 다시 검색해 주세요.')
    await delay(nextRequest - Date.now(), signal)
    signal.throwIfAborted()
  }
  nextRequest = Date.now() + 1100
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch('https://openlibrary.org' + path, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (response.status === 429) throw new LookupError('도서 서비스가 혼잡해요. 잠시 후 다시 검색하거나 직접 입력해 주세요.')
    if (!response.ok) throw new LookupError('도서 정보를 불러오지 못했어요. 다시 검색하거나 직접 입력해 주세요.')
    const data: unknown = await response.json()
    signal.throwIfAborted()
    const root = object(data)
    const cacheable = root && (path.startsWith('/search.json?') ? Array.isArray(root.docs) : path.startsWith('/works/') ? Array.isArray(root.entries) : true)
    if (cacheable) {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!)
      cache.set(path, { until: Date.now() + 60 * 60 * 1000, value: data })
    }
    return data
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

export async function lookupBook(input: string, signal: AbortSignal): Promise<BookMatch | null> {
  const isbn = normalizeIsbn(input)
  if (!isbn) throw Error('ISBN 10자리 또는 13자리와 마지막 확인 숫자를 확인해 주세요.')
  const query = new URLSearchParams({ bibkeys: 'ISBN:' + isbn, format: 'json', jscmd: 'data' })
  return parseBook(await requestBooks('/api/books?' + query, signal), isbn)
}
