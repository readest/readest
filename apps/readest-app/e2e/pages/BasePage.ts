import type { Page } from '@playwright/test';

/**
 * Shared base for page objects.
 *
 * Page objects expose actions and queries (locators) only — assertions live
 * in the specs, so a failing assertion points at test intent rather than at a
 * helper.
 */
export abstract class BasePage {
  constructor(protected readonly page: Page) {}
}
