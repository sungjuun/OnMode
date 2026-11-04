import { expect, test } from '@playwright/test'

test('title search paginates works and editions before saving the exact selected edition', async ({ page }, info) => {
  let requests = 0
  await page.route('https://openlibrary.org/**', route => {
    requests++
    const url = new URL(route.request().url())
    if (url.pathname === '/search.json') {
      expect(url.searchParams.get('title')).toBe('함께 읽는 책 & 기록')
      const second = url.searchParams.get('page') === '2'
      return route.fulfill({ json: { numFound: 11, docs: Array.from({ length: second ? 1 : 10 }, (_, i) => ({ key: '/works/OL' + (second ? 11 : i + 1) + 'W', title: second ? '선택할 작품' : '작품 ' + i, author_name: ['검색 작가'], number_of_pages_median: 999, isbn: ['9780140328721'] })) } })
    }
    expect(url.pathname).toBe('/works/OL11W/editions.json')
    const second = url.searchParams.get('offset') === '10'
    return route.fulfill({ json: { size: 11, entries: Array.from({ length: second ? 1 : 10 }, (_, i) => ({ key: '/books/OL' + (second ? 110 : 100 + i) + 'M', title: second ? '선택한 한국어 판본' : '이전 판본 ' + i, isbn_10: second ? ['080442957X'] : [], number_of_pages: second ? 160 : undefined, publishers: ['선택한 출판사'], publish_date: '2024', languages: [{ key: '/languages/kor' }] })) } })
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/library?tab=books')
  await page.getByRole('button', { name: '도서 등록' }).click()
  await page.getByRole('spinbutton', { name: '일일 목표 (쪽)' }).fill('7')
  await page.getByRole('group', { name: '도서 검색 방식' }).getByRole('button', { name: '제목', exact: true }).click()
  await page.getByRole('textbox', { name: '제목 검색', exact: true }).fill('함께 읽는 책 & 기록')
  expect(requests).toBe(0)
  await page.getByRole('button', { name: '도서 검색', exact: true }).click()
  const results = page.getByRole('region', { name: '작품 검색 결과', exact: true })
  await expect(results.getByRole('article')).toHaveCount(10)
  await expect(results.getByRole('button', { name: '이전 검색 결과' })).toBeDisabled()
  await results.getByRole('button', { name: '다음 검색 결과' }).click()
  await expect(results.getByRole('article')).toHaveCount(1)
  await results.getByRole('button', { name: '이전 검색 결과' }).click()
  await expect(results.getByRole('article')).toHaveCount(10)
  expect(requests).toBe(2)
  await results.getByRole('button', { name: '다음 검색 결과' }).click()
  await results.getByRole('button', { name: '판본 보기' }).click()
  const editions = page.getByRole('region', { name: '판본 선택', exact: true })
  await expect(editions.getByRole('article')).toHaveCount(10)
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('')
  await editions.getByRole('button', { name: '다음 판본' }).click()
  await expect(editions.getByRole('article')).toHaveCount(1)
  await expect(editions.getByRole('button', { name: '다음 판본' })).toBeDisabled()
  await expect(editions.getByRole('link', { name: '출처: Open Library 판본' })).toHaveAttribute('href', 'https://openlibrary.org/books/OL110M')
  await page.getByRole('dialog', { name: '도서 등록' }).evaluate(node => node.scrollTo(0, 0))
  await page.screenshot({ path: info.outputPath('book-discovery-dark.png'), fullPage: true })
  expect(await page.getByRole('dialog', { name: '도서 등록' }).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await editions.getByRole('button', { name: '이 판본 사용' }).click()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('선택한 한국어 판본')
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toBeFocused()
  await expect(page.getByRole('spinbutton', { name: '총 페이지' })).toHaveValue('160')
  await expect(page.getByRole('spinbutton', { name: '일일 목표 (쪽)' })).toHaveValue('7')
  await expect(page.getByRole('textbox', { name: 'ISBN (선택)', exact: true })).toHaveValue('9780804429573')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByRole('heading', { name: '선택한 한국어 판본' })).toBeVisible()
  await page.reload()
  await expect(page.getByText('ISBN 9780804429573', { exact: true })).toBeVisible()
})

test('author search handles empty results, failures and cancelled edition loads without losing drafts', async ({ page }) => {
  let release!: () => void, requested!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { requested = resolve })
  const plainTitle = '<img src=x onerror=window.bookInjected=true>'
  await page.route('https://openlibrary.org/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/search.json') {
      expect(url.searchParams.has('title')).toBe(false)
      const author = url.searchParams.get('author')
      if (author === '오류 작가') { await route.fulfill({ status: 503, json: {} }); return }
      await route.fulfill({ json: { numFound: author === '없는 작가' ? 0 : 1, docs: author === '없는 작가' ? [] : [{ key: '/works/OL1W', title: plainTitle, author_name: ['작가'] }] } }); return
    }
    requested(); await pending
    await route.fulfill({ json: { size: 1, entries: [{ key: '/books/OL1M', title: '취소한 오래된 판본', number_of_pages: 50 }] } }).catch(() => {})
  })
  await page.goto('/library?tab=books')
  await page.getByRole('button', { name: '도서 등록' }).click()
  await page.getByRole('textbox', { name: '책 제목', exact: true }).fill('작성 중인 초안')
  const modes = page.getByRole('group', { name: '도서 검색 방식' })
  await modes.getByRole('button', { name: '저자', exact: true }).click()
  await page.getByRole('textbox', { name: '저자 검색', exact: true }).fill('없는 작가')
  await page.getByRole('button', { name: '도서 검색', exact: true }).click()
  await expect(page.getByText(/검색 결과가 없어요/)).toBeVisible()
  await page.getByRole('textbox', { name: '저자 검색', exact: true }).fill('작가')
  await page.getByRole('button', { name: '도서 검색', exact: true }).click()
  await expect(page.getByRole('heading', { name: plainTitle })).toBeVisible()
  expect(await page.evaluate(() => 'bookInjected' in window)).toBe(false)
  await page.getByRole('button', { name: '판본 보기' }).click()
  await started
  await modes.getByRole('button', { name: 'ISBN', exact: true }).click()
  release()
  await expect(page.getByRole('region', { name: '판본 선택', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('작성 중인 초안')
  await modes.getByRole('button', { name: '저자', exact: true }).click()
  await page.getByRole('textbox', { name: '저자 검색', exact: true }).fill('오류 작가')
  await page.getByRole('button', { name: '도서 검색', exact: true }).click()
  await expect(page.getByText(/도서 정보를 불러오지 못했어요/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: '책 제목', exact: true })).toHaveValue('작성 중인 초안')
})
