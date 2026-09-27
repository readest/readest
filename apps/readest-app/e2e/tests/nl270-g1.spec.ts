import { expect, test } from '../fixtures/base';
import { SAMPLE_PDF, SAMPLE_SYNCTEX, SAMPLE_TEX } from '../fixtures/books';

const FIRST_LEVEL_ACTIONS = ['提问', '作为附件', '查看源码'];
const UPSTREAM_ACTIONS = [
  'Copy',
  'Highlight',
  'Annotate',
  'Search',
  'Dictionary',
  'Translate',
  'Speak',
  'Proofread',
  'Share',
];

test.describe('NL-270 G1 acceptance gate', () => {
  test.use({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });

  test('G1-01 uses the unified shell around original PDF canvas and text layer', async ({
    openBook,
  }) => {
    const reader = await openBook([SAMPLE_PDF, SAMPLE_TEX, SAMPLE_SYNCTEX]);

    await expect.poll(() => reader.originalPdfCanvasCount()).toBeGreaterThan(0);
    await expect.poll(() => reader.pdfTextLayerCount()).toBeGreaterThan(0);
    await expect(reader.sidebar).toBeHidden();
    await expect(reader.notebook).toBeVisible();
    await expect(reader.page.getByRole('button', { name: '关闭 AI 侧栏' })).toBeVisible();
    await expect(reader.page.locator('[data-source-text]')).toHaveCount(0);
    await expect(reader.page.getByText('AI 学术阅读器')).toBeVisible();
    await expect(reader.page.getByRole('toolbar', { name: '阅读工具' })).toBeVisible();
    await expect(reader.page.getByRole('button', { name: '切换侧边栏' })).toBeVisible();
    await expect(reader.page.getByRole('button', { name: '添加书签' })).toBeVisible();
    await expect(reader.page.getByRole('button', { name: '翻译已禁用' })).toBeVisible();
    await expect(reader.page.getByRole('button', { name: '笔记本', exact: true })).toBeVisible();
    await expect(reader.page.getByText('对话批注')).toBeVisible();
    await expect(reader.page.getByText('LaTeX 已关联')).toBeVisible();
    await expect(reader.page.getByRole('button', { name: '新建对话' })).toBeVisible();
    await expect(reader.page.getByLabel('AI 提问输入框')).toBeVisible();
    await expect(reader.page.getByText('共 2 页')).toBeVisible();

    const notebookBox = await reader.notebook.boundingBox();
    expect(notebookBox?.width).toBeGreaterThanOrEqual(360);
    const toolbarBox = await reader.page.getByRole('toolbar', { name: '阅读工具' }).boundingBox();
    expect(toolbarBox?.y).toBeGreaterThan(56);
    expect(toolbarBox?.height).toBeGreaterThanOrEqual(38);

    await expect(reader.page).toHaveScreenshot('nl270-g1-visual-calibration-v2.png', {
      animations: 'disabled',
    });
  });

  test('G1-06 renders every PDF page large and centered in continuous mode', async ({
    openBook,
  }) => {
    const reader = await openBook(SAMPLE_PDF);
    await expect.poll(() => reader.pdfScrollPageCount()).toBe(2);
    await expect.poll(() => reader.originalPdfCanvasCount()).toBeGreaterThanOrEqual(2);
    await expect.poll(() => reader.pdfTextLayerCount()).toBeGreaterThanOrEqual(2);
    const geometry = await reader.pdfPageGeometry();
    const viewer = await reader.viewer.boundingBox();
    expect(geometry.count).toBe(2);
    expect(geometry.width).toBeGreaterThan((viewer?.width ?? 0) * 0.65);
    expect(Math.abs(geometry.center - geometry.viewerCenter)).toBeLessThan(12);
    await reader.scrollToPdfPage(1);
    await expect(reader.page.getByText('共 2 页')).toBeVisible();
    await expect(reader.page).toHaveScreenshot('nl270-g1-second-pdf-page.png', {
      animations: 'disabled',
    });
  });

  test('G1-02 real mouse selection shows exactly three first-level actions', async ({
    openBook,
  }) => {
    const reader = await openBook(SAMPLE_PDF);

    const selectedText = await reader.selectPdfTextWithMouse();

    expect(selectedText.length).toBeGreaterThan(0);
    await expect(reader.annotationPopup).toBeVisible();
    const menu = reader.page.getByTestId('selection-action-menu');
    await expect(menu.getByRole('button')).toHaveCount(3);
    for (const action of FIRST_LEVEL_ACTIONS) {
      await expect(menu.getByRole('button', { name: action, exact: true })).toBeVisible();
    }
    for (const action of UPSTREAM_ACTIONS) {
      await expect(menu.getByRole('button', { name: action, exact: true })).toHaveCount(0);
    }
    await expect(reader.page.locator('[aria-label="Select highlight style"]')).toHaveCount(0);

    await expect(reader.page).toHaveScreenshot('nl270-g1-three-action-menu-v2.png', {
      animations: 'disabled',
    });
  });

  test('G1-03 Ctrl selection remains neutral until an explicit action', async ({ openBook }) => {
    const reader = await openBook(SAMPLE_PDF);

    await reader.selectPdfTextWithMouse('Control');

    await expect(reader.page.getByTestId('selection-action-menu')).toBeVisible();
    await expect(reader.page.getByTestId('selection-drafts')).toHaveCount(0);
    await expect(reader.page.locator('[data-message-role="user"]')).toHaveCount(0);
  });

  test('G1-04 Ask and Attach only prepare visible drafts and never auto-send', async ({
    openBook,
  }) => {
    const reader = await openBook(SAMPLE_PDF);
    const selectedText = await reader.selectPdfTextWithMouse();

    await reader.popupTool('提问').click();

    await expect(reader.notebook).toBeVisible();
    await expect(reader.page.getByTestId('selection-drafts')).toContainText('问题目标');
    await expect(reader.page.getByTestId('selection-drafts')).toContainText(selectedText);
    await expect(reader.page.locator('[data-message-role="user"]')).toHaveCount(0);

    await reader.selectPdfTextWithMouse();
    await reader.popupTool('作为附件').click();

    await expect(reader.page.getByTestId('selection-drafts')).toContainText('附件');
    await expect(reader.page.locator('[data-message-role="user"]')).toHaveCount(0);
  });

  test('G1-05 View Source opens an independent Chinese source window', async ({ openBook }) => {
    const reader = await openBook([SAMPLE_PDF, SAMPLE_TEX, SAMPLE_SYNCTEX]);
    await reader.selectPdfTextWithMouse();

    const sourceWindowPromise = reader.page.waitForEvent('popup');
    await reader.popupTool('查看源码').click();
    const sourceWindow = await sourceWindowPromise;
    await sourceWindow.waitForLoadState('domcontentloaded');

    await expect(sourceWindow.getByText('LaTeX 源代码')).toBeVisible();
    await expect(sourceWindow.getByTestId('latex-source-content')).toContainText(
      'Sample Paper Source',
    );
    await expect(sourceWindow.getByText('SyncTeX 已将 PDF 选区定位到源码第 4 行。')).toBeVisible();
    await expect(sourceWindow.locator('[data-source-line="4"]')).toHaveClass(/bg-primary\/15/);
    await expect(sourceWindow).toHaveScreenshot('nl270-g1-latex-source-window.png', {
      animations: 'disabled',
    });
    await sourceWindow.getByTitle('在 PDF 中查看第 4 行').click();
    await expect.poll(() => reader.pdfSourceMarkerPage()).toBe(1);
    await expect(reader.annotationPopup).toBeHidden();
    await expect(reader.viewer).toBeVisible();
  });

  test('G1-07 restores a real anchored conversation marker and rail item', async ({ openBook }) => {
    const reader = await openBook(SAMPLE_PDF);
    await reader.selectPdfTextWithMouse();
    const anchor = await reader.selectedPdfAnchor();
    const conversationId = `pdf-marker-${Date.now()}`;
    await reader.persistAnchoredConversation(conversationId, anchor);

    await reader.page.reload();
    await reader.waitForReady();

    await expect.poll(() => reader.conversationMarkerCount()).toBeGreaterThanOrEqual(1);
    const railItem = reader.page.getByRole('button', { name: '打开批注 1' });
    await expect(railItem).toBeVisible();
    await expect(reader.page).toHaveScreenshot('nl270-g1-anchored-conversation.png', {
      animations: 'disabled',
    });

    const markerValue = await reader.clickConversationMarker();
    expect(decodeURIComponent(markerValue.replace('foliate-ai-conversation:', ''))).toBe(
      conversationId,
    );
    await expect(reader.notebook).toBeVisible();
    await expect.poll(() => reader.originalPdfCanvasCount()).toBeGreaterThan(0);
    await expect(railItem).toHaveClass(/is-active/);
  });
});
