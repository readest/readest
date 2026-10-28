import { expect, test } from '../fixtures/base';

/**
 * The scrolled-mode scrollbar: an 8px slot is always reserved, hiding only
 * paints the thumb transparent (never re-lays out the column), and the bar
 * comes back while the pointer is in the right-edge strip or briefly after a
 * scroll. Assertions read the *painted* thumb and the *computed* gutter, not
 * a flag — a flag-only check is what let an earlier revision of this code
 * pass while nothing reached the screen.
 */

test.setTimeout(240_000);

// Headless Chromium hides scrollbars by default (`--hide-scrollbars`), which
// reserves the gutter but paints nothing — the strip screenshots would be
// blank even when the behaviour is correct. Drop that flag so the bar is
// actually drawn and the screenshots mean something.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

type Probe = {
  hasShadowStyle: boolean;
  shadowCss: string;
  outerCss: string;
  revealVar: string;
  thumbIsTransparent: boolean;
  barWidthCss: string;
  sbWidthProp: string;
  sbColorProp: string;
  borderRight: string;
  rectWidth: number;
  overflowY: string;
  containerFound: boolean;
  clientWidth: number;
  offsetWidth: number;
  gutter: number;
  scrollbarGutterCss: string;
  scrollTop: number;
  flow: string | null;
  thumbBg: string;
  trackBg: string;
  containerRect: { left: number; right: number; top: number; height: number } | null;
};

const probe = (page: import('@playwright/test').Page): Promise<Probe> =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer?: HTMLElement;
    };
    const renderer = view?.renderer as HTMLElement | undefined;
    const shadow = renderer?.shadowRoot ?? null;
    const styleEl = shadow?.querySelector('#scrollbar-persist-style') as HTMLStyleElement | null;
    const outer = document.getElementById('scrollbar-hide-style') as HTMLStyleElement | null;
    const container = shadow?.querySelector('[part="container"]') as HTMLElement | null;

    const cs = container ? getComputedStyle(container) : null;
    const thumb = container ? getComputedStyle(container, '::-webkit-scrollbar-thumb') : null;
    const track = container ? getComputedStyle(container, '::-webkit-scrollbar-track') : null;
    const bar = container ? getComputedStyle(container, '::-webkit-scrollbar') : null;
    const cr = container?.getBoundingClientRect();

    return {
      hasShadowStyle: !!styleEl,
      shadowCss: styleEl?.textContent?.trim() ?? '',
      outerCss: outer?.textContent?.trim() ?? '',
      revealVar: container?.style.getPropertyValue('--scrollbar-reveal-thumb') ?? '',
      thumbIsTransparent:
        !thumb ||
        thumb.backgroundColor === 'rgba(0, 0, 0, 0)' ||
        thumb.backgroundColor === 'transparent',
      barWidthCss: bar?.width ?? '(n/a)',
      sbWidthProp: cs?.getPropertyValue('scrollbar-width') ?? '(n/a)',
      sbColorProp: cs?.getPropertyValue('scrollbar-color') ?? '(n/a)',
      borderRight: cs?.borderRightWidth ?? '(n/a)',
      rectWidth: cr?.width ?? -1,
      overflowY: cs?.overflowY ?? '(n/a)',
      containerFound: !!container,
      clientWidth: container?.clientWidth ?? -1,
      offsetWidth: container?.offsetWidth ?? -1,
      gutter:
        container && container.offsetWidth ? container.offsetWidth - container.clientWidth : -1,
      scrollbarGutterCss: cs?.scrollbarGutter ?? '(n/a)',
      scrollTop: container?.scrollTop ?? -1,
      flow: renderer?.getAttribute('flow') ?? null,
      thumbBg: thumb?.backgroundColor ?? '(n/a)',
      trackBg: track?.backgroundColor ?? '(n/a)',
      containerRect: cr ? { left: cr.left, right: cr.right, top: cr.top, height: cr.height } : null,
    };
  });

const viewerBox = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const view = document.querySelector('foliate-view') as HTMLElement & {
      renderer?: HTMLElement;
    };
    const r = view?.renderer?.getBoundingClientRect();
    return r
      ? { left: r.left, right: r.right, top: r.top, width: r.width, height: r.height }
      : null;
  });

