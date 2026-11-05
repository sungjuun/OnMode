export const maxAttachmentBytes = 10 * 1024 * 1024
export const attachmentAccept = '.jpg,.jpeg,.png,.webp,.pdf,.txt'
const fileTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain' }
export function attachmentInfo(file: { name: string; size: number; type: string }) {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  const mime = file.name.includes('.') && Object.hasOwn(fileTypes, extension) ? fileTypes[extension] : undefined
  if (!mime || file.type && file.type !== mime) throw Error('JPG·PNG·WebP·PDF·TXT 파일만 첨부할 수 있어요.')
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > maxAttachmentBytes) throw Error('파일은 1바이트 이상, 10MB 이하로 선택해 주세요.')
  const clean = file.name.slice(0, -(extension.length + 1)).replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, '_').trim().replace(/^[. ]+|[. ]+$/g, '')
  const base = Array.from(clean).slice(0, 110).join('') || '첨부파일'
  return { name: base + '.' + extension, mime, bytes: file.size }
}
export function checkAttachmentBytes(mime: string, bytes: Uint8Array) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  const valid = mime === 'image/png' ? [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)
    : mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === 'image/webp' ? ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP'
        : mime === 'application/pdf' ? ascii(0,5) === '%PDF-' : mime === 'text/plain'
  if (!valid) throw Error('파일 내용과 형식이 맞지 않아요. 다른 파일을 선택해 주세요.')
  if (mime === 'text/plain') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (cause) { throw Error('TXT 파일은 UTF-8 형식으로 저장해 주세요.', { cause }) }
    if (bytes.includes(0)) throw Error('텍스트 파일 내용을 확인해 주세요.')
  }
}
export const attachmentSize = (bytes: number) => bytes < 1024 * 1024 ? Math.max(1, Math.ceil(bytes / 1024)) + 'KB' : (bytes / 1024 / 1024).toFixed(1) + 'MB'
