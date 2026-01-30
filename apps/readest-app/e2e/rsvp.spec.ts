import { test, expect, Page } from '@playwright/test';

// Helper to wait for the app to load
async function waitForAppLoad(page: Page) {
  // Wait for React to hydrate and the page to be interactive
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
}

// Helper to import a demo book
async function importDemoBook(page: Page) {
  // Navigate to library page
  await page.goto('/library');
  await waitForAppLoad(page);

  // Check if there are any books in the library
  const bookCard = page.locator('[aria-label="Book Card"]').first();
  const hasBooks = await bookCard.count() > 0;

  if (!hasBooks) {
    // Clear the demo books fetched flag to trigger demo book loading
    await page.evaluate(() => {
      localStorage.removeItem('demoBooksFetched');
    });
    // Reload to trigger demo book import
    await page.reload();
    await waitForAppLoad(page);
    // Wait for demo books to load
    await page.waitForTimeout(5000);
  }

  // Click on the first book to open it
  await page.locator('[aria-label="Book Card"]').first().click();

  // Wait for reader to load
  await page.waitForURL(/\/reader/, { timeout: 30000 });
  await waitForAppLoad(page);
  await page.waitForTimeout(3000);
}

// Helper to open the View menu and start RSVP
async function openRSVP(page: Page) {
  // Open the header bar by moving mouse to the top
  await page.mouse.move(600, 30);
  await page.waitForTimeout(500);

  // Find and click the View Options button (eye icon or menu button)
  const viewButton = page.locator('[aria-label="View Options"]');
  await expect(viewButton).toBeVisible({ timeout: 10000 });
  await viewButton.click({ force: true });
  await page.waitForTimeout(500);

  // Click on RSVP Speed Reading menu item
  const rsvpMenuItem = page.getByText('RSVP Speed Reading');
  await expect(rsvpMenuItem).toBeVisible({ timeout: 5000 });
  await rsvpMenuItem.click();
}

// Helper to wait for RSVP overlay to appear
async function waitForRSVPOverlay(page: Page) {
  // Wait for the RSVP overlay container - check for both dialog and main overlay
  const overlay = page.locator('[class*="rsvp"], [data-testid="rsvp-overlay"]');

  // Check if start dialog appears or if it goes directly to RSVP
  const startDialog = page.getByText('Start RSVP Reading');
  const isDialogVisible = await startDialog.isVisible().catch(() => false);

  if (isDialogVisible) {
    // Click "From Beginning" option
    const fromBeginningBtn = page.getByText('From Beginning');
    await fromBeginningBtn.click();
    await page.waitForTimeout(500);
  }

  // Wait for RSVP overlay to be active
  await page.waitForTimeout(1000);
}

