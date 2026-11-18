import { test, expect, fileRecord, processRecord } from './fixtures/offline.js'
import { processRow } from './utils.js'

test('entry links navigate below the analysis quota and ignore direct conversions', async ({ page, backend }) => {
  // 总共六条记录，但两条直转不占配额；入口行为不依赖 CI 账号遗留了多少任务。
  backend.processes = [
    ...Array.from({ length: 4 }, (_, index) => processRecord(index + 1)),
    processRecord(5, { params_json: '__RAW_CONVERT__' }),
    processRecord(6, { params_json: '__RAW_CONVERT__' }),
  ]
  await page.goto('/workspace')
  await page.getByRole('button', { name: 'New Task', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\/new$/)
  await expect(page.getByRole('heading', { name: 'Create New Analysis', exact: true })).toBeVisible()

  await page.goto('/workspace')
  await page.getByRole('link', { name: 'Go to MyDatasets', exact: true }).click()
  await expect(page).toHaveURL(/\/mydatasets$/)
  await expect(page.getByRole('heading', { name: 'My Datasets', exact: true })).toBeVisible()
})

test('blocks new analysis at the quota and allows it after deleting a result', async ({ page, backend }) => {
  backend.processes = [
    processRecord(1),
    processRecord(2, { status: 'processing', finished_at: null }),
    processRecord(3, { status: 'failed' }),
    processRecord(4),
    processRecord(5),
  ]
  await page.goto('/workspace')
  await page.getByRole('button', { name: 'New Task', exact: true }).click()
  const limitDialog = page.getByRole('dialog').filter({ hasText: 'Unable to Create Analysis' })
  await expect(limitDialog).toBeVisible()
  await expect(limitDialog).toContainText('You have reached the limit of 5 analyses.')
  await expect(page).toHaveURL(/\/workspace$/)
  await limitDialog.locator('.modal-action').getByRole('button', { name: 'Close', exact: true }).click()

  const row = processRow(page, 1)
  await row.getByRole('button', { name: 'Delete', exact: true }).click()
  const deleteDialog = page.getByRole('dialog').filter({ hasText: 'Delete Result' })
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(backend.deleted).toEqual([1])

  await page.getByRole('button', { name: 'New Task', exact: true }).click()
  await expect(page).toHaveURL(/\/workspace\/new$/)
  await expect(page.getByRole('heading', { name: 'Create New Analysis', exact: true })).toBeVisible()
})

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
  await expect(running.getByText('Running', { exact: true })).toBeVisible()
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

test('creates a Peak Alignment task from a dataset and follows it to completion', async ({ page, backend }) => {
  // 新建的是 #2，旁边保留 #20；文件名以数字开头，覆盖 ID 前缀和跨单元格文本拼接。
  backend.processes = [processRecord(20)]
  backend.files = [fileRecord('E2eDataset000001', { filename: '69bdd1_Human_Kidney_DESI_50_Negative.imzML', spectrum_mode: 'centroid', storage_mode: 'processed' })]
  await page.goto('/workspace/new')
  await expect(page.getByRole('button', { name: 'Start Analysis', exact: true })).toBeDisabled()
  await page.locator('.tab:has-text("My Datasets")').click()
  await page.locator('li').filter({ hasText: '69bdd1_Human_Kidney' }).click()
  await page.locator('details[open] label').filter({ hasText: 'Python Backend' }).click()
  await page.getByRole('button', { name: 'Start Analysis', exact: true }).click()

  await expect(page).toHaveURL(/\/workspace$/)
  expect(backend.created).toEqual([{ file_public_id: 'E2eDataset000001', algorithms: { peak_align: expect.anything() } }])
  const row = processRow(page, 2)
  await expect(row.getByText('Running', { exact: true })).toBeVisible()
  await expect(row).toContainText('Peak Alignment')
  await expect(row.getByRole('button', { name: 'View', exact: true })).toHaveCount(0)

  backend.processes[0]!.status = 'completed'
  backend.processes[0]!.finished_at = new Date().toISOString()
  await page.reload()
  await expect(row.getByText('Completed', { exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'View', exact: true })).toBeVisible()
})
