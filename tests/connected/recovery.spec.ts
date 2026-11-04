import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const mailpit = 'http://127.0.0.1:56324/api/v1'
const appOrigin = 'http://127.0.0.1:5182'

test('reset a password through a one-time email link and sign in again', async ({ page, browser }) => {
  const email = 'onmode-' + randomUUID() + '@example.com'
  const oldPassword = 'LocalOnly!' + randomUUID()
  const newPassword = 'Changed!' + randomUUID()
  const messages = new Set<string>()
  const other = await browser.newContext()
  const login = async (password: string) => {
    await page.getByLabel('이메일', { exact: true }).fill(email)
    await page.getByLabel('비밀번호', { exact: true }).fill(password)
    await page.getByRole('button', { name: '로그인', exact: true }).last().click()
  }
  try {
    await page.goto('/account')
    await page.getByRole('button', { name: '회원가입' }).click()
    await page.getByLabel('이메일', { exact: true }).fill(email)
    await page.getByLabel('비밀번호', { exact: true }).fill(oldPassword)
    await page.getByRole('button', { name: '가입하기' }).click()
    await expect(page.getByRole('heading', { name: '계정 연결됨' })).toBeVisible()
    await page.getByRole('button', { name: '로그아웃' }).click()

    await page.getByRole('button', { name: '비밀번호를 잊었나요?' }).click()
    await page.getByLabel('가입 이메일').fill(email)
    await page.getByRole('button', { name: '재설정 링크 보내기' }).click()
    await expect(page.getByRole('status')).toHaveText(/가입된 이메일이면 재설정 링크가 발송됩니다/)

    let messageId: string | undefined
    await expect.poll(async () => {
      const response = await fetch(mailpit + '/search?query=' + encodeURIComponent('to:' + email))
      if (!response.ok) return false
      const result: { messages: { ID: string; Subject: string }[] } = await response.json()
      for (const message of result.messages) messages.add(message.ID)
      messageId = result.messages.find(m => /reset/i.test(m.Subject))?.ID
      return Boolean(messageId)
    }).toBe(true)
    const response = await fetch(mailpit + '/message/' + encodeURIComponent(messageId!))
    const message: { HTML: string } = await response.json()
    const href = message.HTML.match(/href="([^"]+\/auth\/v1\/verify\?[^"]+)"/i)?.[1]?.replaceAll('&amp;', '&')
    if (!href) throw Error('Mailpit did not receive a reset link.')
    const verify = new URL(href)
    if (verify.origin !== 'http://127.0.0.1:56321' || verify.searchParams.get('type') !== 'recovery') {
      throw Error('The password reset link did not use the local Auth service.')
    }

    // Read the redirect without printing the single-use link or code to the test report.
    const redirect = await fetch(verify, { redirect: 'manual' })
    const callback = new URL(redirect.headers.get('location') ?? '/', appOrigin)
    if (callback.origin !== appOrigin || callback.pathname !== '/account/recovery' || !callback.searchParams.has('code')) {
      throw Error('The Auth service did not redirect to the allowlisted recovery page.')
    }

    const unrelated = await other.newPage()
    await unrelated.goto('/account/recovery')
    await unrelated.evaluate(link => window.location.assign(link), callback.href)
    await expect(unrelated.getByRole('alert')).toHaveText(/만료됐거나 이미 사용/)
    await expect(unrelated.getByLabel('새 비밀번호 확인')).toHaveCount(0)

    await page.evaluate(link => window.location.assign(link), callback.href)
    await expect(page.getByLabel('새 비밀번호 (8자 이상)', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(appOrigin + '/account/recovery')
    await expect(page.getByRole('link', { name: '로컬 체험 모드', exact: true })).toBeVisible()
    await page.getByLabel('새 비밀번호 (8자 이상)', { exact: true }).fill(newPassword)
    await page.getByLabel('새 비밀번호 확인').fill(oldPassword)
    await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(/일치하지 않아요/)
    await page.getByLabel('새 비밀번호 확인').fill(newPassword)
    await page.getByRole('button', { name: '비밀번호 변경', exact: true }).click()
    await expect(page.getByRole('heading', { name: '비밀번호를 변경했어요' })).toBeVisible()
    await page.getByRole('link', { name: '로그인 화면으로' }).click()

    await login(oldPassword)
    await expect(page.getByRole('alert')).toBeVisible()
    await login(newPassword)
    await expect(page.getByRole('heading', { name: '계정 연결됨' })).toBeVisible()

    await page.evaluate(link => window.location.assign(link), callback.href)
    await expect(page.getByRole('alert')).toHaveText(/만료됐거나 이미 사용/)
    await expect(page.getByLabel('새 비밀번호 확인')).toHaveCount(0)
  } finally {
    await other.close()
    if (messages.size) {
      await fetch(mailpit + '/messages', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ IDs: [...messages] }),
      })
    }
    const statement = "delete from auth.users where email = '" + email + "';"
    execFileSync('docker', ['exec', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', statement], { stdio: 'pipe' })
  }
})
