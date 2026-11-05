import { attachmentInfo, checkAttachmentBytes } from '../domain/chatAttachment'
import { rpc, supabase } from './supabase'

export const chatFileBucket = 'onmode-chat-files'
export interface ChatFile { id: string; name: string; mime: string; bytes: number; objectName: string }
export interface ChatFileDraft { id: string; messageId: string; file: File; info: ReturnType<typeof attachmentInfo>; sha256: string }
const hash = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
async function download(file: ChatFile): Promise<Blob> {
  if (!supabase) throw Error('Supabase 연결이 필요합니다.')
  attachmentInfo({ name: file.name, size: file.bytes, type: file.mime })
  const { data, error } = await supabase.storage.from(chatFileBucket).download(file.objectName)
  if (error || !data || data.size !== file.bytes) throw Error('파일을 내려받을 수 없어요. 그룹 참여 상태와 메시지를 확인해 주세요.')
  checkAttachmentBytes(file.mime, new Uint8Array(await data.arrayBuffer()))
  return data
}

export const chatFiles = {
  async prepare(file: File): Promise<ChatFileDraft> {
    const info = attachmentInfo(file), bytes = await file.arrayBuffer()
    checkAttachmentBytes(info.mime, new Uint8Array(bytes))
    return { id: crypto.randomUUID(), messageId: crypto.randomUUID(), file, info, sha256: await hash(bytes) }
  },
  async upload(groupId: string, draft: ChatFileDraft) {
    if (!supabase) throw Error('Supabase 연결이 필요합니다.')
    const reserved = await rpc<ChatFile>('onmode_chat_file', { group_id: groupId, action: 'reserve', payload: { id: draft.id, messageId: draft.messageId, ...draft.info, sha256: draft.sha256 } })
    const result = await supabase.storage.from(chatFileBucket).upload(reserved.objectName, draft.file, { contentType: draft.info.mime, upsert: false, cacheControl: '0' })
    if (result.error) {
      if (result.error.status !== 409 && result.error.statusCode !== '409') throw Error('파일을 업로드하지 못했어요. 연결을 확인하고 다시 전송해 주세요.')
      // Immutable first upload: verify a duplicate instead of overwriting bytes.
      const existing = await download(reserved)
      if (await hash(await existing.arrayBuffer()) !== draft.sha256) throw Error('기존 첨부 내용이 달라요. 첨부를 제거하고 다시 선택해 주세요.')
    }
    return reserved
  },
  cancel: (groupId: string, id: string) => rpc<{ posted: boolean }>('onmode_chat_file', { group_id: groupId, action: 'cancel', payload: { id } }),
  download,
}
