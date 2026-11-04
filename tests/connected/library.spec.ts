import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Activity, View } from '../../src/domain/model'
import type { SharedBook } from '../../src/data/groupLibrary'
import type { RoomLayout } from '../../src/domain/room'
import { dataOf, studyFixture } from '../support/studyFixture'

type Library = { books: SharedBook[]; room: RoomLayout }
const source = (name: string, isbn?: string): Activity => ({ id: randomUUID(), kind: 'book', name, author: '온모드 저자', pages: 200, currentPage: 70, goalPages: 15, ...(isbn ? { isbn } : {}) })

test('shared books stay private to members and imports survive retries without copying reading history', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const book = source('함께 읽는 책', '9780140328721'), manual = source('매일의 독서')
  const existing = { ...book, id: randomUUID(), pages: 180, currentPage: 25, goalPages: 5 }
  const load = async () => dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId })) as Library
  const change = (action: string, payload: Record<string, unknown>) => f.owner.rpc('onmode_library_change', { group_id: f.groupId, action, payload })
  try {
    for (const value of [book, manual]) dataOf(await f.owner.rpc('onmode_command', { command: { type: 'activity', value } }))
    dataOf(await f.member.rpc('onmode_command', { command: { type: 'activity', value: existing } }))
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'journal', value: { id: randomUUID(), activityId: book.id, date: '2026-11-04', text: '공유하지 않은 개인 독서 노트', amount: 70 } } }))
    await f.login(page, 0)
    const member = await mobile.newPage()
    await f.login(member, 1)
    const library = page.getByRole('region', { name: '공동 도서관', exact: true })
    const memberLibrary = member.getByRole('region', { name: '공동 도서관', exact: true })
    await expect(memberLibrary.getByRole('button', { name: '공동 도서 등록' })).toHaveCount(0)
    let loseCreate = true
    await page.route('**/rest/v1/rpc/onmode_library_change', async route => {
      if (route.request().postDataJSON()?.action === 'create' && loseCreate) { loseCreate = false; await route.fetch(); await route.abort(); return }
      await route.continue()
    })
    await library.getByRole('button', { name: '공동 도서 등록' }).click()
    let dialog = page.getByRole('dialog', { name: '공동 도서 등록', exact: true })
    await dialog.getByLabel('공유할 내 서재 도서').selectOption(book.id)
    await dialog.getByRole('button', { name: '공유하기' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/연결하지 못했어요/)
    await expect(dialog.getByLabel('공유할 내 서재 도서')).toHaveValue(book.id)
    await dialog.getByRole('button', { name: '공유하기' }).click()
    await expect(dialog).not.toBeVisible()
    const shared = (await load()).books[0]
    expect((await load()).books).toHaveLength(1)
    expect(shared).toEqual({ id: shared.id, name: book.name, author: book.author, pages: 200, isbn: book.isbn, createdAt: shared.createdAt, myActivityId: book.id })
    const memberCard = memberLibrary.getByRole('article', { name: book.name, exact: true })
    await expect(memberCard).toBeVisible()
    expect(await memberLibrary.innerText()).not.toContain('공유하지 않은 개인 독서 노트')
    for (const app of [f.outsider, f.anon]) {
      expect((await app.rpc('onmode_library', { group_id: f.groupId })).error?.code).toBe('42501')
      for (const action of ['create', 'delete', 'import', 'layout']) expect((await app.rpc('onmode_library_change', { group_id: f.groupId, action, payload: { id: shared.id, activityId: book.id, revision: 0, positions: {} } })).error?.code).toBe('42501')
    }
    for (const action of ['create', 'delete']) expect((await f.member.rpc('onmode_library_change', { group_id: f.groupId, action, payload: { id: shared.id, activityId: existing.id } })).error?.code).toBe('42501')
    expect((await change('create', { id: randomUUID(), activityId: existing.id })).error?.code).toBe('42501')
    expect((await change('create', { id: randomUUID(), activityId: book.id })).error?.code).toBe('23505')
    expect(dataOf(await f.outsider.from('group_library_books').select('id'))).toEqual([])
    expect((await f.owner.from('group_library_books').delete().eq('id', shared.id)).error?.code).toBe('42501')
    await memberCard.getByRole('button', { name: '내 서재로 가져오기' }).click()
    await expect(memberCard.getByText('내 서재에 있음', { exact: true })).toBeVisible()
    const memberView = dataOf(await f.member.rpc('onmode_snapshot')) as View
    expect(memberView.snapshot.activities).toEqual([existing])
    const retried = dataOf(await f.member.rpc('onmode_library_change', { group_id: f.groupId, action: 'import', payload: { id: shared.id, activityId: randomUUID() } }))
    expect(retried.id).toBe(existing.id)
    expect(dataOf(await f.owner.from('group_library_imports').select('book_id'))).toEqual([{ book_id: shared.id }])

    await library.getByRole('button', { name: '공동 도서 등록' }).click()
    dialog = page.getByRole('dialog', { name: '공동 도서 등록', exact: true })
    await dialog.getByLabel('공유할 내 서재 도서').selectOption(manual.id)
    await dialog.getByRole('button', { name: '공유하기' }).click()
    const manualCard = memberLibrary.getByRole('article', { name: manual.name, exact: true })
    let loseImport = true
    await member.route('**/rest/v1/rpc/onmode_library_change', async route => {
      if (route.request().postDataJSON()?.action === 'import' && loseImport) { loseImport = false; await route.fetch(); await route.abort(); return }
      await route.continue()
    })
    await manualCard.getByRole('button', { name: '내 서재로 가져오기' }).click()
    await expect(member.getByRole('alert')).toHaveText(/연결하지 못했어요/)
    await manualCard.getByRole('button', { name: '내 서재로 가져오기' }).click()
    await expect(manualCard.getByRole('link', { name: '이 책으로 집중' })).toBeVisible()
    const importedView = dataOf(await f.member.rpc('onmode_snapshot')) as View
    const imported = importedView.snapshot.activities.find(a => a.name === manual.name)!
    expect(imported).toMatchObject({ kind: 'book', currentPage: 0, goalPages: 10, pages: 200 })
    expect(importedView.snapshot.activities).toHaveLength(2)
    expect(importedView.snapshot.journal).toEqual([])
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await expect(manualCard.getByText('내 서재에 있음', { exact: true })).toBeVisible()
    await memberLibrary.scrollIntoViewIfNeeded()
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await memberLibrary.screenshot({ path: test.info().outputPath('shared-library-mobile-dark.png'), scale: 'css' })
    await manualCard.getByRole('link', { name: '이 책으로 집중' }).click()
    await expect(member.getByLabel('집중할 활동')).toHaveValue(imported.id)
    await member.getByRole('button', { name: /플로우타임/ }).click()
    await member.getByRole('button', { name: '집중 시작', exact: true }).click()
    await expect(member.getByRole('button', { name: '종료하고 저장' })).toBeVisible()
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.timer?.activityId).toBe(imported.id)
    await member.getByRole('button', { name: '종료하고 저장' }).click()
    const ownerCard = library.getByRole('article', { name: manual.name, exact: true })
    await ownerCard.getByRole('button', { name: '공동 도서 제거' }).click()
    dialog = page.getByRole('dialog', { name: '공동 도서 제거', exact: true })
    await dialog.getByRole('button', { name: '취소', exact: true }).click()
    await expect(ownerCard).toBeVisible()
    await ownerCard.getByRole('button', { name: '공동 도서 제거' }).click()
    await page.getByRole('dialog', { name: '공동 도서 제거', exact: true }).getByRole('button', { name: '제거 확정' }).click()
    await expect(ownerCard).toHaveCount(0)
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.activities.find(a => a.id === imported.id)).toBeDefined()
  } finally { await mobile.close(); await f.cleanup() }
})

