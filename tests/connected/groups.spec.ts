import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'

test('two browsers can join a private study and see live focus status', async ({ page, browser }) => {
  const other = await browser.newContext()
  const groupName = '테스트 스터디 ' + randomUUID()
  const emails = Array.from({ length: 2 }, () => 'onmode-' + randomUUID() + '@example.com')
  const password = 'LocalOnly!' + randomUUID()
  async function signup(view: Page, email: string) {
    await view.goto('/account')
    await view.getByRole('button', { name: '회원가입' }).click()
    await view.getByLabel('이메일').fill(email)
    await view.getByLabel('비밀번호').fill(password)
    await view.getByRole('button', { name: '가입하기' }).click()
    await expect(view.getByRole('heading', { name: '계정 연결됨' })).toBeVisible()
    await view.getByRole('link', { name: '스터디', exact: true }).click()
  }
  try {
    await signup(page, emails[0])
    await page.getByRole('button', { name: '그룹 만들기' }).click()
    await page.getByLabel('그룹 이름').fill(groupName)
    await page.getByLabel('공개 범위').selectOption('private')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText(/초대 코드 [0-9a-f]{16}/)).toBeVisible()
    const code = (await page.getByText(/초대 코드 [0-9a-f]{16}/).textContent())!.match(/[0-9a-f]{16}/)![0]

    const member = await other.newPage()
    await signup(member, emails[1])
    await member.getByRole('button', { name: '초대 코드', exact: true }).click()
    await member.getByLabel('초대 코드', { exact: true }).fill(code)
    await member.getByRole('button', { name: '참여하기' }).click()
    await expect(member.getByRole('heading', { name: '멤버 랭킹' })).toBeVisible()
    await expect(member.getByText('실시간 연결', { exact: true })).toBeVisible({ timeout: 12000 })
    await expect(member.getByRole('button', { name: '공동 목표 수정' })).toHaveCount(0)
    await page.getByRole('link', { name: '집중', exact: true }).click()
    await page.getByRole('button', { name: '집중 시작', exact: true }).click()
    await expect(member.getByText(/집중 중 · 일일 목표/)).toBeVisible()
    await page.getByRole('button', { name: '종료하고 저장' }).click()
    await expect(member.getByText(/집중 중 · 일일 목표/)).toHaveCount(0)

    await page.goto('/account')
    await page.getByRole('button', { name: '로그아웃' }).click()
    await expect(page.getByRole('heading', { name: '온모드 계정' })).toBeVisible()
    await page.getByLabel('이메일').fill(emails[0])
    await page.getByLabel('비밀번호').fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).last().click()
    await expect(page.getByRole('heading', { name: '계정 연결됨' })).toBeVisible()
  } finally {
    await other.close()
    // All interpolated values are generated above and restricted to a UUID and fixed text.
    const statement = "delete from public.study_groups where name = '" + groupName + "'; delete from auth.users where email in (" + emails.map(email => "'" + email + "'").join(',') + ");"
    execFileSync('docker', ['exec', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' })
  }
})
