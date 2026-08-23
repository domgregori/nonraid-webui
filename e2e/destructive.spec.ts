import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

// Destructive suite: only runs when explicitly opted in, never in the default suite.
const DESTRUCTIVE = process.env.E2E_DESTRUCTIVE === '1'

test.describe('@danger destructive', () => {
  test.skip(!DESTRUCTIVE, 'destructive')

  let shareName = ''

  test.afterEach(async ({ page }) => {
    // Safety net: always remove the pool even if the test failed mid-way.
    if (shareName) {
      await page.request.delete(`/api/shares/${encodeURIComponent(shareName)}`).catch(() => {})
    }
    shareName = ''
  })

  test('@danger creates then deletes a uniquely-named pool', async ({ page }) => {
    shareName = `e2e-${randomUUID().slice(0, 8)}`

    // A pool needs at least one data disk - skip cleanly on a rig without any.
    const statusRes = await page.request.get('/api/status')
    expect(statusRes.ok(), `GET /api/status -> ${statusRes.status()}`).toBeTruthy()
    const status = (await statusRes.json()) as { disks?: { type: string }[] }
    const dataDisks = (status.disks ?? []).filter((d) => d.type === 'data')
    test.skip(dataDisks.length === 0, 'no data disks to create a pool on')

    // Create the pool through the UI (SharesPage -> Add Pool modal).
    await page.goto('/shares')
    await page.getByRole('button', { name: 'Add Pool' }).click()

    const dialog = page.locator('.dialog')
    // The form's data-disk list comes from the array status poll; wait until it has
    // loaded (the "Use all drives" description counts the disks) before submitting,
    // otherwise the create fails validation with "Select at least one disk."
    await expect(dialog.locator('.toggle-row__desc')).toContainText(/Using all [1-9]/)
    await dialog.getByLabel('Name').fill(shareName)
    await dialog.getByRole('button', { name: 'Create Pool' }).click()

    // The new pool shows up in the list once the create request settles.
    const poolCard = page.locator('.list-card').filter({ hasText: shareName })
    await expect(poolCard).toBeVisible({ timeout: 15000 })

    // Delete it through the UI (two-step confirm) and confirm it's gone.
    await poolCard.getByRole('button', { name: 'Delete' }).click()
    await poolCard.getByRole('button', { name: 'Confirm?' }).click()
    await expect(poolCard).toHaveCount(0)
  })
})