test('members edit the shared room, retain conflicting drafts, and lose access after leaving', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const load = async () => dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId })) as Library
  const save = (app: typeof f.owner, revision: number, positions: unknown) => app.rpc('onmode_library_change', { group_id: f.groupId, action: 'layout', payload: { revision, positions } })
  try {
    expect((await load()).room).toEqual({ revision: 0, positions: {} })
    const choices = [{ desk: { x: 20, y: 10 } }, { desk: { x: 40, y: 10 } }]
    const race = await Promise.all([save(f.owner, 0, choices[0]), save(f.member, 0, choices[1])])
    expect(race.filter(r => !r.error)).toHaveLength(1)
    expect(race.find(r => r.error)?.error?.code).toBe('40001')
    const winner = race.findIndex(r => !r.error)
    expect((await load()).room).toEqual({ revision: 1, positions: choices[winner] })
    expect(dataOf(await save(f.member, 0, choices[winner])).room.revision).toBe(1)
    for (const positions of [{ wall: { x: 0, y: 0 } }, { desk: { x: 1.5, y: 0 } }, { desk: { x: 9999, y: 0 } }, { desk: null }, { desk: { x: 0, y: 0, z: 1 } }, { laptop: { x: 0, y: 0 } }]) expect((await save(f.owner, 1, positions)).error?.code).toBe('22023')
    expect((await load()).room.revision).toBe(1)
    expect(dataOf(await f.outsider.from('group_library_layouts').select('group_id'))).toEqual([])
    expect((await f.member.from('group_library_layouts').update({ positions: {} }).eq('group_id', f.groupId)).error?.code).toBe('42501')
    await f.login(page, 0)
    const member = await other.newPage()
    await f.login(member, 1)
    const library = member.getByRole('region', { name: '공동 도서관', exact: true })
    const desk = library.locator('[data-room-item="desk"]')
    await library.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    await desk.focus(); await desk.press('ArrowRight')
    const draft = await desk.getAttribute('transform')
    dataOf(await save(f.owner, 1, { desk: { x: -20, y: 0 } }))
    await library.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    await expect(library.getByRole('alert')).toHaveText(/다른 멤버가 배치를 변경/)
    await expect(desk).toHaveAttribute('transform', draft!)
    await library.getByRole('button', { name: '초안 취소하고 최신 공동 배치 보기' }).click()
    await expect(desk).toHaveAttribute('transform', 'translate(-20 0)')
    await library.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    await library.getByLabel('이동할 공용 가구').selectOption('desk')
    await library.getByRole('button', { name: '원목 책상 오른쪽 이동', exact: true }).click()
    await library.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    await expect(page.getByRole('region', { name: '공동 도서관', exact: true }).locator('[data-room-item="desk"]')).toHaveAttribute('transform', 'translate(-12 0)')
    expect((await load()).room.revision).toBe(3)
    await library.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    await library.getByRole('button', { name: '공동 가구 기본 위치' }).click()
    await library.getByRole('button', { name: '공동 배치 취소' }).click()
    await expect(desk).toHaveAttribute('transform', 'translate(-12 0)')
    const personal = (dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot
    expect(personal.room).toEqual({ revision: 0, positions: {} })
    expect(personal.inventory.sort()).toEqual(['chair', 'desk'])
    expect(dataOf(await f.member.from('reward_transactions').select('coins'))).toEqual([])
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await f.owner.rpc('onmode_library', { group_id: f.groupId })).error?.code).toBe('42501')
    expect((await save(f.owner, 3, {})).error?.code).toBe('42501')
    dataOf(await save(f.member, 3, {}))
    expect(dataOf(await f.member.rpc('onmode_library', { group_id: f.groupId })).room).toEqual({ revision: 4, positions: {} })
  } finally { await other.close(); await f.cleanup() }
})

