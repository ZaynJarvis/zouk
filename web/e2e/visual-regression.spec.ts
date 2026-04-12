import { test, expect } from '@playwright/test';

test.describe('Visual Regression — Agent Config Pages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Agents"]').click();
    await page.waitForSelector('h1:has-text("Agents")');
  });

  test('agent panel — default state', async ({ page }) => {
    await expect(page).toHaveScreenshot('agent-panel-default.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('create agent dialog — empty form', async ({ page }) => {
    await page.locator('button[title="Create agent"]').click();
    await expect(page.getByText('Create Agent').first()).toBeVisible();

    await expect(page).toHaveScreenshot('create-agent-dialog.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('machine setup dialog', async ({ page }) => {
    await page.locator('button[title="Machine Setup & API Keys"]').click();
    await page.waitForTimeout(500); // let dialog animate in

    await expect(page).toHaveScreenshot('machine-setup-dialog.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression — Dark Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await page.locator('button[title="Agents"]').click();
    await page.waitForSelector('h1:has-text("Agents")');
  });

  test('agent panel — dark mode', async ({ page }) => {
    await expect(page).toHaveScreenshot('agent-panel-dark.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
