import { expect, test } from '@playwright/test'

test.describe('shares', () => {
  test('renders the pool list or the empty state', async ({ page }) => {
    await page.goto('/shares')
    await expect(page).toHaveURL(/\/shares\/?$/)
    await expect(page.locator('.page-title')).toHaveText('Pools')

    // Pool cards render once data arrives; otherwise a status note shows (loading/error/empty).
    const poolCard = page.locator('.list-card').first()
    const note = page.locator('.page .status-note').first()
    await expect(poolCard.or(note)).toBeVisible()
  })
})
