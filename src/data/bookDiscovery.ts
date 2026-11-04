import { normalizeIsbn } from '../domain/isbn'
import { clean, object, requestBooks, type BookDetails } from './bookLookup'

export type SearchKind = 'title' | 'author'
export interface BookWork { id: string; title: string; author: string; year?: number; editions?: number; sourceUrl: string }
export interface BookEdition extends BookDetails { id: string; publisher: string; published: string; languages: string[] }
export interface BookPage<T> { items: T[]; page: number; next: boolean }
const limit = 10
const strings = (value: unknown) => Array.isArray(value) ? value.map(clean).filter(Boolean) : []
const positive = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
const workId = (value: unknown) => clean(value).match(/^\/?works\/(OL\d+W)$/)?.[1]
const editionId = (value: unknown) => clean(value).match(/^\/books\/(OL\d+M)$/)?.[1]

export function parseWorks(data: unknown, page: number): BookPage<BookWork> {
  const root = object(data)
  if (!root || !Array.isArray(root.docs)) throw Error('검색 결과를 읽을 수 없어요. 다시 검색하거나 직접 입력해 주세요.')
  const seen = new Set<string>(), items: BookWork[] = []
  for (const entry of root.docs.slice(0, limit)) {
    const work = object(entry), id = workId(work?.key), title = clean(work?.title)
    if (!id || !title || seen.has(id)) continue
    seen.add(id)
    items.push({ id, title, author: strings(work?.author_name).join(', '), year: positive(work?.first_publish_year), editions: positive(work?.edition_count), sourceUrl: 'https://openlibrary.org/works/' + id })
  }
  const total = positive(root.numFound ?? root.num_found) ?? 0
  return { items, page, next: page < 100 && total > page * limit && root.docs.length >= limit }
}

export function parseEditions(data: unknown, work: BookWork, page: number): BookPage<BookEdition> {
  const root = object(data)
  if (!root || !Array.isArray(root.entries)) throw Error('판본 정보를 읽을 수 없어요. 다시 시도하거나 직접 입력해 주세요.')
  const seen = new Set<string>(), items: BookEdition[] = []
  for (const entry of root.entries.slice(0, limit)) {
    const edition = object(entry), id = editionId(edition?.key), title = clean(edition?.title)
    if (!id || !title || seen.has(id)) continue
    seen.add(id)
    const isbn = [...strings(edition?.isbn_13), ...strings(edition?.isbn_10)].map(normalizeIsbn).find(Boolean) ?? undefined
    const pages = positive(edition?.number_of_pages)
    items.push({ id, title, author: work.author, pages: pages && pages <= 100000 ? pages : undefined, isbn,
      publisher: strings(edition?.publishers).join(', '), published: clean(edition?.publish_date),
      languages: Array.isArray(edition?.languages) ? edition.languages.flatMap(language => {
        const code = clean(object(language)?.key).match(/^\/languages\/([a-z]{3})$/)?.[1]
        return code ? [({ kor: '한국어', eng: '영어', jpn: '일본어', chi: '중국어', spa: '스페인어', fre: '프랑스어' } as Record<string, string>)[code] ?? code] : []
      }) : [], sourceUrl: 'https://openlibrary.org/books/' + id })
  }
  return { items, page, next: page < 100 && (positive(root.size) ?? 0) > page * limit && root.entries.length >= limit }
}

function checkPage(page: number) { if (!Number.isInteger(page) || page < 1 || page > 100) throw Error('검색 페이지를 다시 선택해 주세요.') }
export async function searchBooks(kind: SearchKind, input: string, page: number, signal: AbortSignal): Promise<BookPage<BookWork>> {
  const query = input.trim().replace(/\s+/g, ' ')
  if (!query || query.length > 100 || !['title', 'author'].includes(kind)) throw Error('검색어를 1~100자로 입력해 주세요.')
  checkPage(page)
  const params = new URLSearchParams({ [kind]: query, fields: 'key,title,author_name,first_publish_year,edition_count', limit: String(limit), page: String(page), lang: 'ko' })
  return parseWorks(await requestBooks('/search.json?' + params, signal, true), page)
}
export async function bookEditions(work: BookWork, page: number, signal: AbortSignal): Promise<BookPage<BookEdition>> {
  if (!/^OL\d+W$/.test(work.id)) throw Error('작품을 다시 선택해 주세요.')
  checkPage(page)
  const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) })
  return parseEditions(await requestBooks('/works/' + work.id + '/editions.json?' + params, signal, true), work, page)
}
