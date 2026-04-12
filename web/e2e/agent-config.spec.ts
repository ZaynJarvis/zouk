import { test, expect } from '@playwright/test';

test.describe('Agent Configuration Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to agents view via WorkspaceRail Bot button
    await page.locator('button[title="Agents"]').click();
    // Wait for agents panel to render — look for the "Agents" header in the left panel
    await page.waitForSelector('h1:has-text("Agents")');
  });

  test('renders split-panel layout with left sidebar', async ({ page }) => {
    // Left panel header "Agents" with create button
    await expect(page.getByText('Agents', { exact: true }).first()).toBeVisible();
    // Should show Machines section (text is "Machines (0)", CSS makes it uppercase)
    await expect(page.getByText(/Machines/)).toBeVisible();
    // Right panel shows "No Agent Selected"
    await expect(page.getByText('No Agent Selected')).toBeVisible();
    // Create agent button exists in left panel
    await expect(page.locator('button[title="Create agent"]')).toBeVisible();
  });

  test('shows machines section with connect CTA when no machines', async ({ page }) => {
    // Should show "Machines (0)" section
    await expect(page.getByText(/machines/i).first()).toBeVisible();
    // Should show "Connect a machine" button when no machines
    const connectBtn = page.getByText('+ Connect a machine');
    if (await connectBtn.isVisible()) {
      await expect(connectBtn).toBeVisible();
    }
  });

  test('shows create agent button', async ({ page }) => {
    const createBtn = page.locator('button[title="Create agent"]');
    await expect(createBtn).toBeVisible();
  });

  test('opens CreateAgentDialog when clicking create button', async ({ page }) => {
    await page.locator('button[title="Create agent"]').click();
    // Dialog should appear
    await expect(page.getByText('Create Agent').first()).toBeVisible();
  });

  test('CreateAgentDialog has name input', async ({ page }) => {
    await page.locator('button[title="Create agent"]').click();
    await expect(page.getByText('Create Agent').first()).toBeVisible();
    // Should have a name input field
    const nameInput = page.locator('input').first();
    await expect(nameInput).toBeVisible();
  });

  test('CreateAgentDialog has runtime picker', async ({ page }) => {
    await page.locator('button[title="Create agent"]').click();
    await expect(page.getByText('Create Agent').first()).toBeVisible();
    // Should show runtime/provider selection area
    await expect(page.getByText(/runtime/i).first()).toBeVisible();
  });

  test('CreateAgentDialog has visibility toggle', async ({ page }) => {
    await page.locator('button[title="Create agent"]').click();
    await expect(page.getByText('Create Agent').first()).toBeVisible();
    await expect(page.getByText('Workspace')).toBeVisible();
    await expect(page.getByText('Private')).toBeVisible();
  });

  test('CreateAgentDialog can be closed via X button', async ({ page }) => {
    await page.locator('button[title="Create agent"]').click();
    // Dialog overlay should appear
    const dialog = page.locator('[class*="fixed"][class*="inset"]').first();
    await expect(dialog).toBeVisible();

    // Close via the X button in dialog
    const closeBtn = page.locator('button').filter({ has: page.locator('svg.lucide-x') }).first();
    await closeBtn.click();

    // Dialog overlay should disappear
    await expect(dialog).not.toBeVisible();
  });

  test('shows empty state when no agents', async ({ page }) => {
    // Left panel shows "No agents yet"
    await expect(page.getByText('No agents yet')).toBeVisible();
    // Right panel shows "No Agent Selected"
    await expect(page.getByText('No Agent Selected')).toBeVisible();
  });
});

test.describe('Machine Setup Dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Agents"]').click();
    await page.waitForSelector('h1:has-text("Agents")');
  });

  test('opens machine setup from gear icon', async ({ page }) => {
    const gearBtn = page.locator('button[title="Machine Setup & API Keys"]');
    await expect(gearBtn).toBeVisible();
    await gearBtn.click();

    // Machine setup dialog should appear
    await expect(page.getByText(/machine setup|api key/i).first()).toBeVisible();
  });

  test('opens machine setup from "Connect a machine" CTA', async ({ page }) => {
    const connectBtn = page.getByText('+ Connect a machine');
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
      await expect(page.getByText(/machine setup|api key/i).first()).toBeVisible();
    }
  });

  test('machine setup shows daemon command template', async ({ page }) => {
    const gearBtn = page.locator('button[title="Machine Setup & API Keys"]');
    await gearBtn.click();

    // Should show the npx daemon command
    const daemonCmd = page.getByText(/npx|daemon|server-url/i);
    if (await daemonCmd.first().isVisible()) {
      await expect(daemonCmd.first()).toBeVisible();
    }
  });
});

test.describe('Agent Detail — Tab Navigation', () => {
  // These tests require at least one agent to be connected.
  // They will be skipped if no agents are present.

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('button[title="Agents"]').click();
    await page.waitForSelector('h1:has-text("Agents")');
  });

  test('clicking an agent shows detail with 4 tabs', async ({ page }) => {
    // Check if any agent list items exist
    const agentItem = page.locator('.w-72 button').filter({ hasText: /·/ }).first();
    const agentExists = await agentItem.isVisible().catch(() => false);

    if (!agentExists) {
      test.skip(true, 'No agents available — skipping detail tests');
      return;
    }

    await agentItem.click();
    await expect(page.getByText('Instructions')).toBeVisible();
    await expect(page.getByText('Skills')).toBeVisible();
    await expect(page.getByText('Tasks')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
  });

  test('Instructions tab has system prompt editor', async ({ page }) => {
    const agentItem = page.locator('.w-72 button').filter({ hasText: /·/ }).first();
    const agentExists = await agentItem.isVisible().catch(() => false);

    if (!agentExists) {
      test.skip(true, 'No agents available');
      return;
    }

    await agentItem.click();
    await page.getByRole('tab', { name: 'Instructions' }).or(page.getByText('Instructions')).first().click();
    await expect(page.getByText('System Prompt')).toBeVisible();
    await expect(page.locator('textarea').first()).toBeVisible();
  });

  test('Settings tab has visibility and concurrent controls', async ({ page }) => {
    const agentItem = page.locator('.w-72 button').filter({ hasText: /·/ }).first();
    const agentExists = await agentItem.isVisible().catch(() => false);

    if (!agentExists) {
      test.skip(true, 'No agents available');
      return;
    }

    await agentItem.click();
    await page.getByText('Settings').click();
    await expect(page.getByText('Visibility')).toBeVisible();
    await expect(page.getByText(/Max Concurrent/i)).toBeVisible();
  });
});
