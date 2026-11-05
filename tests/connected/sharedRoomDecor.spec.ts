import { expect, test } from '@playwright/test'
import type { View } from '../../src/domain/model'
import type { SharedRoomLayout } from '../../src/domain/room'
import { dataOf, studyFixture } from '../support/studyFixture'

test('members can arrange, hide and restore shared decor without changing personal rooms', async ({ page, browser }) => {
  test.setTimeout(90000)
  const f = await studyFixture()
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true })
  const load = async () => dataOf(await f.owner.rpc('onmode_library', { group_id: f.groupId })).room as SharedRoomLayout
  const personalRoom = async () => {
    const { inventory, placed, room, records } = (dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot
    return { inventory, placed, room, records }
  }
  const write = (app: typeof f.owner, payload: Record<string, unknown>) => app.rpc('onmode_library_change', {
    group_id: f.groupId, action: 'layout', payload,
  })
  try {
    const personalBefore = await personalRoom()
    const expanded = { revision: 0, positions: {}, extras: ['frame', 'laptop'] }
    for (const app of [f.anon, f.outsider]) expect((await write(app, expanded)).error?.code).toBe('42501')
    for (const extras of [null, 'frame', {}, ['frame', 'frame'], ['chair'], ['wall']]) {
      expect((await write(f.member, { ...expanded, extras })).error?.code).toBe('22023')
    }
    expect((await write(f.member, { ...expanded, positions: { frame: { x: 999, y: 0 } } })).error?.code).toBe('22023')
    expect((await write(f.member, { ...expanded, transforms: { laptop: { rotation: 30, scale: 100 } } })).error?.code).toBe('22023')
    expect(await load()).toEqual({ revision: 0, positions: {} })

    await f.login(page, 0)
    const member = await mobile.newPage()
    await f.login(member, 1)
    const ownerLibrary = page.getByRole('region', { name: '공동 도서관', exact: true })
    const library = member.getByRole('region', { name: '공동 도서관', exact: true })
    const edit = library.getByRole('button', { name: '공동 배치 편집', exact: true })
    const save = library.getByRole('button', { name: '공동 배치 저장', exact: true })
    const frame = library.locator('[data-room-item="frame"]')
    const laptop = library.locator('[data-room-item="laptop"]')
    const frameToggle = library.getByRole('checkbox', { name: '보라빛 액자', exact: true })
    const laptopToggle = library.getByRole('checkbox', { name: '실버 노트북', exact: true })
    const ownerFrame = ownerLibrary.locator('[data-room-item="frame"]')
    await expect(library.locator('[data-room-item]')).toHaveCount(5)
    await edit.click()
    await expect(frameToggle).not.toBeChecked()
    await frameToggle.check()
    await expect(frame).toBeVisible()
    await library.getByRole('button', { name: '보라빛 액자 오른쪽 이동' }).click()
    await library.getByRole('button', { name: '오른쪽 회전', exact: true }).click()
    await library.getByRole('button', { name: '앞으로 가져오기', exact: true }).click()
    await laptopToggle.check()
    await library.getByRole('combobox', { name: '가구 크기' }).selectOption('80')
    await expect(ownerFrame).toHaveCount(0)
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await library.locator('.shared-library-room').screenshot({ path: test.info().outputPath('shared-room-decor-mobile.png'), scale: 'css' })
    await save.click()
    await expect(edit).toBeVisible()
    await expect(ownerFrame).toHaveAttribute('data-room-rotation', '90')
    await expect(ownerLibrary.locator('[data-room-item="laptop"]')).toHaveAttribute('data-room-scale', '80')
    const saved = await load()
    expect(saved).toEqual({
      revision: 1, positions: { frame: { x: 8, y: 0 } }, extras: ['frame', 'laptop'],
      transforms: { frame: { rotation: 90, scale: 100 }, laptop: { rotation: 0, scale: 80 } },
      order: ['shelf', 'desk', 'frame', 'lamp', 'laptop', 'chair', 'plant'],
    })
    // A legacy edit can reorder the original items without hiding or resetting decor.
    const legacy = { revision: 1, positions: { desk: { x: 8, y: 0 } }, transforms: {}, order: ['shelf', 'lamp', 'desk', 'chair', 'plant'] }
    const merged = dataOf(await write(f.owner, legacy)).room
    expect(merged).toEqual({ ...saved, revision: 2, positions: { ...saved.positions, ...legacy.positions },
      order: ['shelf', 'lamp', 'frame', 'desk', 'laptop', 'chair', 'plant'] })
    expect(dataOf(await write(f.owner, legacy)).room).toEqual(merged)
    expect(dataOf(await f.outsider.from('group_library_layouts').select('extras'))).toEqual([])
    expect((await f.member.from('group_library_layouts').update({ extras: [] }).eq('group_id', f.groupId)).error?.code).toBe('42501')
    await expect(library.locator('[data-room-item="desk"]')).toHaveAttribute('transform', 'translate(8 0)')

    await edit.click()
    await frameToggle.uncheck()
    await expect(frame).toHaveCount(0)
    await library.getByRole('button', { name: '공동 배치 취소', exact: true }).click()
    await expect(frame).toHaveAttribute('transform', 'translate(8 0)')
    await edit.click()
    await frameToggle.uncheck()
    await laptopToggle.uncheck()
    await save.click()
    await expect(edit).toBeVisible()
    await expect(ownerFrame).toHaveCount(0)
    const hidden = await load()
    expect(hidden).toEqual({ revision: 3, positions: merged.positions, transforms: merged.transforms, order: merged.order })
    await member.reload()
    await member.getByRole('article').filter({ has: member.getByRole('heading', { name: '온모드 집중 스터디', exact: true }) }).getByRole('button', { name: '보기' }).click()
    await edit.click()
    await frameToggle.check()
    await laptopToggle.check()
    await expect(frame).toHaveAttribute('transform', 'translate(8 0)')
    await expect(frame).toHaveAttribute('data-room-rotation', '90')
    await expect(laptop).toHaveAttribute('data-room-scale', '80')
    await expect.poll(() => library.locator('[data-room-item]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-room-item')))).toEqual(merged.order)
    dataOf(await write(f.owner, { revision: 3, positions: { desk: { x: 16, y: 0 } } }))
    await save.click()
    await expect(library.getByRole('alert')).toHaveText(/다른 멤버가 배치를 변경/)
    await expect(frame).toBeVisible()
    await library.getByRole('button', { name: '초안 취소하고 최신 공동 배치 보기' }).click()
    await expect(frame).toHaveCount(0)
    await expect(library.locator('[data-room-item="desk"]')).toHaveAttribute('transform', 'translate(16 0)')
    expect(await personalRoom()).toEqual(personalBefore)
    const restored = dataOf(await write(f.member, { revision: 4, positions: {}, order: [], transforms: {}, extras: ['frame', 'laptop'] })).room
    expect(restored).toEqual({ revision: 5, positions: {}, extras: ['frame', 'laptop'] })
    expect(dataOf(await write(f.owner, { revision: 5, positions: {}, order: legacy.order })).room).toEqual({
      ...restored, revision: 6, order: ['shelf', 'frame', 'lamp', 'desk', 'laptop', 'chair', 'plant'],
    })
    dataOf(await f.member.rpc('onmode_group_change', { action: 'leave', payload: { id: f.groupId } }))
    expect((await write(f.member, expanded)).error?.code).toBe('42501')
  } finally { await mobile.close(); await f.cleanup() }
})
