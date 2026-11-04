import { expect, test } from '@playwright/test'

const endpoint = 'https://openlibrary.org/api/books?*'
const isbn = '9780140328721'
const result = { ['ISBN:' + isbn]: { title: '검색한 도서', authors: [{ name: '검색한 저자' }], number_of_pages: 96 } }

test('ISBN lookup fills an editable book, persists it, and blocks equivalent duplicates', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let requests = 0
  await page.route(endpoint, route => {
    requests++
    expect(new URL(route.request().url()).searchParams.get('bibkeys')).toBe('ISBN:' + isbn)
    return route.fulfill({ json: result })
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/library?tab=books')
  await page.getByRole('button', { name: '도서 등록' }).click()
  await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill('9780140328722')
  await page.getByRole('button', { name: 'ISBN으로 검색' }).click()
  await expect(page.getByText(/마지막 확인 숫자/)).toBeVisible()
  expect(requests).toBe(0)
  await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill('0-14-032872-6')
  await page.getByRole('button', { name: 'ISBN으로 검색' }).click()
  await expect(page.getByRole('region', { name: '도서 검색 결과' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('')
  await page.getByRole('button', { name: '이 정보 사용' }).click()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('검색한 도서')
  await expect(page.getByRole('spinbutton', { name: '총 페이지' })).toHaveValue('96')
  await page.getByRole('textbox', { name: '책 제목', exact: true }).fill('내가 읽는 판본')
  await page.getByRole('spinbutton', { name: '총 페이지' }).fill('120')
  const dialog = page.getByRole('dialog', { name: '도서 등록' })
  await dialog.evaluate(node => node.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('book-isbn-dark.png'), fullPage: true })
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '내가 읽는 판본' })).toBeVisible()
  await expect(page.getByText('ISBN ' + isbn, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '도서 등록' }).click()
  await page.getByRole('textbox', { name: '책 제목', exact: true }).fill('중복 시도')
  await page.getByRole('textbox', { name: '저자', exact: true }).fill('저자')
  await page.getByRole('spinbutton', { name: '총 페이지' }).fill('120')
  await page.getByRole('textbox', { name: 'ISBN (선택)', exact: true }).fill('0140328726')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('이미 서재에 등록한 ISBN입니다.')
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('중복 시도')
  expect(requests).toBe(1)
  expect(errors).toEqual([])
})

test('unavailable metadata and provider failure allow manual registration', async ({ page }) => {
  await page.clock.install()
  let requests = 0
  await page.route(endpoint, route => {
    requests++
    return requests === 1 ? route.fulfill({ json: {} }) : route.fulfill({ status: 429, json: {} })
  })
  await page.goto('/library?tab=books')
  await page.getByRole('button', { name: '도서 등록' }).click()
  await page.getByRole('textbox', { name: '책 제목', exact: true }).fill('직접 입력한 도서')
  await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill(isbn)
  await page.getByRole('button', { name: 'ISBN으로 검색' }).click()
  await expect(page.getByText(/해당 ISBN의 도서 정보가 없어요/)).toBeVisible()
  await page.clock.fastForward(1200)
  await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill('9780804429573')
  await page.getByRole('button', { name: 'ISBN으로 검색' }).click()
  await expect(page.getByText(/도서 서비스가 혼잡해요/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('직접 입력한 도서')
  await page.getByRole('textbox', { name: '저자', exact: true }).fill('직접 입력한 저자')
  await page.getByRole('spinbutton', { name: '총 페이지' }).fill('150')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('heading', { name: '직접 입력한 도서' })).toBeVisible()
})

test('changing an ISBN cancels a pending result without overwriting the draft', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let requested!: () => void
  const started = new Promise<void>(resolve => { requested = resolve })
  await page.route(endpoint, async route => { requested(); await pending; await route.fulfill({ json: result }).catch(() => {}) })
  await page.goto('/library?tab=books')
  await page.getByRole('button', { name: '도서 등록' }).click()
  await page.getByRole('textbox', { name: '책 제목', exact: true }).fill('작성 중인 제목')
  await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill(isbn)
  await page.getByRole('button', { name: 'ISBN으로 검색' }).click()
  await started
  await page.getByRole('textbox', { name: 'ISBN 검색', exact: true }).fill('9780804429573')
  release()
  await expect(page.getByRole('button', { name: 'ISBN으로 검색' })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('작성 중인 제목')
  await expect(page.getByRole('region', { name: '도서 검색 결과' })).toHaveCount(0)
  await page.getByRole('button', { name: '창 닫기' }).click()
  await page.getByRole('button', { name: '도서 등록' }).click()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('')
})
