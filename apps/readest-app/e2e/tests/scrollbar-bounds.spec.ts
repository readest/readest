import { expect, test } from '../fixtures/base';

/**
 * The reading column's scrollbar is drawn at the column's own edge, and the
 * header/footer bars float on top of that edge: with the thumb parked at a
 * section start (or end) and a bar slid in, the bar painted over the thumb.
 * The bar's travel is now bounded -- the thumb stops short of both ends -- so
 * the contract this spec locks down is geometric:
 *
 *   container.top    + reserved top    >= header.bottom
 *   container.bottom - reserved bottom <= footer.top
 *
 * i.e. no part of the bar the thumb can reach is ever underneath the chrome.
 */

test.setTimeout(240_000);

type Bounds = {
  sheetHasButtons: boolean;
  insetTop: string;
  insetBottom: string;
  containerTop: number;
  containerBottom: number;
  headerBottom: number;
  footerTop: number;
};

const bounds = (page: import('@playwright/test').Page): Promise<Bounds> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer?: HTMLElement;
    };
    const shadow = view?.renderer?.shadowRoot;
    const container = shadow?.querySelector('[part="container"]') as HTMLElement | null;
    const sheet = shadow?.querySelector('#scrollbar-persist-style') as HTMLStyleElement | null;
    const header = document.querySelector('.header-bar') as HTMLElement | null;
    const footer = document.querySelector('.footer-bar') as HTMLElement | null;
    const cr = container?.getBoundingClientRect();
    const hr = header?.getBoundingClientRect();
    const fr = footer?.getBoundingClientRect();
    return {
      sheetHasButtons: !!sheet?.textContent?.includes('::-webkit-scrollbar-button'),
      insetTop: container?.style.getPropertyValue('--scrollbar-inset-top') ?? '',
      insetBottom: container?.style.getPropertyValue('--scrollbar-inset-bottom') ?? '',
      containerTop: Math.round(cr?.top ?? -1),
      containerBottom: Math.round(cr?.bottom ?? -1),
      headerBottom: Math.round(hr?.bottom ?? -1),
      footerTop: Math.round(fr?.top ?? -1),
    };
  });

const expectClearOfChrome = (b: Bounds) => {
  const top = Number.parseFloat(b.insetTop) || 0;
  const bottom = Number.parseFloat(b.insetBottom) || 0;
  expect(b.sheetHasButtons).toBe(true);
  expect(b.insetTop).toMatch(/^\d+px$/);
  expect(b.insetBottom).toMatch(/^\d+px$/);
  // The thumb's topmost resting place is still below the header bar...
  expect(b.containerTop + top).toBeGreaterThanOrEqual(b.headerBottom);
  // ...and its bottommost one still above the footer bar.
  expect(b.containerBottom - bottom).toBeLessThanOrEqual(b.footerTop);
};

test('the bar stops short of the header and footer bars', async ({ openBook, page }) => {
  const reader = await openBook();

  // Scrolled mode, bar always painted: the geometry under test is the bar's,
  // not the reveal choreography's.
  await reader.openSettings();
  await page.locator('[data-tab="Control"]').click();
  const scrolledSwitch = page
    .locator('[data-setting-id="settings.control.scrolledMode"]')
    .getByRole('checkbox')
    .first();
  await scrolledSwitch.waitFor({ state: 'visible' });
  await scrolledSwitch.setChecked(true);
  const hideSwitch = page
    .locator('[data-setting-id="settings.control.scroll.hideScrollbar"]')
    .getByRole('checkbox')
    .first();
  await expect(hideSwitch).toBeEnabled();
  await hideSwitch.setChecked(false);
  await page.keyboard.press('Escape');
  await reader.hideChrome();

  // 1. Running header on: the column already starts below the header bar, so
  //    only the daylight gap is reserved at the top -- the whole footer depth
  //    at the bottom, which the column runs underneath.
  await reader.setPageHeaderVisible(true);
  await page.waitForTimeout(800);
  const withHeader = await bounds(page);
  expectClearOfChrome(withHeader);
  expect(withHeader.containerTop).toBeGreaterThanOrEqual(withHeader.headerBottom);
  expect(withHeader.insetTop).toBe('4px');
  expect(withHeader.insetBottom).toBe('56px');

  // 2. Compact margins: the column now reaches the very top edge, so the
  //    header's own depth has to be reserved on top of the gap.
  await reader.setPageHeaderVisible(false);
  await page.waitForTimeout(800);
  const compact = await bounds(page);
  expectClearOfChrome(compact);
  expect(compact.containerTop).toBeLessThan(compact.headerBottom);
  expect(compact.insetTop).toBe('48px');
  expect(compact.insetBottom).toBe('56px');
});