test('scrolled + hide scrollbar: right-edge reveal, no reflow', async ({
  openBook,
  page,
}, testInfo) => {
  // Screenshots land in Playwright's output dir, never in the repo.
  const shot = (name: string) => testInfo.outputPath(name);
  const reader = await openBook();

  // --- turn on scrolled mode, then hide the scrollbar -----------------------
  await reader.openSettings();
  await page.locator('[data-tab="Control"]').click();

  const scrollBox = page.locator('[data-setting-id="settings.control.scrolledMode"]');
  const scrolledSwitch = scrollBox.getByRole('checkbox').first();
  await scrolledSwitch.waitFor({ state: 'visible' });
  await scrolledSwitch.setChecked(true);

  const hideSwitch = page
    .locator('[data-setting-id="settings.control.scroll.hideScrollbar"]')
    .getByRole('checkbox')
    .first();
  // Disabled until the scrolled setting has been persisted.
  await expect(hideSwitch).toBeEnabled();
  await hideSwitch.setChecked(true);

  await page.keyboard.press('Escape');
  await reader.hideChrome();

  // Let the renderer swap to `flow=scrolled` and lay the section out.
  await expect.poll(async () => (await probe(page)).flow, { timeout: 30_000 }).toBe('scrolled');
  await page.waitForTimeout(1200);

  const hidden = await probe(page);

  // Structural expectations: the shadow sheet exists and reserves the slot.
  expect(hidden.hasShadowStyle).toBe(true);
  expect(hidden.shadowCss).toContain('::-webkit-scrollbar');
  expect(hidden.shadowCss).toContain('width: 8px');
  expect(hidden.shadowCss).toContain('scrollbar-gutter: stable');
  // Hidden thumb is transparent, and the track too (no tinted strip giveaway).
  expect(hidden.shadowCss).toContain('transparent');
  expect(hidden.revealVar).toBe('');
  expect(hidden.thumbIsTransparent).toBe(true);
  // 8px slot is genuinely taken from the content box.
  expect(hidden.gutter).toBeGreaterThanOrEqual(7);

  const box = await viewerBox(page);
  expect(box).not.toBeNull();
  const b = box!;

  // Clip the bar's own column plus some book text beside it: a reflow would
  // show up here as the glyphs moving sideways.
  const cr = hidden.containerRect;
  expect(cr).not.toBeNull();
  const strip = {
    x: Math.max(0, cr!.right - 40),
    y: Math.max(0, cr!.top),
    width: 40,
    height: Math.min(600, cr!.height),
  };
  await page.screenshot({ path: shot('01-hidden.png') });
  await page.screenshot({ path: shot('01-hidden-strip.png'), clip: strip });

  // --- pointer in the middle of the page: still hidden ----------------------
  await page.mouse.move(b.left + b.width / 2, b.top + Math.min(300, b.height / 2));
  await page.waitForTimeout(300);
  expect((await probe(page)).revealVar).toBe('');

  // --- pointer into the right-edge hot zone: revealed ----------------------
  await page.mouse.move(b.right - 3, b.top + Math.min(300, b.height / 2));
  await expect.poll(async () => (await probe(page)).revealVar).not.toBe('');
  const revealed = await probe(page);
  // Painted, not merely flagged: the switch has to reach the pseudo-element.
  expect(revealed.thumbIsTransparent).toBe(false);
  await page.screenshot({ path: shot('02-revealed.png') });
  await page.screenshot({ path: shot('02-revealed-strip.png'), clip: strip });

  // The whole point: revealing must not re-lay out the column.
  expect(revealed.clientWidth).toBe(hidden.clientWidth);
  expect(revealed.gutter).toBe(hidden.gutter);

  // --- pointer leaves the strip: hidden again ------------------------------
  await page.mouse.move(b.left + b.width / 2, b.top + Math.min(300, b.height / 2));
  await expect.poll(async () => (await probe(page)).revealVar).toBe('');

  // --- scrolling flashes the bar even with the pointer in the middle -------
  await page.mouse.move(b.left + b.width / 2, b.top + Math.min(300, b.height / 2));
  const before = (await probe(page)).scrollTop;
  await page.mouse.wheel(0, 600);
  await expect.poll(async () => (await probe(page)).revealVar).not.toBe('');
  await page.waitForTimeout(200);
  await page.screenshot({ path: shot('03-scrolling-strip.png'), clip: strip });

  const afterScroll = await probe(page);
  expect(afterScroll.scrollTop).toBeGreaterThan(before);

  // Flash expires on its own (~900ms) with the pointer parked mid-page.
  await expect.poll(async () => (await probe(page)).revealVar, { timeout: 8_000 }).toBe('');

  // --- back to a normal bar (hideScrollbar off) ----------------------------
  await reader.openSettings();
  await page.locator('[data-tab="Control"]').click();
  const hideSwitch2 = page
    .locator('[data-setting-id="settings.control.scroll.hideScrollbar"]')
    .getByRole('checkbox')
    .first();
  await hideSwitch2.waitFor({ state: 'visible' });
  await hideSwitch2.setChecked(false);
  await page.keyboard.press('Escape');
  await reader.hideChrome();
  await page.waitForTimeout(600);

  const shown = await probe(page);
  expect(shown.revealVar).toBe('');
  expect(shown.thumbIsTransparent).toBe(false);
  expect(shown.shadowCss).not.toContain('--scrollbar-reveal-thumb');
  await page.screenshot({ path: shot('04-always-visible-strip.png'), clip: strip });
});
