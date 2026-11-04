import { expect, test } from '@playwright/test'
import type { View } from '../../src/domain/model'
import { defaultRoomOrder, moveLayer, roomOrder, sharedRoomItems, type RoomLayout } from '../../src/domain/room'
import { dataOf, studyFixture } from '../support/studyFixture'

test('personal layer preferences save atomically with coordinates and remain owner-only', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const load = async () => (dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot
  const save = (revision: number, positions: unknown, order?: unknown) => f.owner.rpc('onmode_command', {
    command: { type: 'room_layout', revision, positions, ...(order === undefined ? {} : { order }) },
  })
  const order = moveLayer([], 'desk', 1, ['desk', 'chair'])
  try {
    expect((await load()).room).toEqual({ revision: 0, positions: {} })
    dataOf(await save(0, {}, order))
    expect((await load()).room).toEqual({ revision: 1, positions: {}, order })
    for (const invalid of [null, {}, ['desk'], defaultRoomOrder.map(() => 'desk'), [...defaultRoomOrder.slice(1), 'wall'], [...defaultRoomOrder, 'desk']]) {
      expect((await save(1, {}, invalid)).error?.code).toBe('22023')
    }
    expect((await load()).room.revision).toBe(1)
    expect((dataOf(await save(0, {}, order)) as View).snapshot.room.revision).toBe(1)
    expect(dataOf(await f.member.from('user_room_layouts').select('layer_order'))).toEqual([])
    expect((await f.owner.from('user_room_layouts').update({ layer_order: [] }).eq('revision', 1)).error?.code).toBe('42501')
    dataOf(await save(1, { desk: { x: 10, y: 0 } }))
    expect((await load()).room.order).toEqual(order)
    const race = await Promise.all([save(2, { desk: { x: 15, y: 0 } }, order), save(2, { desk: { x: 10, y: 0 } }, [])])
    expect(race.filter(r => !r.error)).toHaveLength(1)
    expect(race.find(r => r.error)?.error?.code).toBe('40001')
    const current = (await load()).room
    expect(current.revision).toBe(3)
    expect(current.order).toEqual(race[0].error ? undefined : order)
    expect(current.positions).toEqual({ desk: { x: race[0].error ? 10 : 15, y: 0 } })
    await f.login(page, 0)
    await page.goto('/growth')
    const painted = () => page.locator('[data-room-item]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-room-item')))
    const shown = roomOrder(current.order, ['desk', 'chair'])
    await expect.poll(painted).toEqual(shown)
    await page.getByRole('button', { name: '배치 편집', exact: true }).click()
    await page.getByRole('button', { name: shown[1] === 'desk' ? '원목 책상 선택' : '라벤더 의자 선택', exact: true }).click()
    await page.getByRole('button', { name: '뒤로 보내기', exact: true }).click()
    await page.getByRole('button', { name: '배치 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '배치 편집', exact: true })).toBeVisible()
    await page.reload()
    await expect.poll(painted).toEqual([...shown].reverse())
    const saved = await load()
    expect(saved.room.revision).toBe(4)
    expect(saved.inventory.sort()).toEqual(['chair', 'desk'])
    expect(dataOf(await f.owner.from('reward_transactions').select('coins'))).toEqual([])
    const hidden = dataOf(await f.owner.rpc('onmode_command', { command: { type: 'place', id: 'desk', placed: false } })) as View
    expect(hidden.snapshot.room).toEqual(saved.room)
    dataOf(await save(4, saved.room.positions, [...defaultRoomOrder]))
    expect((await load()).room.order).toBeUndefined()
  } finally { await f.cleanup() }
})

test('group layers update live, preserve conflicting drafts, and enforce the shared palette', async ({ page, browser }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const order = moveLayer([], 'desk', 1, sharedRoomItems, sharedRoomItems)
  const load = async () => (dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId })) as { room: RoomLayout }).room
  const save = (app: typeof f.owner, revision: number, positions: unknown, paintOrder: unknown) => app.rpc('onmode_library_change', {
    group_id: f.groupId, action: 'layout', payload: { revision, positions, order: paintOrder },
  })
  try {
    dataOf(await save(f.member, 0, {}, order))
    expect(await load()).toEqual({ revision: 1, positions: {}, order })
    for (const invalid of [null, [...defaultRoomOrder], ['desk'], ['desk', 'chair', 'shelf', 'lamp', 'wall']]) expect((await save(f.owner, 1, {}, invalid)).error?.code).toBe('22023')
    expect((await save(f.outsider, 1, {}, order)).error?.code).toBe('42501')
    expect((await save(f.anon, 1, {}, order)).error?.code).toBe('42501')
    expect(dataOf(await f.outsider.from('group_library_layouts').select('layer_order'))).toEqual([])
    expect((await f.member.from('group_library_layouts').update({ layer_order: [] }).eq('group_id', f.groupId)).error?.code).toBe('42501')
    await f.login(page, 0)
    const member = await mobile.newPage()
    await f.login(member, 1)
    const library = member.getByRole('region', { name: '공동 도서관', exact: true })
    const painted = () => library.locator('[data-room-item]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-room-item')))
    await expect.poll(painted).toEqual(order)
    await library.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    await library.getByLabel('이동할 공용 가구').selectOption('desk')
    await library.getByRole('button', { name: '앞으로 가져오기', exact: true }).click()
    const draft = await painted()
    dataOf(await save(f.owner, 1, { shelf: { x: 10, y: 0 } }, []))
    await library.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    await expect(library.getByRole('alert')).toHaveText(/다른 멤버가 배치를 변경/)
    expect(await painted()).toEqual(draft)
    await library.getByRole('button', { name: '초안 취소하고 최신 공동 배치 보기' }).click()
    await expect.poll(painted).toEqual(sharedRoomItems)
    await expect(library.locator('[data-room-item="shelf"]')).toHaveAttribute('transform', 'translate(10 0)')
    await library.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    const chair = library.locator('[data-room-item="chair"]')
    await chair.focus(); await chair.press('PageUp')
    const expected = ['shelf', 'desk', 'lamp', 'plant', 'chair']
    await expect.poll(painted).toEqual(expected)
    await library.screenshot({ path: test.info().outputPath('shared-layers-mobile-dark.png'), scale: 'css' })
    await library.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    const ownerLayers = () => page.getByRole('region', { name: '공동 도서관', exact: true }).locator('[data-room-item]').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-room-item')))
    await expect.poll(ownerLayers).toEqual(expected)
    expect(await load()).toEqual({ revision: 3, positions: { shelf: { x: 10, y: 0 } }, order: expected })
    dataOf(await save(f.member, 2, { shelf: { x: 10, y: 0 } }, expected))
    expect((await load()).revision).toBe(3)
    dataOf(await f.member.rpc('onmode_library_change', { group_id: f.groupId, action: 'layout', payload: { revision: 0, positions: { shelf: { x: 10, y: 0 } } } }))
    expect(await load()).toEqual({ revision: 3, positions: { shelf: { x: 10, y: 0 } }, order: expected })
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.room).toEqual({ revision: 0, positions: {} })
    dataOf(await f.owner.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await save(f.owner, 3, {}, expected)).error?.code).toBe('42501')
    const remaining = dataOf(await f.member.rpc('onmode_library', { group_id: f.groupId })) as { room: RoomLayout }
    expect(remaining.room.order).toEqual(expected)
  } finally { await mobile.close(); await f.cleanup() }
})
