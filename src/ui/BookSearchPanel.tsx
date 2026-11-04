import { useEffect, useRef, useState, type FormEvent } from 'react'
import { bookEditions, searchBooks, type BookEdition, type BookPage, type BookWork, type SearchKind } from '../data/bookDiscovery'
import { lookupBook, type BookDetails, type BookMatch } from '../data/bookLookup'
import { BarcodeScanner } from './BarcodeScanner'
import { Field, messageOf } from './base'

export function BookSearchPanel({ onChoose, disabled }: { onChoose: (book: BookDetails) => void; disabled: boolean }) {
  const [mode, setMode] = useState<'isbn' | SearchKind>('isbn')
  const [query, setQuery] = useState('')
  const [match, setMatch] = useState<BookMatch | null>(null)
  const [works, setWorks] = useState<BookPage<BookWork> | null>(null)
  const [work, setWork] = useState<BookWork | null>(null)
  const [editions, setEditions] = useState<BookPage<BookEdition> | null>(null)
  const [searching, setSearching] = useState(false)
  const [status, setStatus] = useState('')
  const [scanEpoch, setScanEpoch] = useState(0)
  const [chosen, setChosen] = useState<BookDetails | null>(null)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  function cancel() { request.current?.abort(); setSearching(false) }
  function changeQuery(value: string) {
    cancel(); setScanEpoch(n => n + 1); setQuery(value); setMatch(null); setWorks(null); setWork(null); setEditions(null); setChosen(null); setStatus('')
  }
  async function perform<T>(fetcher: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void) {
    cancel(); setScanEpoch(n => n + 1)
    const controller = new AbortController(); request.current = controller
    setSearching(true); setStatus('')
    try { const result = await fetcher(controller.signal); if (!controller.signal.aborted) apply(result) }
    catch (error) { if (!controller.signal.aborted) setStatus(messageOf(error)) }
    finally { if (!controller.signal.aborted) setSearching(false) }
  }
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMatch(null); setWork(null); setEditions(null)
    if (mode === 'isbn') void perform(signal => lookupBook(query, signal), book => {
      setMatch(book); setStatus(book ? '검색 결과를 확인한 뒤 아래 양식에 적용하세요.' : '해당 ISBN의 도서 정보가 없어요. 아래에 직접 입력할 수 있어요.')
    })
    else loadWorks(1)
  }
  function loadWorks(page: number) {
    if (mode === 'isbn') return
    void perform(signal => searchBooks(mode, query, page, signal), result => {
      setWorks(result); setStatus(result.items.length ? '작품을 고른 뒤 내가 읽을 판본을 확인하세요.' : '검색 결과가 없어요. 검색어를 바꾸거나 직접 입력해 주세요.')
    })
  }
  function loadEditions(selected: BookWork, page: number) {
    if (work?.id !== selected.id) setEditions(null)
    setWork(selected)
    void perform(signal => bookEditions(selected, page, signal), result => {
      setEditions(result); setStatus(result.items.length ? '출판사·발행일·언어·ISBN을 보고 판본을 골라 주세요.' : '등록할 수 있는 판본 정보가 없어요. 직접 입력할 수 있어요.')
    })
  }
  function apply(book: BookDetails) {
    onChoose(book); setChosen(book); setMatch(null); setWorks(null); setWork(null); setEditions(null); setStatus('아래 제목·저자·페이지 수를 확인하고 수정한 뒤 저장하세요.')
  }
  return <div className="book-search">
    <div className="segmented" role="group" aria-label="도서 검색 방식">{([['isbn', 'ISBN'], ['title', '제목'], ['author', '저자']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={mode === id} disabled={disabled} onClick={() => { changeQuery(''); setMode(id) }}>{label}</button>)}</div>
    <form className="form-stack" onSubmit={search}>
      <Field label={mode === 'isbn' ? 'ISBN 검색' : mode === 'title' ? '제목 검색' : '저자 검색'}><input value={query} onChange={event => changeQuery(event.target.value)} maxLength={mode === 'isbn' ? 40 : 100} placeholder={mode === 'isbn' ? '예: 9780140328721' : mode === 'title' ? '예: 어린 왕자' : '예: 한강'} autoComplete="off" disabled={disabled} /></Field>
      <p className="muted text-sm">{mode === 'isbn' ? '책에 적힌 ISBN 10자리 또는 13자리를 입력하세요. 검색할 때만 ISBN을 Open Library로 전송합니다.' : '검색 버튼을 누를 때 검색어를 Open Library로 전송합니다. 번역본과 판본에 따라 정보가 달라요.'}</p>
      <button className="btn btn-soft" disabled={disabled || searching || !query.trim()}>{searching ? '검색 중…' : mode === 'isbn' ? 'ISBN으로 검색' : '도서 검색'}</button>
    </form>
    {mode === 'isbn' && <BarcodeScanner key={scanEpoch} disabled={disabled || searching} detected={isbn => { changeQuery(isbn); setStatus('ISBN ' + isbn + '을 인식했어요. 번호를 확인하고 ISBN으로 검색하세요.') }} />}
    <p className="text-sm" role="status" aria-live="polite">{status}</p>
    {chosen && <p className="muted text-xs">선택한 도서: {chosen.title} · <a className="text-link" href={chosen.sourceUrl} target="_blank" rel="noopener noreferrer">출처: Open Library</a></p>}
    {match && <section className="book-match" aria-label="도서 검색 결과"><h3>{match.title}</h3><p>{match.author || '저자 정보 없음'} · {match.pages ? match.pages + '쪽' : '페이지 정보 없음'}</p><p className="muted text-sm">ISBN {match.isbn}</p><a className="text-link" href={match.sourceUrl} target="_blank" rel="noopener noreferrer">출처: Open Library</a><button className="btn btn-soft" type="button" disabled={disabled} onClick={() => apply(match)}>이 정보 사용</button></section>}
    {mode !== 'isbn' && work && <section className="book-discovery" aria-label="판본 선택">
      <button type="button" className="btn btn-quiet" disabled={disabled} onClick={() => { cancel(); setWork(null); setEditions(null); setStatus('') }}>검색 결과로</button>
      <h3>{work.title} · 판본 선택</h3><p className="muted text-xs">저자는 작품 정보 기준입니다. 페이지 수가 없으면 직접 입력하고 판본 정보를 확인하세요.</p>
      {!editions && !searching && <button type="button" className="btn btn-soft" disabled={disabled} onClick={() => loadEditions(work, 1)}>판본 다시 불러오기</button>}
      {editions?.items.map(edition => <article key={edition.id} className="book-match" aria-label={edition.title}>
        <h3>{edition.title}</h3><p>{edition.publisher || '출판사 정보 없음'} · {edition.published || '발행일 정보 없음'}</p><p>{edition.languages.join(' · ') || '언어 정보 없음'} · {edition.pages ? edition.pages + '쪽' : '페이지 직접 입력'}</p><p className="muted text-xs">{edition.isbn ? 'ISBN ' + edition.isbn : 'ISBN 정보 없음'}</p>
        <a className="text-link" href={edition.sourceUrl} target="_blank" rel="noopener noreferrer">출처: Open Library 판본</a><button className="btn btn-soft" type="button" disabled={disabled || searching} onClick={() => apply(edition)}>이 판본 사용</button>
      </article>)}
      {editions && <div className="row-actions"><button type="button" className="btn btn-soft" disabled={disabled || searching || editions.page === 1} onClick={() => loadEditions(work, editions.page - 1)}>이전 판본</button><span>{editions.page}페이지</span><button type="button" className="btn btn-soft" disabled={disabled || searching || !editions.next} onClick={() => loadEditions(work, editions.page + 1)}>다음 판본</button></div>}
    </section>}
    {mode !== 'isbn' && !work && works && <section className="book-discovery" aria-label="작품 검색 결과">
      {works.items.map(item => <article key={item.id} className="book-match" aria-label={item.title}><h3>{item.title}</h3><p>{item.author || '저자 정보 없음'}{item.year ? ' · 첫 출판 ' + item.year + '년' : ''}</p><p className="muted text-xs">{item.editions ? '등록 판본 ' + item.editions + '종' : '판본 정보 확인'}</p><a className="text-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">출처: Open Library 작품</a><button type="button" className="btn btn-soft" disabled={disabled || searching} onClick={() => loadEditions(item, 1)}>판본 보기</button></article>)}
      <div className="row-actions"><button type="button" className="btn btn-soft" disabled={disabled || searching || works.page === 1} onClick={() => loadWorks(works.page - 1)}>이전 검색 결과</button><span>{works.page}페이지</span><button type="button" className="btn btn-soft" disabled={disabled || searching || !works.next} onClick={() => loadWorks(works.page + 1)}>다음 검색 결과</button></div>
    </section>}
  </div>
}
