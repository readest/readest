import { existsSync } from 'node:fs';
import type { Frame, Page } from '@playwright/test';
import { expect, test } from '../fixtures/base';
import type { ReaderPage } from '../pages/ReaderPage';

// Repro for: tapping plain body text / note-reference markers in
// 红楼梦脂评汇校本还原批注位置 opened the table/image viewer. The book lays
// every chapter in one giant <table> (vertical-rl layout), so taps hit the
// table branch of detectMediaTarget, and the 「註」 markers are child images
// of noteref links. Taps land where a reader actually taps — near the center
// of the visible page — and the spec asserts the viewer never opens.
const HLM_EPUB = process.env.READEST_HLM_EPUB;
test.skip(!HLM_EPUB || !existsSync(HLM_EPUB), 'set READEST_HLM_EPUB to the 脂评汇校本 EPUB');
test.slow();

type FrameInfo = { frame: Frame; report: unknown };

const probeTableFrames = async (page: Page): Promise<FrameInfo[]> => {
  const results: FrameInfo[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const report = await frame
      .evaluate(() => {
        const table = document.querySelector('table');
        if (!table) return null;
        const rect = table.getBoundingClientRect();
        const style = document.documentElement.style;
        const bodyMode = getComputedStyle(document.body).writingMode;
        const rootMode = getComputedStyle(document.documentElement).writingMode;
        return {
          writingMode: `${rootMode}/${bodyMode}`,
          innerWidth,
          innerHeight,
          tableWidth: Math.round(rect.width),
          tableHeight: Math.round(rect.height),
          docWidth: document.documentElement.clientWidth,
          docHeight: document.documentElement.clientHeight,
          availWidth: style.getPropertyValue('--available-width').trim(),
          availHeight: style.getPropertyValue('--available-height').trim(),
          tdParagraphs: document.querySelectorAll('td p').length,
          noteGlyphs: document.querySelectorAll('a img.zstb').length,
        };
      })
      .catch(() => null);
    if (report) results.push({ frame, report });
  }
  return results;
};

const openChapterWithTable = async (reader: ReaderPage): Promise<FrameInfo[]> => {
  await reader.openTocChapter(3);
  let frames: FrameInfo[] = [];
  await expect
    .poll(
      async () => {
        frames = await probeTableFrames(reader.page);
        return frames.length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  return frames;
};

/** What sits under the main-viewport point, answered from the book's frame. */
const describePoint = async (page: Page, x: number, y: number): Promise<string> => {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const frameElement = await frame.frameElement().catch(() => null);
    const box = await frameElement
      ?.asElement()
      ?.boundingBox()
      .catch(() => null);
    if (!box) continue;
    if (x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height) continue;
    const chain = await frame
      .evaluate(
        ([px, py]) =>
          document
            .elementsFromPoint(px, py)
            .slice(0, 5)
            .map(
              (el) =>
                `${el.tagName}${el.className ? `.${String(el.className).split(' ').join('.')}` : ''}`,
            ),
        [x - box.x, y - box.y] as [number, number],
      )
      .catch(() => null);
    return chain ? chain.join(' > ') : 'evaluate failed';
  }
  return 'no frame at point';
};

const tapPagePoint = async (reader: ReaderPage, fx: number, fy: number, label: string) => {
  const viewerBox = await reader.viewer.boundingBox();
  expect(viewerBox, 'viewer visible').not.toBeNull();
  const x = viewerBox!.x + viewerBox!.width * fx;
  const y = viewerBox!.y + viewerBox!.height * fy;
  const under = await describePoint(reader.page, x, y);
  console.log(`TAP ${label} (${Math.round(x)}, ${Math.round(y)}) under: ${under}`);
  await reader.page.mouse.click(x, y);
  await reader.page.waitForTimeout(1000);
  const overlays = await reader.page
    .locator('.table-viewer-overlay, .image-viewer-overlay')
    .count();
  console.log(`VIEWERS after ${label}: ${overlays}`);
  expect(overlays, `${label} must not open the image/table viewer`).toBe(0);
};

const enableScrolledMode = async (reader: ReaderPage) => {
  await reader.revealHeader();
  await reader.headerBar.locator('button[aria-label="View Options"]').click();
  await reader.page.locator('.view-menu').getByText('Scrolled Mode', { exact: true }).click();
  await reader.page.keyboard.press('Escape');
  await reader.page.waitForTimeout(1500);
};

test.describe('脂评汇校本 layout table never opens the viewer on text taps', () => {
  test('paginated: taps across the page', async ({ openBook }) => {
    const reader = await openBook(HLM_EPUB!);
    const frames = await openChapterWithTable(reader);
    console.log('GEOMETRY paginated:', JSON.stringify(frames.map((f) => f.report)));

    await tapPagePoint(reader, 0.5, 0.4, 'center-upper');
    await tapPagePoint(reader, 0.5, 0.6, 'center-lower');
    await tapPagePoint(reader, 0.35, 0.5, 'left-of-center');
    await tapPagePoint(reader, 0.65, 0.5, 'right-of-center');
  });

  test('scrolled: taps across the page', async ({ openBook }) => {
    const reader = await openBook(HLM_EPUB!);
    await reader.openTocChapter(3);
    await enableScrolledMode(reader);

    const frames = await openChapterWithTable(reader);
    console.log('GEOMETRY scrolled:', JSON.stringify(frames.map((f) => f.report)));

    await tapPagePoint(reader, 0.5, 0.4, 'center-upper');
    await tapPagePoint(reader, 0.5, 0.6, 'center-lower');
  });

  // No separate single-section (noContinuousScroll) lane: that setting only
  // changes how sections advance, not the in-iframe click detection under
  // test here — the scrolled lane above exercises the same code path.
});
