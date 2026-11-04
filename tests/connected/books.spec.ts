import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Activity, View } from '../../src/domain/model'
import { dataOf, studyFixture } from '../support/studyFixture'

test('book ISBN persists through cloud registration with server validation and account isolation', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const isbn = '9780140328721'
  const command = (value: Activity) => ({ command: { type: 'activity', value } })
  const book = (): Activity => ({ id: randomUUID(), kind: 'book', name: '계정 도서', author: '저자', pages: 100, currentPage: 0, goalPages: 10, isbn })
  try {
    expect((await f.anon.rpc('onmode_command', command(book()))).error?.code).toBe('42501')
    for (const invalid of ['9780140328722', '0140328726', '9790060115615', '', '4006381333931']) {
      expect((await f.owner.rpc('onmode_command', command({ ...book(), isbn: invalid }))).error?.code).toBe('22023')
    }
    expect((await f.owner.rpc('onmode_command', command({ ...book(), kind: 'subject' }))).error?.code).toBe('22023')
    await f.login(page, 0)
    await page.route('https://openlibrary.org/api/books?*', route => route.fulfill({ json: { ['ISBN:' + isbn]: { title: '계정 도서', authors: [{ name: '저자' }] } } }))
    await page.goto('/library?tab=books')
    await page.getByRole('button', { name: '도서 등록' }).click()
    await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill('0140328726')
    await page.getByRole('button', { name: 'ISBN으로 검색' }).click()
    await page.getByRole('button', { name: '이 정보 사용' }).click()
    await expect(page.getByRole('spinbutton', { name: '총 페이지' })).toHaveValue('')
    await page.getByRole('spinbutton', { name: '총 페이지' }).fill('100')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '도서 등록' })).not.toBeVisible()
    await page.reload()
    await expect(page.getByText('ISBN ' + isbn, { exact: true })).toBeVisible()
    const view = dataOf(await f.owner.rpc('onmode_snapshot')) as View
    expect(view.snapshot.activities).toHaveLength(1)
    expect(view.snapshot.activities[0]).toMatchObject({ isbn, name: '계정 도서', pages: 100 })
    expect(view.snapshot.room).toEqual({ revision: 0, positions: {} })
    const attempts = await Promise.all([f.owner.rpc('onmode_command', command(book())), f.owner.rpc('onmode_command', command(book()))])
    expect(attempts.every(r => r.error?.code === '23505')).toBe(true)
    expect(dataOf(await f.member.from('activities').select('isbn'))).toEqual([])
    const peerAttempts = await Promise.all([f.member.rpc('onmode_command', command(book())), f.member.rpc('onmode_command', command(book()))])
    expect(peerAttempts.filter(r => !r.error)).toHaveLength(1)
    expect(peerAttempts.find(r => r.error)?.error?.code).toBe('23505')
    const peer = dataOf(await f.member.rpc('onmode_snapshot')) as View
    expect(peer.snapshot.activities).toHaveLength(1)
    expect(peer.snapshot.activities[0].isbn).toBe(isbn)
    expect(dataOf(await f.owner.from('activities').select('isbn'))).toEqual([{ isbn }])
    expect((await f.owner.from('activities').update({ isbn: null }).eq('id', view.snapshot.activities[0].id)).error?.code).toBe('42501')
    expect((dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.activities).toHaveLength(1)
  } finally { await f.cleanup() }
})
