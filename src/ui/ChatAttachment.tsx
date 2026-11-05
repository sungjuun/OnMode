import { useEffect, useRef, useState } from 'react'
import { Download, Image, Paperclip } from 'lucide-react'
import { chatFiles, type ChatFile } from '../data/chatFiles'
import { attachmentInfo, attachmentSize } from '../domain/chatAttachment'
import { Dialog, ErrorState, messageOf } from './base'

export function ChatAttachment({ file }: { file: ChatFile }) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [issue, setIssue] = useState('')
  const active = useRef(false)
  const objectUrls = useRef(new Set<string>())
  useEffect(() => {
    active.current = true
    const urls = objectUrls.current
    return () => { active.current = false; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear() }
  }, [])
  function release(url: string) { URL.revokeObjectURL(url); objectUrls.current.delete(url) }
  function closePreview() { if (preview) release(preview); setPreview('') }
  async function open(asImage: boolean) {
    if (busy) return
    setBusy(true); setIssue('')
    try {
      const blob = await chatFiles.download(file)
      if (!active.current) return
      const url = URL.createObjectURL(new Blob([blob], { type: asImage ? file.mime : 'application/octet-stream' }))
      objectUrls.current.add(url)
      if (asImage) setPreview(url)
      else {
        const link = document.createElement('a')
        link.href = url; link.download = attachmentInfo({ name: file.name, size: file.bytes, type: file.mime }).name
        link.click()
        window.setTimeout(() => release(url), 1000)
      }
    } catch (error) { if (active.current) setIssue(messageOf(error)) }
    finally { if (active.current) setBusy(false) }
  }
  return <div className="chat-file" aria-label="첨부 파일">
    <p><Paperclip size={14} aria-hidden /><strong><bdi>{file.name}</bdi></strong> · {attachmentSize(file.bytes)}</p>
    <div className="row-actions">{file.mime.startsWith('image/') && <button className="btn btn-quiet" disabled={busy} onClick={() => void open(true)}><Image size={15} />사진 보기</button>}
      <button className="btn btn-soft" disabled={busy} onClick={() => void open(false)}><Download size={15} />{busy ? '불러오는 중…' : '파일 다운로드'}</button></div>
    {issue && <ErrorState message={issue} />}
    {preview && <Dialog title="첨부 사진" close={closePreview}><img className="chat-file-photo" src={preview} alt={file.name} onError={() => { closePreview(); setIssue('사진을 표시하지 못했어요.') }} /></Dialog>}
  </div>
}
