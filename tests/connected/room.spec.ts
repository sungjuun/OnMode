import { expect, test } from '@playwright/test'
import type { View } from '../../src/domain/model'
import { dataOf, studyFixture } from '../support/studyFixture'

test('room layouts persist per account, reject invalid edits, and preserve drafts on conflicts', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const snapshot = async () => dataOf(await f.owner.rpc('onmode_snapshot')) as View
  const save = async (revision: number, positions: unknown) => dataOf(await f.owner.rpc('onmode_command', {
    command: { type: 'room_layout', revision, positions },
  })) as View
  try {
    expect((await snapshot()).snapshot.room).toEqual({ revision: 0, positions: {} })
    expect((await f.anon.rpc('onmode_command', { command: { type: 'room_layout', revision: 0, positions: {} } })).error?.code).toBe('42501')
    const choices = [{ desk: { x: 20, y: 10 } }, { desk: { x: 40, y: 10 } }]
    const attempts = await Promise.allSettled(choices.map(positions => save(0, positions)))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const winner = attempts.findIndex(result => result.status === 'fulfilled')
    const first = (await snapshot()).snapshot
    expect(first.room).toEqual({ revision: 1, positions: choices[winner] })
    expect((await save(0, choices[winner])).snapshot.room.revision).toBe(1)
    expect(dataOf(await f.owner.from('reward_transactions').select('coins'))).toEqual([])
    expect(first.inventory.sort()).toEqual(['chair', 'desk'])
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.room).toEqual({ revision: 0, positions: {} })
    expect(dataOf(await f.member.from('room_item_positions').select('item_id'))).toEqual([])
    expect(dataOf(await f.member.from('user_room_layouts').select('user_id'))).toEqual([])
    expect((await f.owner.from('room_item_positions').update({ offset_x: 9999 }).eq('item_id', 'desk')).error?.code).toBe('42501')
    for (const [positions, code] of [
      [{ desk: { x: 9999, y: 0 } }, '22023'],
      [{ desk: { x: 1.5, y: 0 } }, '22023'],
      [{ lamp: { x: 10, y: 0 } }, '42501'],
      [{ wall: { x: 0, y: 0 } }, '22023'],
    ] as const) {
      expect((await f.owner.rpc('onmode_command', { command: { type: 'room_layout', revision: 1, positions } })).error?.code).toBe(code)
    }
    expect((await snapshot()).snapshot.room).toEqual(first.room)

    await f.login(page, 0)
    await page.goto('/growth')
    const desk = page.locator('[data-room-item="desk"]')
    await expect(desk).toHaveAttribute('transform', 'translate(' + choices[winner].desk.x + ' 10)')
    await page.getByRole('button', { name: '배치 편집', exact: true }).click()
    await desk.focus()
    await desk.press('ArrowRight')
    const draft = await desk.getAttribute('transform')
    await save(1, { desk: { x: -10, y: 0 } })
    await page.getByRole('button', { name: '배치 저장', exact: true }).click()
    await expect(page.locator('.room-editor-controls').getByRole('alert')).toHaveText(/저장하지 못했어요/)
    await expect(desk).toHaveAttribute('transform', draft!)
    await page.getByRole('button', { name: '초안 취소하고 최신 배치 보기' }).click()
    await expect(desk).toHaveAttribute('transform', 'translate(-10 0)')
    await page.getByRole('button', { name: '배치 편집', exact: true }).click()
    await desk.focus()
    await desk.press('ArrowRight')
    await page.getByRole('button', { name: '배치 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '배치 편집', exact: true })).toBeVisible()
    await page.reload()
    await expect(desk).toHaveAttribute('transform', 'translate(-5 0)')
    expect((await snapshot()).snapshot.room).toEqual({ revision: 3, positions: { desk: { x: -5, y: 0 } } })
    const hidden = dataOf(await f.owner.rpc('onmode_command', { command: { type: 'place', id: 'desk', placed: false } })) as View
    expect(hidden.snapshot.placed).not.toContain('desk')
    expect(hidden.snapshot.room.revision).toBe(3)
    const shown = dataOf(await f.owner.rpc('onmode_command', { command: { type: 'place', id: 'desk', placed: true } })) as View
    expect(shown.snapshot.room.positions.desk).toEqual({ x: -5, y: 0 })
  } finally { await f.cleanup() }
})
