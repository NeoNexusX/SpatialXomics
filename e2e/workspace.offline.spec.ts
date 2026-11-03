import { test, expect, processRecord } from './fixtures/offline.js'

test('searches on submit, resets pagination, and clears the filename filter', async ({ page, backend }) => {
  backend.processes = [processRecord(1), processRecord(2), processRecord(3, { filename: 'Kidney.imzML' })]
  await page.goto('/workspace')
  await expect(page.getByRole('row').filter({ hasText: 'Process #1' })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Kidney' })).toBeVisible()
  const requests = backend.lists.length
  const input = page.getByPlaceholder('Search datasets')
  await input.fill('  Brain  ')
  expect(backend.lists).toHaveLength(requests)
  await input.press('Enter')
  await expect(page.getByRole('row').filter({ hasText: 'Brain_1' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Kidney' })).toHaveCount(0)
  expect(backend.lists.at(-1)).toEqual({ page: 1, size: 2, filter: { filename: 'Brain' } })
  await input.fill('')
  await expect.poll(() => backend.lists.at(-1)).toEqual({ page: 1, size: 2, filter: {} })
  await page.getByRole('combobox').selectOption('5')
  await expect(page.getByRole('row').filter({ hasText: 'Kidney' })).toBeVisible()
  expect(backend.lists.at(-1)).toEqual({ page: 1, size: 5, filter: {} })
})

test('deletes only after confirmation and falls back when the last row of a page is removed', async ({ page, backend }) => {
  backend.processes = [processRecord(1), processRecord(2), processRecord(3)]
  await page.goto('/workspace')
  await expect(page.getByRole('row').filter({ hasText: 'Brain_1' })).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'Brain_3' })
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Delete Result' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(backend.deleted).toEqual([])
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: 'Brain_1' })).toBeVisible()
  await expect(row).toHaveCount(0)
  expect(backend.deleted).toEqual([3])
  expect(backend.lists.at(-1)?.page).toBe(1)
  const completed = page.getByText('Successfully completed', { exact: true }).locator('..')
  await expect(completed.getByText('2', { exact: true })).toBeVisible()
})

test('keeps the result after a failed delete and allows another confirmed attempt', async ({ page, backend }) => {
  backend.processes = [processRecord(1)]
  backend.deleteStatus = 500
  await page.goto('/workspace')
  const row = page.getByRole('row').filter({ hasText: 'Brain_1' })
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Delete Result' })
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect.poll(() => backend.deleted.length).toBe(1)
  // httpClient 会把后端 detail 提升为错误文案，提示里显示的是 fixture 的 detail。
  await expect(page.getByText('E2E delete result', { exact: true })).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(row).toBeVisible()
  backend.deleteStatus = 200
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toHaveCount(0)
  expect(backend.deleted).toEqual([1, 1])
})

test('shows failed-task details and limits actions on running tasks', async ({ page, backend }) => {
  backend.processes = [
    processRecord(1, { status: 'failed', error_message: 'Invalid mass axis in source data' }),
    processRecord(2, { status: 'processing', finished_at: null }),
  ]
  await page.goto('/workspace')
  await page.getByRole('row').filter({ hasText: 'Brain_1' }).getByRole('button', { name: 'View', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Invalid mass axis in source data' })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/\/workspace$/)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  const running = page.getByRole('row').filter({ hasText: 'Brain_2' })
  await expect(running.getByRole('button', { name: 'View', exact: true })).toHaveCount(0)
  await expect(running.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0)
})

test('expires authentication in the store and redirects to login with the original destination', async ({ page, backend }) => {
  backend.userStatus = 401
  await page.goto('/workspace')
  await expect(page).toHaveURL(/\/login\?redirect=\/workspace$/)
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()
})
