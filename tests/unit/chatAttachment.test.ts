import { expect, it } from 'vitest'
import { attachmentInfo, checkAttachmentBytes, maxAttachmentBytes } from '../../src/domain/chatAttachment'

it('normalizes safe file names and enforces the declared type and 10 MiB boundary', () => {
  expect(attachmentInfo({ name: '모임:사진?.JPEG', size: maxAttachmentBytes, type: 'image/jpeg' })).toEqual({ name: '모임_사진_.jpeg', mime: 'image/jpeg', bytes: maxAttachmentBytes })
  expect(attachmentInfo({ name: '정리.txt', size: 1, type: '' }).mime).toBe('text/plain')
  for (const name of ['report.html', 'a.svg', 'program.exe', 'png', 'a.constructor']) expect(() => attachmentInfo({ name, size: 1, type: '' })).toThrow('첨부')
  for (const size of [0, maxAttachmentBytes + 1, -1, 1.1]) expect(() => attachmentInfo({ name: 'a.png', size, type: 'image/png' })).toThrow('10MB')
  expect(() => attachmentInfo({ name: 'a.pdf', size: 1, type: 'image/png' })).toThrow('첨부')
  expect(Array.from(attachmentInfo({ name: '📚'.repeat(200) + '.pdf', size: 1, type: 'application/pdf' }).name)).toHaveLength(114)
})

it('rejects mismatched image and document signatures and invalid UTF-8', () => {
  const encode = (value: string) => new TextEncoder().encode(value)
  expect(() => checkAttachmentBytes('image/jpeg', Uint8Array.of(255,216,255))).not.toThrow()
  expect(() => checkAttachmentBytes('image/png', Uint8Array.of(137,80,78,71,13,10,26,10))).not.toThrow()
  expect(() => checkAttachmentBytes('image/webp', encode('RIFF....WEBP'))).not.toThrow()
  expect(() => checkAttachmentBytes('application/pdf', encode('%PDF-1.7'))).not.toThrow()
  expect(() => checkAttachmentBytes('text/plain', encode('한글 텍스트'))).not.toThrow()
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) expect(() => checkAttachmentBytes(mime, encode('<html>fake</html>'))).toThrow('형식')
  expect(() => checkAttachmentBytes('text/plain', Uint8Array.of(255,254))).toThrow('UTF-8')
  expect(() => checkAttachmentBytes('text/plain', Uint8Array.of(65,0,66))).toThrow('텍스트')
})
