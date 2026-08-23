import { expect, test } from '@playwright/test'

test.describe('disks', () => {
  test('renders disk rows or a status note', async ({ page }) => {
    await page.goto('/disks')
    await expect(page).toHaveURL(/\/disks\/?$/)
    await expect(page.locator('.page-title')).toHaveText('Disks')

    // Configured rig: the array section (parity/array/boot/cache cards) renders.
    // Unconfigured/loading: a status note is shown instead.
    const diskSection = page.locator('.disks-page')
    const note = page.locator('.page .status-note').first()
    await expect(diskSection.or(note)).toBeVisible()
  })
})
