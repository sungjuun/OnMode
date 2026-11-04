import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDown, MessageCircle, Send, Trash2 } from 'lucide-react'
import { chat, type ChatMessage, type ChatPage } from '../data/chat'
import { supabase } from '../data/supabase'
import { useApp } from '../state/context'
import { Dialog, Empty, ErrorState, Field, Loading, messageOf } from './base'

type Anchor = { bottom: true } | { bottom: false; id?: string; offset: number; top: number }

export function StudyChat({ groupId, isOwner, revision }: { groupId: string; isOwner: boolean; revision: number }) {
  const { session, notify } = useApp()
  const [data, setData] = useState<ChatPage | null>(null)
  const [pages, setPages] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [sendIssue, setSendIssue] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const [newMessages, setNewMessages] = useState(false)
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteIssue, setDeleteIssue] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const anchor = useRef<Anchor>({ bottom: true })
  const latest = useRef<string | undefined>(undefined)
  const pending = useRef<{ id: string; body: string } | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    async function load() {
      const visible: ChatPage = { items: [], next: null }
      for (let i = 0; i < pages; i++) {
        if (!active) return
        const page = await chat.list(groupId, visible.next)
        visible.items.push(...page.items)
        visible.next = page.next
        if (!page.next) break
      }
      if (!active) return
      const node = scroller.current
      const first = node && [...node.querySelectorAll<HTMLElement>('[data-message-id]')]
        .find(item => item.getBoundingClientRect().bottom > node.getBoundingClientRect().top)
      // Keep the reading anchor when new messages push it beyond the latest page.
      if (!nearBottom.current && first?.dataset.messageId && visible.next
        && !visible.items.some(message => message.id === first.dataset.messageId)) {
        const older = await chat.list(groupId, visible.next)
        if (!active) return
        visible.items.push(...older.items)
        visible.next = older.next
        setPages(count => count + 1)
      }
      anchor.current = nearBottom.current || !node ? { bottom: true } : {
        bottom: false, id: first?.dataset.messageId,
        offset: first ? first.getBoundingClientRect().top - node.getBoundingClientRect().top : 0,
        top: node.scrollTop,
      }
      visible.items.reverse()
      setData(visible); setIssue('')
    }
    void load().catch(error => { if (active) { setData(null); setIssue(messageOf(error)) } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [groupId, pages, revision, refresh])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    const channel = client.channel('group-chat:' + groupId, { config: { postgres_changes_options: { wait: true } } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_chat_updates', filter: 'group_id=eq.' + groupId }, () => {
        if (active) setRefresh(n => n + 1)
      }).subscribe(status => {
        if (active) {
          setLive(status === 'SUBSCRIBED')
          if (status === 'SUBSCRIBED') setRefresh(n => n + 1)
        }
      })
    return () => { active = false; void client.removeChannel(channel) }
  }, [groupId])

  useLayoutEffect(() => {
    const node = scroller.current
    if (!node || !data) return
    if (anchor.current.bottom) {
      node.scrollTop = node.scrollHeight
      setNewMessages(false)
    } else {
      const saved = anchor.current
      const item = [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find(item => item.dataset.messageId === saved.id)
      node.scrollTop = item ? node.scrollTop + item.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset : saved.top
      if (latest.current !== data.items.at(-1)?.id) setNewMessages(true)
    }
    latest.current = data.items.at(-1)?.id
  }, [data])

  function showLatest() {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
    nearBottom.current = true
    setNewMessages(false)
  }
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = body.trim()
    if (busy || !text) return
    if (pending.current?.body !== text) pending.current = { id: crypto.randomUUID(), body: text }
    setBusy(true); setSendIssue('')
    try {
      await chat.send(groupId, pending.current.id, text)
      pending.current = null
      setBody('')
      nearBottom.current = true
      setRefresh(n => n + 1)
    } catch (error) { setSendIssue(messageOf(error)) }
    finally { setBusy(false) }
  }
  async function remove() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true); setDeleteIssue('')
    try {
      await chat.delete(groupId, deleting.id)
      setDeleting(null)
      setRefresh(n => n + 1)
      notify('메시지를 삭제했어요.')
    } catch (error) { setDeleteIssue(messageOf(error)) }
    finally { setDeleteBusy(false) }
  }

  return <section className="chat-section" aria-label="그룹 채팅">
    <div className="challenges-heading"><div><h2><MessageCircle size={17} aria-hidden />그룹 채팅</h2><p className="muted text-sm">집중을 함께하는 멤버들과 이야기해요.</p></div>
      <span className={'badge ' + (live ? 'badge-mint' : '')}>{live ? '채팅 연결됨' : '주기적으로 갱신'}</span>
    </div>
    {issue && <ErrorState message={issue} retry={() => setRefresh(n => n + 1)} />}
    {data?.next && <button className="btn btn-soft mt-3" disabled={loading} onClick={() => setPages(n => n + 1)}>{loading ? '불러오는 중…' : '이전 대화 더 보기'}</button>}
    <div className="chat-scroll" ref={scroller} role="log" aria-label="그룹 대화" tabIndex={0} onScroll={() => {
      const node = scroller.current
      if (node) {
        nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 50
        if (nearBottom.current) setNewMessages(false)
      }
    }}>
      {data === null ? !issue && <Loading /> : data.items.length === 0
        ? <Empty icon={MessageCircle} title="아직 대화가 없어요" description="첫 인사를 남겨 보세요." />
        : <ol className="chat-list">{data.items.map(message => {
          const own = message.senderId === session?.user.id
          return <li key={message.id} data-message-id={message.id} className={'chat-message ' + (own ? 'chat-own' : '')}>
            <div className="chat-meta"><strong>{message.senderName}{own ? ' · 나' : ''}</strong>
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              {!message.deletedAt && (own || isOwner) && <button className="icon-button" aria-label="메시지 삭제" onClick={() => { setDeleteIssue(''); setDeleting(message) }}><Trash2 size={13} /></button>}
            </div>
            <p className={'chat-bubble ' + (message.deletedAt ? 'chat-deleted' : '')}>{message.deletedAt ? '삭제된 메시지입니다.' : message.body}</p>
          </li>
        })}</ol>}
    </div>
    {newMessages && <button className="btn btn-soft chat-latest" onClick={showLatest}><ArrowDown size={14} />새 메시지 보기</button>}
    <form className="chat-composer" onSubmit={event => void send(event)}>
      {sendIssue && <ErrorState message={sendIssue} />}
      <Field label="메시지"><textarea value={body} onChange={event => setBody(event.target.value)} rows={2} maxLength={2000} required disabled={busy} placeholder="멤버들에게 메시지를 남겨 보세요."
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.currentTarget.form?.requestSubmit()
          }
        }} /></Field>
      <div className="chat-composer-actions"><small>Ctrl / ⌘ + Enter로 전송 · {body.length}/2,000</small>
        <button className="btn btn-primary" disabled={busy || !body.trim()}><Send size={15} />{busy ? '전송 중…' : sendIssue ? '다시 전송' : '전송'}</button>
      </div>
    </form>
    {deleting && <Dialog title="메시지 삭제" close={() => { if (!deleteBusy) setDeleting(null) }}>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); void remove() }}>
        {deleteIssue && <ErrorState message={deleteIssue} />}
        <p className="muted text-sm">메시지 내용을 지울까요? 대화에는 삭제 표시가 남습니다.</p>
        <p className="chat-delete-preview">{deleting.body?.slice(0, 120)}</p>
        <div className="row-actions"><button type="button" className="btn btn-quiet" disabled={deleteBusy} onClick={() => setDeleting(null)}>취소</button>
          <button className="btn btn-danger" disabled={deleteBusy}>{deleteBusy ? '삭제 중…' : '삭제 확정'}</button>
        </div>
      </form>
    </Dialog>}
  </section>
}
