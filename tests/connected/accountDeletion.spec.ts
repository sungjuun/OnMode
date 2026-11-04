import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'

test('deletion requires a fresh password and removes personal records while transferring a study', async ({ page }) => {
  const stack = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (stack.API_URL !== 'http://127.0.0.1:56321') throw Error('Expected the isolated ONMODE stack.')
  const makeClient = () => createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const owner = makeClient(), member = makeClient(), anonymous = makeClient()
  const email = 'onmode-' + randomUUID() + '@example.com', memberEmail = 'onmode-' + randomUUID() + '@example.com'
  const password = 'LocalOnly!' + randomUUID()
  const fixtureIds: string[] = []
  const sql = (statement: string) => execFileSync('docker', ['exec', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], { encoding: 'utf8' }).trim()
  const dataOf = <T,>(result: { data: T; error: { code?: string } | null }) => {
    if (result.error) throw Error('Local fixture setup failed: ' + result.error.code)
    return result.data
  }
  try {
    const oldSession = dataOf(await owner.auth.signUp({ email, password })).session!
    const ownerId = oldSession.user.id
    const memberId = dataOf(await member.auth.signUp({ email: memberEmail, password })).user!.id
    const sessionId = JSON.parse(Buffer.from(oldSession.access_token.split('.')[1], 'base64url').toString()).session_id
    const createGroup = async (name: string) => {
      const gid = dataOf(await owner.rpc('onmode_group_change', { action: 'create', payload: { name, isPublic: false, goalMinutes: 600 } })) as string
      fixtureIds.push(gid)
      return gid
    }
    const groupId = await createGroup('계정 삭제 이관 테스트')
    const soloId = await createGroup('계정 삭제 빈 그룹 테스트')
    const invite = dataOf(await owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === groupId).inviteCode
    dataOf(await member.rpc('onmode_group_change', { action: 'invite', payload: { code: invite } }))
    const noticeId = randomUUID(), soloNoticeId = randomUUID()
    for (const [gid, id] of [[groupId, noticeId], [soloId, soloNoticeId]]) {
      dataOf(await owner.rpc('onmode_notice_change', { group_id: gid, action: 'create', payload: { id, title: '공유 운영 규칙', body: '함께 정한 그룹 규칙입니다.' } }))
    }
    const focusId = randomUUID()
    dataOf(await owner.rpc('onmode_command', { command: { type: 'start', value: { id: focusId, method: 'flow', activityId: null, targetSeconds: null, restSeconds: 0 } } }))
    sql("update public.focus_sessions set active_since = active_since - interval '65 seconds' where id = '" + focusId + "'")
    dataOf(await owner.rpc('onmode_command', { command: { type: 'finish', id: focusId } }))
    expect(sql("select count(*) from public.reward_transactions where user_id = '" + ownerId + "'")).toBe('1')
    expect((await anonymous.rpc('onmode_delete_account', { confirmation: '계정 삭제' })).error?.code).toBe('42501')
    expect((await owner.rpc('onmode_delete_account', { confirmation: '삭제' })).error?.code).toBe('22023')
    sql("update auth.sessions set created_at = now() - interval '6 minutes' where id = '" + sessionId + "'")
    expect((await owner.rpc('onmode_delete_account', { confirmation: '계정 삭제' })).error?.code).toBe('42501')

    await page.goto('/my')
    await page.getByRole('button', { name: '환경설정' }).click()
    const settings = page.getByRole('dialog', { name: '환경설정' })
    await settings.getByLabel('닉네임').fill('체험 기록 보존')
    await settings.getByRole('button', { name: '저장' }).click()
    await expect(page.getByRole('heading', { name: '체험 기록 보존' })).toBeVisible()
    await page.goto('/account')
    await page.getByLabel('이메일', { exact: true }).fill(email)
    await page.getByLabel('비밀번호', { exact: true }).fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).last().click()
    await page.getByRole('button', { name: '계정 삭제 시작' }).click()
    let dialog = page.getByRole('dialog', { name: '계정 영구 삭제' })
    await expect(dialog.getByRole('button', { name: '계정 영구 삭제' })).toBeDisabled()
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(page.getByRole('heading', { name: '계정 연결됨' })).toBeVisible()

    await page.getByRole('button', { name: '계정 삭제 시작' }).click()
    dialog = page.getByRole('dialog', { name: '계정 영구 삭제' })
    await dialog.getByLabel('삭제 확인 문구').fill('계정 삭제')
    await dialog.getByLabel('현재 비밀번호').fill('WrongPassword!')
    await dialog.getByRole('button', { name: '계정 영구 삭제' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(/비밀번호를 다시 확인/)
    await dialog.getByLabel('현재 비밀번호').fill(password)
    await dialog.getByRole('button', { name: '계정 영구 삭제' }).click()
    await expect(page.getByRole('status')).toHaveText(/계정이 삭제됐어요/)
    await expect(page.getByRole('link', { name: '로컬 체험 모드', exact: true })).toBeVisible()
    await page.goto('/my')
    await expect(page.getByRole('heading', { name: '체험 기록 보존' })).toBeVisible()

    for (const table of ['auth.sessions', 'public.profiles', 'public.focus_sessions', 'public.reward_transactions', 'public.group_members']) {
      expect(sql("select count(*) from " + table + " where user_id = '" + ownerId + "'")).toBe('0')
    }
    expect(sql("select count(*) from auth.users where id = '" + ownerId + "'")).toBe('0')
    expect(sql("select count(*) from public.study_groups where id = '" + soloId + "'")).toBe('0')
    expect(sql("select count(*) from public.group_notices where id = '" + soloNoticeId + "'")).toBe('0')
    expect(sql("select count(*) from public.group_contributions where session_id = '" + focusId + "'")).toBe('0')
    expect((await owner.rpc('onmode_snapshot')).error?.code).toBe('42501')
    const remaining = dataOf(await member.rpc('onmode_groups')).find((g: { id: string }) => g.id === groupId)
    expect(remaining).toMatchObject({ role: 'owner', members: 1 })
    expect(dataOf(await member.rpc('onmode_notices', { group_id: groupId }))).toMatchObject([{ id: noticeId, body: '함께 정한 그룹 규칙입니다.' }])
    expect(dataOf(await member.rpc('onmode_ranking', { group_id: groupId, zone: 'Asia/Seoul' }))).toMatchObject({
      total: 0, members: [{ id: memberId, role: 'owner' }],
    })
  } finally {
    for (const gid of fixtureIds) sql("delete from public.study_groups where id = '" + gid + "'")
    sql("delete from auth.users where email in ('" + email + "','" + memberEmail + "')")
    await Promise.all([owner, member, anonymous].map(app => app.auth.dispose()))
  }
})
