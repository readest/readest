import { existsSync } from 'node:fs';
import { expect, test } from '../fixtures/base';
import type { ReaderPage } from '../pages/ReaderPage';

// Repro for: chapter ornaments lose their white plate inside the image viewer.
//
// 哈利·波特与死亡圣器 draws each chapter ornament as a transparent PNG whose ink
// is black. In night mode the book's own CSS props it up —
// `body.theme-dark .calibre4 { box-shadow: inset 0 0 0 999px #fff }` — so the
// page shows black line art on a white plate. The viewer only had the bare
// bitmap, where the transparent area let its dimmed backdrop through: the art
// went black-on-black. It now reproduces the page's filter and plate.
const HP7_EPUB = process.env.READEST_HP7_EPUB;
test.skip(!HP7_EPUB || !existsSync(HP7_EPUB), 'set READEST_HP7_EPUB to the HP7 bilingual EPUB');
test.slow();

const SHOT_DIR = process.env.READEST_SHOT_DIR ?? '.';

/** Cycle the reader's theme until it is Dark Mode (the menu item names the current one). */
const setDarkMode = async (reader: ReaderPage) => {
  // The menu closes on each pick, so every round re-opens it.
  for (let i = 0; i < 6; i += 1) {
    await reader.revealHeader();
    await reader.headerBar.locator('button[aria-label="View Options"]').click();
    const themeItem = reader.page
      .locator('.view-menu')
      .getByText(/^(Light|Dark|Auto|Ambient) Mode$/)
      .first();
    await themeItem.waitFor({ state: 'visible' });
    const label = (await themeItem.textContent())?.trim();
    console.log(`THEME: ${label}`);
    if (label === 'Dark Mode') {
      await reader.page.keyboard.press('Escape');
      await reader.page.waitForTimeout(500);
      return;
    }
    await themeItem.click();
    await reader.page.waitForTimeout(600);
  }
  throw new Error('could not cycle the reader into Dark Mode');
};

/** The chapter ornament's own box, in page coordinates. */
const ornamentBox = async (reader: ReaderPage, selector = 'p.chapimg img') => {
  for (const frame of reader.page.frames()) {
    if (frame === reader.page.mainFrame()) continue;
    const handle = await frame.$(selector).catch(() => null);
    const box = await handle?.boundingBox().catch(() => null);
    if (box && box.width > 20 && box.height > 20) return box;
  }
  return null;
};

/** Jump to chapter one; the ornament's box is measured from the page, so no chrome juggling. */
const openFirstChapter = async (reader: ReaderPage) => {
  await reader.openSidebar();
  await reader.sidebar.locator('[aria-label="TOC"]').click();
  await reader.tocItems.filter({ hasText: 'The Dark Lord Ascending' }).first().click();
  // The click hides the header on its own; a pinned sidebar keeps it up, which
  // is fine — the ornament sits well below the bar.
  await reader.page.waitForTimeout(2000);
};

/** Night mode + chapter one, ready to be clicked. */
const openChapterInDarkMode = async (reader: ReaderPage) => {
  await setDarkMode(reader);
  // The section iframe stamps `theme-light`/`theme-dark` on its body when it
  // loads, from the theme at that moment, so a section loaded before the switch
  // keeps the old class. Reload puts the theme in place before any section.
  await reader.page.reload();
  await reader.waitForReady();
  await reader.page.waitForTimeout(1000);
  await openFirstChapter(reader);
};

test('night-mode chapter ornament keeps its page rendering in the viewer', async ({
  openBook,
  page,
}) => {
  const reader = await openBook(HP7_EPUB!);
  await openChapterInDarkMode(reader);

  await expect.poll(() => ornamentBox(reader), { timeout: 20_000 }).not.toBeNull();
  const box = (await ornamentBox(reader))!;
  console.log('ORNAMENT', JSON.stringify(box));

  // What the page itself computes for the ornament — the reference the viewer
  // has to match.
  const pageStyle = await (async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const style = await frame
        .evaluate(() => {
          const img = document.querySelector('p.chapimg img') as HTMLImageElement | null;
          if (!img) return null;
          const cs = getComputedStyle(img);
          return {
            filter: cs.filter,
            background: cs.backgroundColor,
            shadow: cs.boxShadow,
            bodyClass: document.body.className,
          };
        })
        .catch(() => null);
      if (style) return style;
    }
    return null;
  })();
  console.log('PAGE STYLE', JSON.stringify(pageStyle));
  // The book's night mode hangs off `body.theme-dark`; without it the page
  // would not be the reference we are matching.
  expect(pageStyle?.bodyClass).toContain('theme-dark');
  expect(pageStyle?.shadow).toContain('inset');

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const overlay = page.locator('.image-viewer-overlay');
  await overlay.waitFor({ state: 'visible' });

  const viewerImage = page.locator('.no-context-menu img').first();
  await viewerImage.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);

  const viewerStyle = await viewerImage.evaluate((img) => {
    const cs = getComputedStyle(img);
    return { filter: cs.filter, background: cs.backgroundColor, rect: img.getBoundingClientRect() };
  });
  console.log('VIEWER STYLE', JSON.stringify({ ...viewerStyle, rect: undefined }));
  expect(viewerStyle.background).toBe('rgb(255, 255, 255)');

  // The plate must show next to the ink: sample the rendered overlay.
  const box2 = viewerStyle.rect;
  await page.screenshot({
    path: `${SHOT_DIR}/hp7-viewer-plate.png`,
    clip: {
      x: Math.max(0, box2.x - 40),
      y: Math.max(0, box2.y - 40),
      width: Math.min(box2.width + 80, 900),
      height: Math.min(box2.height + 80, 700),
    },
  });

  // Re-opening must give the same plate: the report was "the first image is
  // fine, the next one is grey", so a second open is part of the acceptance.
  // Clicking beside the picture (clear of the arrows and the zoom controls) is
  // what dismisses the viewer.
  await page.mouse.click(box2.x + box2.width + 80, box2.y + box2.height / 2);
  await expect(overlay).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await overlay.waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  const secondOpen = await page
    .locator('.no-context-menu img')
    .first()
    .evaluate((img) => getComputedStyle(img).backgroundColor);
  console.log('SECOND OPEN', secondOpen);
  expect(secondOpen).toBe('rgb(255, 255, 255)');
});