test('shared book pagination has stable boundaries and group deletion keeps imported personal books', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const original = source('공동 독서 목록')
  const ids: string[] = []
  try {
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'activity', value: original } }))
    for (let i = 0; i < 23; i++) {
      const id = randomUUID(); ids.push(id)
      dataOf(await f.owner.rpc('onmode_library_change', { group_id: f.groupId, action: 'create', payload: { id, activityId: original.id } }))
    }
    f.sql("update public.group_library_books set created_at = '2026-11-01T00:00:00Z' where group_id = '" + f.groupId + "'")
    const first = dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId })) as Library
    expect(first.books.map(b => b.id)).toEqual([...ids].sort().reverse().slice(0, 21))
    const cursor = first.books[19]
    const next = dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId, cursor_at: cursor.createdAt, cursor_id: cursor.id })) as Library
    expect(new Set([...first.books.slice(0, 20), ...next.books].map(b => b.id)).size).toBe(23)
    expect(next.books).toHaveLength(3)
    expect((await f.owner.rpc('onmode_library', { group_id: f.groupId, cursor_id: cursor.id })).error?.code).toBe('22023')
    await f.login(page, 0)
    const library = page.getByRole('region', { name: '공동 도서관', exact: true })
    await expect(library.getByRole('article')).toHaveCount(20)
    await library.getByRole('button', { name: '공동 도서 더 보기' }).click()
    await expect(library.getByRole('article')).toHaveCount(23)
    const imported = dataOf(await f.member.rpc('onmode_library_change', { group_id: f.groupId, action: 'import', payload: { id: cursor.id, activityId: randomUUID() } })).id
    const ownerImport = dataOf(await f.owner.rpc('onmode_library_change', { group_id: f.groupId, action: 'import', payload: { id: cursor.id, activityId: randomUUID() } })).id
    expect(ownerImport).toBe(original.id)
    expect((dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.activities).toHaveLength(1)
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect(f.sql("select count(*) from public.group_library_books where group_id = '" + f.groupId + "'")).toBe('0')
    expect(dataOf(await f.member.from('group_library_imports').select('book_id'))).toEqual([])
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.activities.find(a => a.id === imported)).toBeDefined()
  } finally { await f.cleanup() }
})
