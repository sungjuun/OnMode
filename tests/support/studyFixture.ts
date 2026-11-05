import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'

export function dataOf<T>(result: { data: T | null; error: { code?: string; statusCode?: string } | null }): T {
  if (result.error || result.data === null) throw Error('Local fixture operation failed: ' + (result.error?.code ?? result.error?.statusCode ?? 'missing data'))
  return result.data
}

export async function studyFixture() {
  const stack = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (stack.API_URL !== 'http://127.0.0.1:56321') throw Error('Expected the isolated ONMODE stack.')
  const make = () => createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const clients = [make(), make(), make(), make()]
  const [owner, member, outsider, anon] = clients
  const emails = Array.from({ length: 3 }, () => 'onmode-' + randomUUID() + '@example.com')
  const password = 'LocalOnly!' + randomUUID(), groupName = '온모드 집중 스터디'
  let groupId: string | undefined
  const sql = (statement: string) => execFileSync('docker', ['exec', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], { encoding: 'utf8' }).trim()
  async function cleanup() {
    if (groupId) sql("delete from public.study_groups where id = '" + groupId + "'")
    sql("delete from auth.users where email in (" + emails.map(email => "'" + email + "'").join(',') + ")")
    await Promise.all(clients.map(app => app.auth.dispose()))
  }
  try {
    for (let i = 0; i < 3; i++) dataOf(await clients[i].auth.signUp({ email: emails[i], password }))
    groupId = dataOf(await owner.rpc('onmode_group_change', { action: 'create', payload: { name: groupName, description: '', isPublic: false, goalMinutes: 600 } })) as string
    const code = dataOf(await owner.rpc('onmode_groups')).find((g: { id: string }) => g.id === groupId).inviteCode
    dataOf(await member.rpc('onmode_group_change', { action: 'invite', payload: { code } }))
    const login = async (page: Page, index: number) => {
      await page.goto('/account')
      await page.getByLabel('이메일', { exact: true }).fill(emails[index])
      await page.getByLabel('비밀번호', { exact: true }).fill(password)
      await page.getByRole('button', { name: '로그인', exact: true }).last().click()
      await page.getByRole('heading', { name: '계정 연결됨' }).waitFor()
      await page.goto('/study')
      await page.getByRole('article').filter({ has: page.getByRole('heading', { name: groupName }) }).getByRole('button', { name: '보기' }).click()
      await page.getByText('실시간 연결', { exact: true }).waitFor()
    }
    return { owner, member, outsider, anon, groupId, login, sql, cleanup }
  } catch (error) { await cleanup(); throw error }
}
