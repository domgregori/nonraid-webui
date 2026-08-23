import { expect, test } from '@playwright/test'

// Real nav labels + hrefs, read from src/components/layout/NavTabs.tsx and the route table in src/App.tsx.
// Note the actual labels are "Pools" (/shares) and "Sharing" (/users) - not "Shares"/"Users".
const NAV_TABS = [
  { label: 'Dashboard', href: '/', selector: '.dashboard' },
  { label: 'Disks', href: '/disks', title: 'Disks' },
  { label: 'Pools', href: '/shares', title: 'Pools' },
  { label: 'Browse', href: '/browse', title: 'Browse' },
  { label: 'Sharing', href: '/users', title: 'Sharing' },
  { label: 'Docker', href: '/docker', title: 'Docker Containers' },
  { label: 'LXC', href: '/lxc', title: 'LXC Containers' },
  { label: 'Apps', href: '/apps', title: 'Apps' },
  { label: 'History', href: '/history', title: 'History' },
  { label: 'Settings', href: '/settings', title: 'Settings' },
] as const

test.describe('smoke', () => {
  test('dashboard loads with the app shell', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/?$/)
    await expect(page.locator('.dashboard')).toBeVisible()
    // Array status pill + main nav are part of the persistent app shell (Header/NavTabs).
    await expect(page.locator('.status-pill')).toBeVisible()
    await expect(page.locator('.nav-tabs')).toBeVisible()
  })

  test('all main nav tabs render', async ({ page }) => {
    await page.goto('/')
    for (const tab of NAV_TABS) {
      await expect(page.getByRole('link', { name: tab.label, exact: true })).toBeVisible()
    }
  })

  for (const tab of NAV_TABS) {
    test(`navigating to ${tab.label} (${tab.href}) loads without crashing`, async ({ page }) => {
      await page.goto('/')
      await page.getByRole('link', { name: tab.label, exact: true }).click()
      await expect(page).toHaveURL(tab.href === '/' ? /\/?$/ : new RegExp(`${tab.href}/?$`))
      if ('title' in tab) {
        await expect(page.locator('.page-title')).toHaveText(tab.title)
      } else {
        await expect(page.locator(tab.selector)).toBeVisible()
      }
    })
  }
})