// The other half of "the same rendering": the chapter's star flourishes are
// inverted by the book in night mode (`.decoimg { filter: invert(100%) }`), so
// the viewer has to carry the filter, not just the plate.
test('night-mode inverted flourish keeps its filter in the viewer', async ({ openBook, page }) => {
  const reader = await openBook(HP7_EPUB!);
  await openChapterInDarkMode(reader);

  const box = await ornamentBox(reader, 'div.imgleft img.decoimg');
  expect(box, 'flourish on the page').not.toBeNull();

  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.locator('.image-viewer-overlay').waitFor({ state: 'visible' });

  const viewerImage = page.locator('.no-context-menu img').first();
  await viewerImage.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const filter = await viewerImage.evaluate((img) => getComputedStyle(img).filter);
  console.log('FLOURISH FILTER', filter);
  expect(filter).toContain('invert');
});

// The regression the first fix missed. A section iframe stamps its body with
// the theme it loaded under, and `useFoliateEvents` binds the load handler once
// (`[view]`, so the closed-over `isDarkMode` was the theme at mount). A section
// loaded after a live theme switch therefore kept the *old* class: the book's
// `body.theme-dark` plate never applied, the page handed the viewer nothing to
// copy, and the viewer fell back to the app's theme background — the "first
// image is white, the next one is grey" report.
test('a section loaded after a live theme switch gets the live theme', async ({
  openBook,
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const reader = await openBook(HP7_EPUB!);
  // Deliberately no reload: the theme switch has to reach a section loaded after it.
  await setDarkMode(reader);
  await openFirstChapter(reader);

  const box = await ornamentBox(reader);
  expect(box, 'ornament on the page').not.toBeNull();

  const pageShadow = await (async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const info = await frame
        .evaluate(() => {
          const img = document.querySelector('p.chapimg img') as HTMLImageElement | null;
          if (!img) return null;
          return {
            bodyClass: document.body.className,
            shadow: getComputedStyle(img).boxShadow,
          };
        })
        .catch(() => null);
      if (info) return info;
    }
    return null;
  })();
  console.log('LIVE-THEME PAGE', JSON.stringify(pageShadow));
  // The page must get the book's night rules too, not just the viewer: the
  // ornament would be invisible on the page itself otherwise.
  expect(pageShadow?.bodyClass).toContain('theme-dark');
  expect(pageShadow?.shadow).toContain('inset');

  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.locator('.image-viewer-overlay').waitFor({ state: 'visible' });
  const viewerImage = page.locator('.no-context-menu img').first();
  await viewerImage.waitFor({ state: 'visible' });
  await expect
    .poll(() => viewerImage.evaluate((img) => getComputedStyle(img).backgroundColor), {
      timeout: 10_000,
    })
    .toBe('rgb(255, 255, 255)');
});

// The state the reader reported after the first two fixes: the book is opened
// while the app is already dark, so `transformStylesheet` rewrites the book's
// own `.calibre4 { background-color: #fff }` (inside its dark-mode block) into
// the theme colour — `#1e1e1e`. The page still looks right because the white
// inset shadow paints over that fill, but the viewer copied the fill and put
// black ink on a near-black plate.
test('paints a light plate even when the page fill was rewritten to the theme colour', async ({
  openBook,
  page,
}) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('themeMode', 'dark');
    } catch {
      // ignore
    }
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  const reader = await openBook(HP7_EPUB!);
  await openFirstChapter(reader);

  const box = await ornamentBox(reader);
  expect(box, 'ornament on the page').not.toBeNull();

  const pageInfo = await (async () => {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const info = await frame
        .evaluate(() => {
          const img = document.querySelector('p.chapimg img') as HTMLImageElement | null;
          if (!img) return null;
          const cs = getComputedStyle(img);
          return {
            bodyClass: document.body.className,
            bg: cs.backgroundColor,
            shadow: cs.boxShadow,
          };
        })
        .catch(() => null);
      if (info) return info;
    }
    return null;
  })();
  console.log('REWRITTEN PAGE', JSON.stringify(pageInfo));

  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.locator('.image-viewer-overlay').waitFor({ state: 'visible' });
  const viewerImage = page.locator('.no-context-menu img').first();
  await viewerImage.waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  const plate = await viewerImage.evaluate((img) => getComputedStyle(img).backgroundColor);
  console.log('REWRITTEN VIEWER PLATE', plate);
  expect(plate).toBe('rgb(255, 255, 255)');
});
