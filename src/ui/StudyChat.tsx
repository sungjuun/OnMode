import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { ArrowDown, MessageCircle, Paperclip, PencilLine, Send, Trash2 } from 'lucide-react'
import { chat, type ChatMessage, type ChatPage, type ChatReadCount } from '../data/chat'
import { supabase } from '../data/supabase'
import { useApp } from '../state/context'
import { Dialog, Empty, ErrorState, Field, Loading, messageOf } from './base'
import { ChatEditDialog } from './ChatEditDialog'
import { useChatRead } from './useChatRead'
import { chatFiles, type ChatFileDraft } from '../data/chatFiles'
import { attachmentAccept, attachmentSize } from '../domain/chatAttachment'
import { ChatAttachment } from './ChatAttachment'

type Anchor = { bottom: true } | { bottom: false; id?: string; offset: number; top: number }
const noMessages: ChatMessage[] = []

export function StudyChat({ groupId, isOwner, revision }: { groupId: string; isOwner: boolean; revision: number }) {
  const { session, notify } = useApp()
  const [data, setData] = useState<ChatPage | null>(null)
  const [pages, setPages] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [readRefresh, setReadRefresh] = useState(0)
  const [readRetry, setReadRetry] = useState(0)
  const [readCounts, setReadCounts] = useState<Record<string, ChatReadCount>>({})
  const [readCountIssue, setReadCountIssue] = useState('')
  const [loading, setLoading] = useState(true)
  const [issue, setIssue] = useState('')
  const [sendIssue, setSendIssue] = useState('')
  const [body, setBody] = useState('')
  const [attachment, setAttachment] = useState<ChatFileDraft | null>(null)
  const [checkingFile, setCheckingFile] = useState(false)
  const [fileIssue, setFileIssue] = useState('')
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState(false)
  const [newMessages, setNewMessages] = useState(false)
  const [deleting, setDeleting] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteIssue, setDeleteIssue] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const anchor = useRef<Anchor>({ bottom: true })
  const latest = useRef<string | undefined>(undefined)
  const pending = useRef<{ id: string; body: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const attemptedFile = useRef('')
  const uploadedFile = useRef('')
  const readIssue = useChatRead(groupId, session?.user.id, data?.items ?? noMessages, scroller, readRetry)

  useEffect(() => {
    const ids = data?.items.filter(message => message.senderId === session?.user.id && !message.deletedAt).map(message => message.id) ?? []
    if (!ids.length) { setReadCountIssue(''); setReadCounts({}); return }
    let active = true
    async function loadCounts() {
      const counts: Record<string, ChatReadCount> = {}
      for (let i = 0; i < ids.length; i += 100) {
        const result = await chat.readCounts(groupId, ids.slice(i, i + 100))
        if (!active) return
        result.forEach(count => { counts[count.id] = count })
      }
      if (active) { setReadCounts(counts); setReadCountIssue('') }
    }
    // Counts refresh independently so receipt events do not move the reading anchor.
    void loadCounts().catch(error => { if (active) setReadCountIssue(messageOf(error)) })
    return () => { active = false }
  }, [groupId, data, session?.user.id, readRefresh, revision])

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
      }).on('postgres_changes', { event: '*', schema: 'public', table: 'group_chat_read_updates', filter: 'group_id=eq.' + groupId }, () => {
        if (active) setReadRefresh(n => n + 1)
      }).subscribe(status => {
        if (active) {
          setLive(status === 'SUBSCRIBED')
          if (status === 'SUBSCRIBED') { setRefresh(n => n + 1); setReadRefresh(n => n + 1) }
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
    const text = body.trim() || (attachment ? attachment.info.mime.startsWith('image/') ? '사진을 첨부했어요.' : '파일을 첨부했어요.' : '')
    if (busy || checkingFile || !text) return
    setBusy(true); setSendIssue('')
    try {
      if (attachment) {
        attemptedFile.current = attachment.id
        if (uploadedFile.current !== attachment.id) {
          await chatFiles.upload(groupId, attachment)
          uploadedFile.current = attachment.id
        }
        await chat.send(groupId, attachment.messageId, text, attachment.id)
        attemptedFile.current = ''; uploadedFile.current = ''; setAttachment(null)
      } else {
        if (pending.current?.body !== text) pending.current = { id: crypto.randomUUID(), body: text }
        await chat.send(groupId, pending.current.id, text)
      }
      pending.current = null
      setBody('')
      nearBottom.current = true
      setRefresh(n => n + 1)
    } catch (error) { setSendIssue(messageOf(error)) }
    finally { setBusy(false) }
  }
  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || busy || checkingFile || attachment) return
    setCheckingFile(true); setFileIssue(''); setSendIssue('')
    try { setAttachment(await chatFiles.prepare(file)) } catch (error) { setFileIssue(messageOf(error)) }
    finally { setCheckingFile(false) }
  }
  async function clearFile() {
    if (!attachment || busy) return
    setBusy(true); setFileIssue('')
    try {
      if (attemptedFile.current === attachment.id) {
        const result = await chatFiles.cancel(groupId, attachment.id)
        if (result.posted) { setBody(''); setRefresh(n => n + 1); notify('이미 전송된 메시지를 확인해 주세요.') }
      }
      attemptedFile.current = ''; uploadedFile.current = ''; setAttachment(null); setSendIssue('')
    } catch (error) { setFileIssue(messageOf(error)) }
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
          const count = readCounts[message.id]
          return <li key={message.id} data-message-id={message.id} className={'chat-message ' + (own ? 'chat-own' : '')}>
            <div className="chat-meta"><strong>{message.senderName}{own ? ' · 나' : ''}</strong>
              <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              {!message.deletedAt && message.editedAt && <span title={'마지막 수정: ' + new Date(message.editedAt).toLocaleString('ko-KR')}>수정됨</span>}
              {!message.deletedAt && own && <button className="icon-button" aria-label="메시지 수정" onClick={() => setEditing(message)}><PencilLine size={13} /></button>}
              {!message.deletedAt && (own || isOwner) && <button className="icon-button" aria-label="메시지 삭제" onClick={() => { setDeleteIssue(''); setDeleting(message) }}><Trash2 size={13} /></button>}
            </div>
            <div className={'chat-bubble ' + (message.deletedAt ? 'chat-deleted' : '')}><p>{message.deletedAt ? '삭제된 메시지입니다.' : message.body}</p>{!message.deletedAt && message.attachment && <ChatAttachment key={message.attachment.id} file={message.attachment} />}</div>
            {own && !message.deletedAt && <small className="chat-read" aria-label="메시지 읽음 인원">읽음 {count?.version === message.version ? count.readCount : message.readCount}명</small>}
          </li>
        })}</ol>}
    </div>
    {(readIssue || readCountIssue) && <div className="chat-read-issue"><ErrorState message={'읽음 상태를 갱신하지 못했어요. ' + (readIssue || readCountIssue)} retry={() => { setReadRetry(n => n + 1); setReadRefresh(n => n + 1); setRefresh(n => n + 1) }} /></div>}
    <p className="muted text-xs mt-2">메시지 끝부분을 확인하면 보낸 사람에게 읽음 인원이 표시돼요.</p>
    {newMessages && <button className="btn btn-soft chat-latest" onClick={showLatest}><ArrowDown size={14} />새 메시지 보기</button>}
    <form className="chat-composer" onSubmit={event => void send(event)}>
      {sendIssue && <ErrorState message={sendIssue} />}
      {fileIssue && <ErrorState message={fileIssue} />}
      <Field label="메시지"><textarea value={body} onChange={event => setBody(event.target.value)} rows={2} maxLength={2000} required={!attachment} disabled={busy} placeholder="멤버들에게 메시지를 남겨 보세요."
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.currentTarget.form?.requestSubmit()
          }
        }} /></Field>
      <input ref={fileInput} type="file" aria-label="채팅 첨부 파일" accept={attachmentAccept} hidden onChange={event => void chooseFile(event)} />
      {attachment ? <div className="chat-file-draft" role="group" aria-label="선택한 첨부 파일"><p><bdi>{attachment.info.name}</bdi> · {attachmentSize(attachment.info.bytes)}</p><button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void clearFile()}>첨부 제거</button></div>
        : <div className="row-actions"><button type="button" className="btn btn-soft" disabled={busy || checkingFile} onClick={() => fileInput.current?.click()}><Paperclip size={15} />{checkingFile ? '파일 확인 중…' : '사진·파일 첨부'}</button><small className="muted">JPG·PNG·WebP·PDF·TXT · 10MB 이하</small></div>}
      <div className="chat-composer-actions"><small>Ctrl / ⌘ + Enter로 전송 · {body.length}/2,000</small>
        <button className="btn btn-primary" disabled={busy || checkingFile || !body.trim() && !attachment}><Send size={15} />{busy ? '전송 중…' : sendIssue ? '다시 전송' : '전송'}</button>
      </div>
    </form>
    {editing && <ChatEditDialog key={editing.id} groupId={groupId} message={editing} close={() => { setEditing(null); setRefresh(n => n + 1) }} saved={() => { setEditing(null); setRefresh(n => n + 1); notify('메시지를 수정했어요.') }} />}
    {deleting && <Dialog title="메시지 삭제" close={() => { if (!deleteBusy) setDeleting(null) }}>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); void remove() }}>
        {deleteIssue && <ErrorState message={deleteIssue} />}
        <p className="muted text-sm">메시지 {deleting.attachment ? '내용과 첨부 파일을' : '내용을'} 지울까요? 대화에는 삭제 표시가 남습니다.</p>
        <p className="chat-delete-preview">{deleting.body?.slice(0, 120)}</p>
        <div className="row-actions"><button type="button" className="btn btn-quiet" disabled={deleteBusy} onClick={() => setDeleting(null)}>취소</button>
          <button className="btn btn-danger" disabled={deleteBusy}>{deleteBusy ? '삭제 중…' : '삭제 확정'}</button>
        </div>
      </form>
    </Dialog>}
  </section>
}
