import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { parseEditions, parseWorks, type BookWork } from '../../src/data/bookDiscovery'

const work: BookWork = { id: 'OL45804W', title: '작품', author: '작가', sourceUrl: 'https://openlibrary.org/works/OL45804W' }
beforeEach(() => { vi.useFakeTimers(); vi.resetModules() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('filters malformed works and constructs source links without trusting remote URLs', () => {
  const result = parseWorks({ numFound: 1, docs: [null, { key: 'https://other.invalid/OL1W', title: '위조' }, { key: '/works/OL45804W', title: '작품', author_name: ['작가', null], first_publish_year: 1970 }, { key: '/works/OL45804W', title: '중복' }] }, 1)
  expect(result.items).toEqual([{ ...work, year: 1970, editions: undefined }])
  expect(result.next).toBe(false)
  expect(() => parseWorks({}, 1)).toThrow('검색 결과를 읽을 수 없어요')
})

it('keeps ISBN and page counts specific to the selected edition and leaves absent fields empty', () => {
  const result = parseEditions({ size: 2, entries: [
    { key: '/books/OL7353617M', title: '선택한 판본', isbn_10: ['0-14-032872-6'], isbn_13: ['9780140328722'], number_of_pages: 96, publishers: [' 출판사 '], publish_date: '1988', languages: [{ key: '/languages/kor' }] },
    { key: '/books/OL2M', title: '다른 판본', number_of_pages: -1, isbn_13: ['invalid'], languages: [{ key: 'javascript:alert(1)' }] },
  ] }, work, 1)
  expect(result.items[0]).toMatchObject({ isbn: '9780140328721', title: '선택한 판본', pages: 96, author: '작가', publisher: '출판사', languages: ['한국어'], sourceUrl: 'https://openlibrary.org/books/OL7353617M' })
  expect(result.items[1]).toMatchObject({ pages: undefined, isbn: undefined, languages: [] })
  expect(() => parseEditions(null, work, 1)).toThrow('판본 정보를 읽을 수 없어요')
})

it('uses separate encoded title and author queries, limited fields, pagination, and a shared cache', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ numFound: 11, docs: Array.from({ length: 10 }, (_, i) => ({ key: '/works/OL' + (i + 1) + 'W', title: '도서 ' + i })) }))))
  vi.stubGlobal('fetch', fetcher)
  const { searchBooks } = await import('../../src/data/bookDiscovery')
  const signal = new AbortController().signal
  expect((await searchBooks('title', ' 어린   왕자 & 친구 ', 1, signal)).next).toBe(true)
  const first = new URL(fetcher.mock.calls[0][0])
  expect(first.searchParams.get('title')).toBe('어린 왕자 & 친구')
  expect(first.searchParams.get('fields')).not.toContain('*')
  expect(first.searchParams.get('limit')).toBe('10')
  const next = searchBooks('author', '한강', 2, signal)
  expect(fetcher).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1100)
  await next
  const second = new URL(fetcher.mock.calls[1][0])
  expect(second.searchParams.get('author')).toBe('한강')
  expect(second.searchParams.has('title')).toBe(false)
  expect(second.searchParams.get('page')).toBe('2')
  await searchBooks('title', '어린 왕자 & 친구', 1, signal)
  expect(fetcher).toHaveBeenCalledTimes(2)
  await expect(searchBooks('title', ' ', 1, signal)).rejects.toThrow('검색어')
  await expect(searchBooks('title', '책', 101, signal)).rejects.toThrow('페이지')
})

it('cancels a queued request before fetching and does not cache malformed responses', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  const { searchBooks, bookEditions } = await import('../../src/data/bookDiscovery')
  await expect(searchBooks('title', '책', 1, new AbortController().signal)).rejects.toThrow('읽을 수 없어요')
  const controller = new AbortController()
  const cancelled = expect(bookEditions(work, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort(); await cancelled
  await vi.advanceTimersByTimeAsync(1100)
  expect(fetcher).toHaveBeenCalledTimes(1)
  fetcher.mockResolvedValueOnce(new Response('{"numFound":0,"docs":[]}'))
  expect((await searchBooks('title', '책', 1, new AbortController().signal)).items).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(2)
})
