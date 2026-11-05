import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Activity, View } from '../../src/domain/model'
import { dataOf, studyFixture } from '../support/studyFixture'

test('standalone study persists beside certifications and remains private with server constraints', async ({ page }) => {
  test.setTimeout(60000)
  const f = await studyFixture()
  const cert = { id: randomUUID(), name: '기존 자격증', examDate: '2027-01-01', result: 'pending' }
  const study = (): Activity => ({ id: randomUUID(), kind: 'subject', name: '개인공부 검증', goalMinutes: 120 })
  const save = (value: Activity) => ({ command: { type: 'activity', value } })
  try {
    dataOf(await f.owner.rpc('onmode_command', { command: { type: 'certification', value: cert } }))
    dataOf(await f.owner.rpc('onmode_command', save({ ...study(), name: '기존 과목', certificationId: cert.id })))
    expect((await f.anon.rpc('onmode_command', save(study()))).error?.code).toBe('42501')
    for (const goalMinutes of [undefined, 0, 100001]) {
      expect((await f.owner.rpc('onmode_command', save({ ...study(), goalMinutes }))).error?.code).toBe('23514')
    }
    expect((await f.owner.rpc('onmode_command', save({ ...study(), pages: 100 }))).error?.code).toBe('23514')
    expect((await f.owner.rpc('onmode_command', save({ ...study(), isbn: '9780140328721' }))).error?.code).toBe('22023')
    expect((await f.member.rpc('onmode_command', save({ ...study(), certificationId: cert.id }))).error?.code).toBe('23503')
    await f.login(page, 0)
    await page.goto('/library')
    await page.getByRole('button', { name: '등록', exact: true }).click()
    await page.getByRole('textbox', { name: '공부 이름', exact: true }).fill('계정 개인공부')
    await page.getByRole('spinbutton', { name: '목표 시간 (분)', exact: true }).fill('45')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '공부 등록' })).not.toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: '계정 개인공부', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '기존 자격증', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '기존 과목', exact: true })).toBeVisible()
    const view = dataOf(await f.owner.rpc('onmode_snapshot')) as View
    const activity = view.snapshot.activities.find(a => a.name === '계정 개인공부')!
    expect(activity).toMatchObject({ kind: 'subject', goalMinutes: 45 })
    expect(activity.certificationId).toBeUndefined()
    const card = page.locator('section.card').filter({ has: page.getByRole('heading', { name: '계정 개인공부', exact: true }) })
    await card.getByRole('button', { name: '학습 기록' }).click()
    await page.getByLabel('푼 문제 수').fill('4')
    await page.getByLabel('공부한 내용').fill('개인 학습 메모')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '학습 기록' })).not.toBeVisible()
    await page.reload()
    await card.getByText('저장한 기록 1개', { exact: true }).click()
    await expect(card.getByText('개인 학습 메모', { exact: true })).toBeVisible()
    await card.getByRole('link', { name: '집중하기', exact: true }).click()
    await page.getByRole('button', { name: /플로우타임/ }).click()
    await page.getByRole('button', { name: '집중 시작', exact: true }).click()
    await expect(page.getByRole('button', { name: '일시정지' })).toBeVisible()
    await page.getByRole('button', { name: '일시정지', exact: true }).click()
    await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: '재개', exact: true })).toBeVisible()
    const timer = (dataOf(await f.owner.rpc('onmode_snapshot')) as View).snapshot.timer!
    expect(timer.activityId).toBe(activity.id)
    f.sql("update public.focus_sessions set elapsed_ms = 65000 where id = '" + timer.id + "' and ended_at is null")
    await page.getByRole('button', { name: '종료하고 저장', exact: true }).click()
    await expect(page.getByRole('button', { name: '집중 시작', exact: true })).toBeVisible()
    await page.getByRole('link', { name: '기록 보기', exact: true }).click()
    const history = page.getByRole('region', { name: '집중 기록', exact: true })
    await history.getByRole('combobox', { name: '활동', exact: true }).selectOption(activity.id)
    await history.getByRole('combobox', { name: '집중 방식', exact: true }).selectOption('flow')
    await expect(history.getByText('조건에 맞는 기록 1회 · 1분')).toBeVisible()
    await expect(history.getByRole('listitem')).toContainText('계정 개인공부')
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.records).toEqual([])
    expect(dataOf(await f.member.from('activities').select('id'))).toEqual([])
    expect((dataOf(await f.member.rpc('onmode_snapshot')) as View).snapshot.activities).toEqual([])
    expect((await f.member.rpc('onmode_command', { command: { type: 'journal', value: { id: randomUUID(), activityId: activity.id, date: '2026-11-05', text: '', amount: 1 } } })).error?.code).toBe('42501')
    expect((await f.owner.from('activities').insert({ id: randomUUID(), kind: 'subject', name: '직접 쓰기', goal_minutes: 10 })).error?.code).toBe('42501')
  } finally { await f.cleanup() }
})
