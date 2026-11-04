import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseBook } from '../../src/data/bookLookup'

const isbn = '9780140328721'
beforeEach(() => { vi.useFakeTimers(); vi.resetModules() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('keeps missing metadata empty and uses a trusted source link', () => {
  const value = parseBook({ ['ISBN:' + isbn]: { title: '<script>저장된 제목</script>', authors: [{ name: ' 저자 ' }, null], number_of_pages: -5, url: 'javascript:alert(1)' } }, isbn)
  expect(value).toEqual({ isbn, title: '<script>저장된 제목</script>', author: '저자', pages: undefined, sourceUrl: 'https://openlibrary.org/isbn/' + isbn })
  expect(parseBook({}, isbn)).toBeNull()
  expect(parseBook({ ['ISBN:' + isbn]: { title: 3 } }, isbn)).toBeNull()
})

it('validates before fetching, caches canonical equivalents, and limits uncached requests', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ['ISBN:' + isbn]: { title: 'Fox', number_of_pages: 96 } })))
  vi.stubGlobal('fetch', fetcher)
  const { lookupBook } = await import('../../src/data/bookLookup')
  const signal = new AbortController().signal
  await expect(lookupBook('invalid', signal)).rejects.toThrow('ISBN')
  expect(fetcher).not.toHaveBeenCalled()
  expect((await lookupBook('0140328726', signal))?.pages).toBe(96)
  expect((await lookupBook(isbn, signal))?.isbn).toBe(isbn)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' })
  await expect(lookupBook('9780804429573', signal)).rejects.toThrow('너무 빨라요')
  await vi.advanceTimersByTimeAsync(1100)
  fetcher.mockResolvedValueOnce(new Response('{}'))
  expect(await lookupBook('9780804429573', signal)).toBeNull()
})

it('reports timeout, caller cancellation and rate limits without caching failures', async () => {
  const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))
  vi.stubGlobal('fetch', fetcher)
  const { lookupBook } = await import('../../src/data/bookLookup')
  const timeout = expect(lookupBook(isbn, new AbortController().signal)).rejects.toThrow('초과')
  await vi.advanceTimersByTimeAsync(8000)
  await timeout
  const controller = new AbortController()
  const cancelled = expect(lookupBook(isbn, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await cancelled
  await vi.advanceTimersByTimeAsync(1100)
  fetcher.mockResolvedValueOnce(new Response('{}', { status: 429 }))
  await expect(lookupBook(isbn, new AbortController().signal)).rejects.toThrow('혼잡')
  await vi.advanceTimersByTimeAsync(1100)
  fetcher.mockResolvedValueOnce(new Response('not JSON'))
  await expect(lookupBook(isbn, new AbortController().signal)).rejects.toThrow('읽을 수 없어요')
  await vi.advanceTimersByTimeAsync(1100)
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(lookupBook(isbn, new AbortController().signal)).rejects.toThrow('연결할 수 없어요')
})
