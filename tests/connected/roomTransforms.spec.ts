import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import type { View } from '../../src/domain/model'
import { constrainPosition, movableItems, normalizeTransforms, roomBounds, type RoomLayout, type RoomTransforms } from '../../src/domain/room'
import { dataOf, studyFixture } from '../support/studyFixture'

test('personal and shared shapes save atomically, synchronize and enforce ownership, bounds and conflicts', async ({ page, browser }) => {
  test.setTimeout(120000)
  const f = await studyFixture()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  const snapshot = async () => (dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot
  const shapes: RoomTransforms = { desk: { rotation: 90, scale: 120 } }
  const positions = { desk: constrainPosition('desk', { x: 0, y: 0 }, shapes.desk) }
  const personal = (revision: number, points: unknown, transforms?: unknown) => f.owner.rpc('onmode_command', { command: { type: 'room_layout', revision, positions: points, ...(transforms === undefined ? {} : { transforms }) } })
  const shared = (app: typeof f.owner, revision: number, points: unknown, transforms?: unknown) => app.rpc('onmode_library_change', { group_id: f.groupId, action: 'layout', payload: { revision, positions: points, ...(transforms === undefined ? {} : { transforms }) } })
  const loadShared = async () => dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId })).room as RoomLayout
  try {
    // Compare every JS boundary against the SQL validator using only the isolated DB.
    const cases = []
    for (const id of movableItems) for (const rotation of [0, 90, 180, 270]) for (const scale of [50, 60, 70, 80, 90, 100, 110, 120]) {
      const transform = { rotation, scale }, b = roomBounds(id, transform), transforms = normalizeTransforms({ [id]: transform })
      for (const [x, y, valid] of [[b.minX, b.minY, true], [b.maxX, b.maxY, true], [b.minX - 1, b.minY, false], [b.maxX + 1, b.minY, false], [b.minX, b.minY - 1, false], [b.minX, b.maxY + 1, false]]) cases.push({ positions: { [id]: { x, y } }, transforms, valid })
    }
    const sql = `begin;
      create function pg_temp.valid_room(p jsonb,t jsonb) returns boolean language plpgsql as $$
      begin perform onmode_private.normalize_room_positions(p,t,array['shelf','frame','desk','lamp','laptop','chair','plant']); return true;
      exception when sqlstate '22023' then return false; end $$;
      select count(*) from jsonb_array_elements('${JSON.stringify(cases)}'::jsonb) c
      where pg_temp.valid_room(c->'positions',c->'transforms') is distinct from (c->>'valid')::boolean;
      rollback;`
    const parity = execFileSync('docker', ['exec', '-i', 'supabase_db_onmode', 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8' }).trim()
    expect(parity).toBe('0')
    expect(cases).toHaveLength(1344)

    const saved = dataOf(await personal(0, positions, shapes)) as View
    expect(saved.snapshot.room).toEqual({ revision: 1, positions, transforms: shapes })
    expect((dataOf(await personal(0, positions, shapes)) as View).snapshot.room.revision).toBe(1)
    const moved = { desk: { ...positions.desk, x: 5 } }
    expect((dataOf(await personal(1, moved)) as View).snapshot.room.transforms).toEqual(shapes)
    expect((await personal(1, positions, {})).error?.code).toBe('22023')
    expect((await personal(1, {}, {})).error?.code).toBe('40001')
    for (const bad of [null, [], { desk: null }, { desk: { rotation: 45, scale: 100 } }, { desk: { rotation: 90, scale: 125 } }, { desk: { rotation: '90', scale: 100 } }, { desk: { rotation: 90, scale: 100, extra: 1 } }, { wall: { rotation: 0, scale: 100 } }]) expect((await personal(2, {}, bad)).error?.code).toBe('22023')
    expect((await personal(2, {}, { lamp: { rotation: 0, scale: 100 } })).error?.code).toBe('42501')
    expect((await personal(2, {}, { lamp: { rotation: 90, scale: 100 } })).error?.code).toBe('42501')
    expect((await personal(2, {}, shapes)).error?.code).toBe('22023')
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.room).toEqual({ revision: 0, positions: {} })
    expect(dataOf(await f.member.from('user_room_layouts').select('transforms'))).toEqual([])
    expect((await f.owner.from('user_room_layouts').update({ transforms: {} }).eq('revision', 2)).error?.code).toBe('42501')
    expect((await f.anon.rpc('onmode_command', { command: { type: 'room_layout', revision: 0, positions, transforms: shapes } })).error?.code).toBe('42501')
    await f.login(page, 0)
    await page.goto('/growth')
    const personalDesk = page.locator('[data-room-item="desk"]')
    await expect(personalDesk).toHaveAttribute('data-room-rotation', '90')
    await expect(personalDesk).toHaveAttribute('data-room-scale', '120')
    await page.getByRole('button', { name: '배치 편집', exact: true }).click()
    await page.getByRole('button', { name: '원목 책상 선택', exact: true }).click()
    await page.getByRole('button', { name: '왼쪽 회전', exact: true }).click()
    dataOf(await personal(2, {}, {}))
    await page.getByRole('button', { name: '배치 저장', exact: true }).click()
    await expect(page.locator('.room-editor-controls').getByRole('alert')).toHaveText(/저장하지 못했어요/)
    await expect(personalDesk).toHaveAttribute('data-room-scale', '120')
    await page.getByRole('button', { name: '초안 취소하고 최신 배치 보기' }).click()
    await expect(personalDesk).toHaveAttribute('data-room-scale', '100')

    await page.goto('/study')
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    const member = await context.newPage()
    await f.login(member, 1)
    const library = page.getByRole('region', { name: '공동 도서관', exact: true })
    const other = member.getByRole('region', { name: '공동 도서관', exact: true })
    const otherDesk = other.locator('[data-room-item="desk"]')
    await other.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    await other.getByRole('button', { name: '오른쪽 회전', exact: true }).click()
    await other.getByRole('combobox', { name: '가구 크기' }).selectOption('120')
    await member.screenshot({ path: test.info().outputPath('shared-room-transforms.png'), fullPage: true, scale: 'css' })
    let loseResponse = true
    await member.route('**/rest/v1/rpc/onmode_library_change', async route => {
      if (loseResponse && route.request().postDataJSON()?.action === 'layout') { loseResponse = false; await route.fetch(); await route.abort(); return }
      await route.continue()
    })
    await other.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    await expect(other.getByRole('alert')).toHaveText(/연결하지 못했어요/)
    await expect(otherDesk).toHaveAttribute('data-room-rotation', '90')
    await other.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    await expect(other.getByRole('button', { name: '공동 배치 편집', exact: true })).toBeVisible()
    await expect(library.locator('[data-room-item="desk"]')).toHaveAttribute('data-room-scale', '120')
    expect(await loadShared()).toEqual({ revision: 1, positions, transforms: shapes })
    expect(dataOf(await shared(f.owner, 0, positions, shapes)).room.revision).toBe(1)
    expect(dataOf(await shared(f.owner, 1, moved)).room.transforms).toEqual(shapes)
    for (const app of [f.outsider, f.anon]) expect((await shared(app, 2, positions, shapes)).error?.code).toBe('42501')
    expect((await shared(f.owner, 2, {}, { laptop: { rotation: 90, scale: 100 } })).error?.code).toBe('22023')
    expect((await shared(f.owner, 2, {}, shapes)).error?.code).toBe('22023')
    expect(dataOf(await f.outsider.from('group_library_layouts').select('transforms'))).toEqual([])
    expect((await f.member.from('group_library_layouts').update({ transforms: {} }).eq('group_id', f.groupId)).error?.code).toBe('42501')
    await expect(otherDesk).toHaveAttribute('transform', 'translate(5 -66)')
    await other.getByRole('button', { name: '공동 배치 편집', exact: true }).click()
    await other.getByRole('button', { name: '왼쪽 회전', exact: true }).click()
    dataOf(await shared(f.owner, 2, {}, {}))
    await other.getByRole('button', { name: '공동 배치 저장', exact: true }).click()
    await expect(other.getByRole('alert')).toHaveText(/다른 멤버가 배치를 변경/)
    await expect(otherDesk).toHaveAttribute('data-room-scale', '120')
    await other.getByRole('button', { name: '초안 취소하고 최신 공동 배치 보기' }).click()
    await expect(otherDesk).toHaveAttribute('data-room-scale', '100')
    // Same-revision edits to different shapes still share one atomic version.
    const races = await Promise.all([shared(f.owner, 3, {}, { chair: { rotation: 90, scale: 80 } }), shared(f.member, 3, {}, { chair: { rotation: 180, scale: 80 } })])
    expect(races.filter(r => !r.error)).toHaveLength(1)
    expect(races.find(r => r.error)?.error?.code).toBe('40001')
    const final = await snapshot()
    expect(final.room).toEqual({ revision: 3, positions: {} })
    expect(final.inventory.sort()).toEqual(['chair', 'desk'])
    expect(final.records).toEqual([])
    expect(dataOf(await f.owner.from('reward_transactions').select('coins'))).toEqual([])
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await shared(f.member, 4, {}, {})).error?.code).toBe('42501')
    expect((await f.member.rpc('onmode_library', { group_id: f.groupId })).error?.code).toBe('42501')
  } finally { await context.close(); await f.cleanup() }
})
