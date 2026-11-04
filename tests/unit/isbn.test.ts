import { describe, expect, it } from 'vitest'
import { normalizeIsbn } from '../../src/domain/isbn'
import { applyLocal } from '../../src/data/local'
import { emptySnapshot, type Activity } from '../../src/domain/model'

describe('ISBN validation', () => {
  it('canonicalizes ISBN-10 and formatted ISBN-13, including X check digits', () => {
    expect(normalizeIsbn('ISBN-10: 0-14-032872-6')).toBe('9780140328721')
    expect(normalizeIsbn(' ISBN-13: 978-0-14-032872-1 ')).toBe('9780140328721')
    expect(normalizeIsbn('0-8044-2957-x')).toBe('9780804429573')
    expect(normalizeIsbn('9791090636071')).toBe('9791090636071')
  })
  it('rejects invalid lengths, check digits, non-book prefixes and misplaced X', () => {
    for (const input of ['', '9780140328722', '0140328721', 'X804429570', '97801403287210', '4006381333931', '9790060115615', '978014032872!']) expect(normalizeIsbn(input)).toBeNull()
  })
  it('guards local registration and does not change existing manual books', () => {
    const book: Activity = { id: 'first', kind: 'book', name: '테스트', author: '저자', pages: 100, currentPage: 0, goalPages: 10, isbn: '9780140328721' }
    const first = applyLocal(emptySnapshot(), { type: 'activity', value: book }, 0)
    expect(() => applyLocal(first, { type: 'activity', value: { ...book, id: 'second' } }, 0)).toThrow('이미 서재')
    expect(() => applyLocal(first, { type: 'activity', value: { ...book, isbn: '9780140328722' } }, 0)).toThrow('ISBN')
    expect(() => applyLocal(first, { type: 'activity', value: { ...book, kind: 'subject' } }, 0)).toThrow('ISBN')
    const manual = { ...book }
    delete manual.isbn
    const next = applyLocal(first, { type: 'activity', value: { ...manual, id: 'manual' } }, 0)
    expect(next.activities).toHaveLength(2)
    expect(next.activities[1].isbn).toBeUndefined()
  })
})