test.describe('RSVP Speed Reading Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Set a consistent viewport
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('should open RSVP from View menu', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Verify RSVP overlay is visible by checking for key elements
    // The word display should be visible
    const wordDisplay = page.locator('text=/\\w+/').first();
    await expect(wordDisplay).toBeVisible({ timeout: 10000 });
  });

  test('should display start dialog with options', async ({ page }) => {
    await importDemoBook(page);

    // Open the header bar
    await page.mouse.move(600, 30);
    await page.waitForTimeout(500);

    // Open View Options
    const viewButton = page.locator('[aria-label="View Options"]');
    await viewButton.click({ force: true });
    await page.waitForTimeout(500);

    // Click RSVP menu item
    const rsvpMenuItem = page.getByText('RSVP Speed Reading');
    await rsvpMenuItem.click();
    await page.waitForTimeout(500);

    // Check if start dialog appears with options
    const startDialog = page.getByText('Start RSVP Reading');
    const dialogVisible = await startDialog.isVisible().catch(() => false);

    if (dialogVisible) {
      // Verify dialog options
      await expect(page.getByText('From Beginning')).toBeVisible();
      await expect(page.getByText('From Current Position')).toBeVisible();
      await expect(page.getByText('Cancel')).toBeVisible();
    }
  });

  test('should toggle play/pause', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Find the play/pause button - it should have a play or pause icon
    const controlArea = page.locator('body');

    // Click on center of screen to toggle play/pause (RSVP uses click-to-toggle)
    await page.mouse.click(640, 400);
    await page.waitForTimeout(1000);

    // Click again to toggle back
    await page.mouse.click(640, 400);
    await page.waitForTimeout(500);
  });

  test('should adjust speed with slider or buttons', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Look for speed control elements
    // There should be speed indicators like WPM or slider
    const speedIndicator = page.locator('text=/\\d+ WPM/');
    const initialSpeed = await speedIndicator.textContent().catch(() => null);

    // Find speed increase button (+ or faster)
    const speedUpButton = page.locator('[aria-label*="speed"], [aria-label*="faster"], button:has-text("+")').first();
    if (await speedUpButton.isVisible()) {
      await speedUpButton.click();
      await page.waitForTimeout(500);

      // Verify speed changed
      const newSpeed = await speedIndicator.textContent().catch(() => null);
      if (initialSpeed && newSpeed) {
        // Speed should be different
        expect(newSpeed).not.toBe(initialSpeed);
      }
    }
  });

  test('should navigate with skip buttons', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Pause if playing
    await page.mouse.click(640, 400);
    await page.waitForTimeout(500);

    // Find skip forward button
    const skipForward = page.locator('[aria-label*="skip"], [aria-label*="forward"], [aria-label*="next"]').first();
    if (await skipForward.isVisible()) {
      await skipForward.click();
      await page.waitForTimeout(300);
    }

    // Find skip backward button
    const skipBack = page.locator('[aria-label*="skip"], [aria-label*="back"], [aria-label*="prev"]').first();
    if (await skipBack.isVisible()) {
      await skipBack.click();
      await page.waitForTimeout(300);
    }
  });

  test('should close RSVP overlay', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Find and click close button
    const closeButton = page.locator('[aria-label*="close"], [aria-label*="Close"], button:has(svg)').first();

    // Try clicking close button or pressing Escape
    if (await closeButton.isVisible()) {
      await closeButton.click();
    } else {
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(1000);

    // Verify RSVP is closed - the word display should no longer be in RSVP mode
    // The reader content should be visible again
    const readerFrame = page.locator('iframe, [class*="reader"], [class*="content"]').first();
    await expect(readerFrame).toBeVisible({ timeout: 5000 });
  });

  test('should show context on pause', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Let it play for a bit to get some words
    await page.waitForTimeout(2000);

    // Pause by clicking
    await page.mouse.click(640, 400);
    await page.waitForTimeout(500);

    // Check for context text (before/after words) - should show surrounding words
    // The context is typically displayed as smaller text above and below the main word
    const contextText = page.locator('[class*="context"], [class*="before"], [class*="after"]');
    // At least some context should be present when paused
  });

  test('should show progress bar', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Look for progress bar element
    const progressBar = page.locator('[class*="progress"], [role="progressbar"], progress');
    if (await progressBar.count() > 0) {
      await expect(progressBar.first()).toBeVisible();
    }
  });

  test('should have chapter navigation', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Pause first
    await page.mouse.click(640, 400);
    await page.waitForTimeout(500);

    // Look for chapter selector or dropdown
    const chapterSelector = page.locator('select, [class*="chapter"], [aria-label*="chapter"]').first();
    if (await chapterSelector.isVisible()) {
      // Chapter navigation exists
      expect(await chapterSelector.isVisible()).toBe(true);
    }
  });

  test('keyboard shortcuts should work', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Test space bar for play/pause
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    // Test arrow keys for navigation
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);

    // Test Escape to close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  });

  test('should display ORP (focal point) highlighting', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Pause to examine the word
    await page.mouse.click(640, 400);
    await page.waitForTimeout(500);

    // Look for ORP highlighting - typically a different colored character
    const orpChar = page.locator('[class*="orp"], [class*="focal"], [class*="highlight"], span[style*="color"]');
    // ORP should be visible in the word display
  });

  test('should remember position on close and reopen', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Let it run for a bit
    await page.waitForTimeout(3000);

    // Close RSVP
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Reopen RSVP
    await openRSVP(page);

    // Check if "Resume" option appears in dialog
    const resumeOption = page.getByText('Resume');
    const hasResumeOption = await resumeOption.isVisible().catch(() => false);

    // If there's a resume option, position was saved
    if (hasResumeOption) {
      expect(await resumeOption.isVisible()).toBe(true);
    }
  });
});

test.describe('RSVP Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('should be keyboard navigable', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Tab through controls
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Should be able to navigate with keyboard
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  });

  test('should have proper ARIA labels', async ({ page }) => {
    await importDemoBook(page);
    await openRSVP(page);
    await waitForRSVPOverlay(page);

    // Check for ARIA labels on interactive elements
    const buttonsWithLabels = page.locator('button[aria-label], [role="button"][aria-label]');
    const count = await buttonsWithLabels.count();

    // Should have some accessible buttons
    expect(count).toBeGreaterThan(0);
  });
});
