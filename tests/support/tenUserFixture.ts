import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Page } from '@playwright/test'
import type { Group } from '../../src/data/supabase'
import { dataOf } from './studyFixture'

export async function tenUserFixture() {
  const stack = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  if (stack.API_URL !== 'http://127.0.0.1:56321' || !stack.PUBLISHABLE_KEY?.startsWith('sb_publishable_')) throw Error('Expected the isolated ONMODE stack.')
  const make = () => createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const clients = Array.from({ length: 10 }, make), anonymous = make()
  const emails = clients.map(() => 'onmode-ten-' + randomUUID() + '@example.com')
  const password = 'LocalOnly!' + randomUUID(), marker = randomUUID()
  const names = clients.map((_, i) => '검증 멤버 ' + String(i + 1).padStart(2, '0'))
  const privateName = '10인 비공개 검증 ' + marker, publicName = '10인 공개 검증 ' + marker
  const groupIds: string[] = [], userIds: string[] = []
  const sql = (statement: string) => execFileSync('docker', ['exec', '-i', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  const emailList = emails.map(email => "'" + email + "'").join(',')
  let cleaned = false
  async function cleanup() {
    if (cleaned) return
    // All interpolated values are generated fixture names/UUIDs, never user input.
    sql("begin; delete from public.study_groups where name in ('" + privateName + "','" + publicName + "'); delete from auth.users where email in (" + emailList + "); commit;")
    const remaining = sql('select count(*) from auth.users where email in (' + emailList + ')')
    if (remaining !== '0') throw Error('Temporary account cleanup is incomplete.')
    await Promise.all([...clients, anonymous].map(client => client.auth.dispose()))
    cleaned = true
  }
  try {
    const registrations = await Promise.all(clients.map((client, i) => client.auth.signUp({ email: emails[i], password })))
    for (const registration of registrations) {
      const user = dataOf(registration).user
      if (!user) throw Error('Temporary signup did not create a user.')
      userIds.push(user.id)
    }
    await Promise.all(clients.map(async (client, i) => dataOf(await client.rpc('onmode_command', { command: { type: 'profile', value: { name: names[i], goalMinutes: 120, notifications: false } } }))))
    for (const [name, isPublic] of [[privateName, false], [publicName, true]] as const) {
      groupIds.push(dataOf(await clients[0].rpc('onmode_group_change', { action: 'create', payload: { name, description: '임시 10인 기능 검증', isPublic, goalMinutes: 600 } })) as string)
    }
    const [privateId, publicId] = groupIds
    const groups = dataOf(await clients[0].rpc('onmode_groups')) as Group[]
    const inviteCode = groups.find(group => group.id === privateId)?.inviteCode
    if (!inviteCode) throw Error('Temporary private group has no invite code.')
    const login = async (page: Page, index: number) => {
      await page.goto('/account')
      await page.getByLabel('이메일', { exact: true }).fill(emails[index])
      await page.getByLabel('비밀번호', { exact: true }).fill(password)
      await page.getByRole('button', { name: '로그인', exact: true }).last().click()
      await page.getByRole('heading', { name: '계정 연결됨' }).waitFor({ timeout: 20000 })
      await page.goto('/my')
      await page.getByRole('heading', { name: names[index], exact: true }).waitFor()
      await page.goto('/study')
    }
    const select = async (page: Page) => {
      await page.getByRole('article').filter({ has: page.getByRole('heading', { name: privateName, exact: true }) }).getByRole('button', { name: '보기', exact: true }).click()
      await page.getByText('실시간 연결', { exact: true }).waitFor({ timeout: 20000 })
    }
    const counts = () => ({ users: Number(sql('select count(*) from auth.users where email in (' + emailList + ')')), groups: Number(sql("select count(*) from public.study_groups where name in ('" + privateName + "','" + publicName + "')")) })
    return { clients, anonymous, userIds, names, privateId, publicId, publicName, privateName, inviteCode, sql, login, select, counts, cleanup }
  } catch (error) { await cleanup(); throw error }
}
