import { useEffect, useState, type FormEvent } from 'react'
import { Megaphone, PencilLine, Plus, Trash2 } from 'lucide-react'
import { notices, NoticeConflict, type Notice, type NoticePage } from '../data/notices'
import { useApp } from '../state/context'
import { Dialog, Empty, ErrorState, Field, Loading, messageOf } from './base'

type Editor = { kind: 'create'; id: string } | { kind: 'edit' | 'delete'; notice: Notice }

export function StudyNotices({ groupId, isOwner, revision }: { groupId: string; isOwner: boolean; revision: number }) {
  const { notify } = useApp()
  const [data, setData] = useState<NoticePage | null>(null)
  const [pages, setPages] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [formIssue, setFormIssue] = useState('')
  const [conflict, setConflict] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    async function load() {
      const visible: NoticePage = { items: [], next: null }
      for (let i = 0; i < pages; i++) {
        const page = await notices.list(groupId, visible.next)
        visible.items.push(...page.items)
        visible.next = page.next
        if (!page.next) break
      }
      if (active) { setData(visible); setIssue('') }
    }
    void load().catch(error => { if (active) { setData(null); setIssue(messageOf(error)) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [groupId, pages, refresh, revision])

  function open(value: Editor) { setFormIssue(''); setConflict(false); setEditor(value) }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editor || busy || !isOwner || conflict) return
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') ?? '').trim(), body = String(form.get('body') ?? '').trim()
    if (editor.kind !== 'delete' && (!title || !body)) { setFormIssue('제목과 내용을 입력해 주세요.'); return }
    setBusy(true); setFormIssue('')
    try {
      if (editor.kind === 'create') await notices.create(groupId, { id: editor.id, title, body })
      else if (editor.kind === 'edit') await notices.edit(groupId, { ...editor.notice, title, body })
      else await notices.delete(groupId, editor.notice)
      setEditor(null)
      setRefresh(n => n + 1)
      notify(editor.kind === 'delete' ? '공지를 삭제했어요.' : editor.kind === 'edit' ? '공지를 수정했어요.' : '새 공지를 등록했어요.')
    } catch (error) {
      setFormIssue(messageOf(error))
      setConflict(error instanceof NoticeConflict)
    } finally { setBusy(false) }
  }

  return <section className="notices-section" aria-label="그룹 공지">
    <div className="challenges-heading"><div><h2><Megaphone size={17} aria-hidden />그룹 공지</h2><p className="muted text-sm">제목을 눌러 공지 내용을 확인하세요.</p></div>
      {isOwner && <button className="btn btn-soft" onClick={() => open({ kind: 'create', id: crypto.randomUUID() })}><Plus size={15} />공지 작성</button>}
    </div>
    {issue ? <ErrorState message={issue} retry={() => setRefresh(n => n + 1)} />
      : data === null ? <Loading /> : data.items.length === 0 ? <Empty icon={Megaphone} title="등록된 공지가 없어요" description={isOwner ? '함께 알아둘 소식이나 스터디 규칙을 남겨 보세요.' : '그룹장이 새 소식을 등록하면 이곳에서 확인할 수 있어요.'} />
        : <div className="notices-list">{data.items.map((notice, index) => <article className="notice-card" key={notice.id} aria-label={notice.title}>
          <details><summary><span><strong>{notice.title}</strong><small>{new Date(notice.createdAt).toLocaleString('ko-KR')}{notice.version > 1 ? ' · 수정됨' : ''}</small></span>{index === 0 && <span className="badge">최신</span>}</summary>
            <p className="notice-body">{notice.body}</p>
            {isOwner && <div className="row-actions">
              <button className="btn btn-quiet" onClick={() => open({ kind: 'edit', notice })}><PencilLine size={14} />공지 수정</button>
              <button className="btn btn-danger-soft" onClick={() => open({ kind: 'delete', notice })}><Trash2 size={14} />공지 삭제</button>
            </div>}
          </details>
        </article>)}</div>}
    {data?.next && <button className="btn btn-soft mt-3" disabled={loading} onClick={() => setPages(n => n + 1)}>{loading ? '불러오는 중…' : '이전 공지 더 보기'}</button>}
    {editor && <Dialog title={editor.kind === 'create' ? '공지 작성' : editor.kind === 'edit' ? '공지 수정' : '공지 삭제'} close={() => { if (!busy) setEditor(null) }}>
      <form className="form-stack" onSubmit={event => void submit(event)}>
        {formIssue && <ErrorState message={formIssue} />}
        {editor.kind === 'delete' ? <p className="muted text-sm"><strong>{editor.notice.title}</strong> 공지를 삭제할까요? 삭제한 공지는 복구할 수 없어요.</p> : <>
          <Field label="공지 제목"><input name="title" required maxLength={80} defaultValue={editor.kind === 'edit' ? editor.notice.title : ''} disabled={busy} /></Field>
          <Field label="공지 내용"><textarea name="body" required maxLength={5000} rows={6} defaultValue={editor.kind === 'edit' ? editor.notice.body : ''} disabled={busy} /></Field>
        </>}
        {conflict ? <button type="button" className="btn btn-soft" onClick={() => { setEditor(null); setRefresh(n => n + 1) }}>닫고 최신 공지 보기</button>
          : <div className="row-actions"><button type="button" className="btn btn-quiet" onClick={() => setEditor(null)} disabled={busy}>취소</button>
            <button className={'btn ' + (editor.kind === 'delete' ? 'btn-danger' : 'btn-primary')} disabled={busy}>
              {busy ? '처리 중…' : editor.kind === 'delete' ? '삭제 확정' : '저장'}
            </button>
          </div>}
      </form>
    </Dialog>}
  </section>
}
