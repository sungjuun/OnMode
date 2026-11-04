import { expect, test } from '@playwright/test'

test('appearance follows the system and a manual choice survives navigation and reload', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/my')
  const root = page.locator('html')
  await expect(root).toHaveAttribute('data-theme', 'light')
  const dialog = page.getByRole('dialog', { name: '환경설정' })
  const openSettings = async () => {
    await page.getByRole('button', { name: '환경설정' }).click()
    await expect(dialog).toBeVisible()
  }
  const closeSettings = () => page.keyboard.press('Escape')
  await openSettings()
  await expect(dialog.getByRole('button', { name: '시스템', pressed: true })).toBeVisible()
  await dialog.getByRole('button', { name: '어둡게' }).click()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await expect(dialog).toHaveCSS('color-scheme', 'dark')
  await expect(dialog.getByLabel('닉네임')).toBeVisible()
  await closeSettings()

  for (const route of ['/my', '/', '/focus', '/study', '/growth', '/library', '/account']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(root).toHaveCSS('color-scheme', 'dark')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
    if (route === '/' || route === '/growth') {
      await page.evaluate(() => document.fonts.ready.then(() => true))
      await page.screenshot({ path: info.outputPath(route === '/' ? 'dark-home.png' : 'dark-growth.png'), scale: 'css' })
    }
  }
  await page.reload()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.goto('/my')
  await openSettings()
  await expect(dialog.getByRole('button', { name: '어둡게', pressed: true })).toBeVisible()
  await page.emulateMedia({ colorScheme: 'dark' })
  await dialog.getByRole('button', { name: '밝게' }).click()
  await expect(root).toHaveAttribute('data-theme', 'light')
  await dialog.getByRole('button', { name: '시스템' }).click()
  await expect(root).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(root).toHaveAttribute('data-theme', 'light')
})
