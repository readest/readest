import { expect, test } from '@playwright/test';

test.describe('NL-270 foundation spike', () => {
  test('selects source text, follows citations, and restores the thread', async ({ page }) => {
    await page.goto('/foundation-spike');

    await expect(page.getByTestId(/^source-block-/)).toHaveCount(12);
    const sourceBlock = page.getByTestId('source-block-block-02');
    const nextBlock = page.getByTestId('source-block-block-03');
    await sourceBlock.evaluate((element) => {
      const startText = '紧致性把局部信息提升为全局控制';
      const startNode = element.querySelector('[data-source-text]')!.querySelector('p')!
        .firstChild!;
      const endNode = document.querySelector('[data-source-text="block-03"]')!.querySelector('p')!
        .firstChild!;
      const startOffset = startNode.textContent!.indexOf(startText);
      const endText = '因此';
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endNode.textContent!.indexOf(endText) + endText.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await expect(page.getByText('当前锚点 · 2 块')).toBeVisible();
    await expect(page.getByTestId('active-quote')).toContainText('紧致性把局部信息提升为全局控制');
    await expect(page.getByTestId('active-quote')).toContainText('因此');
    await page.getByRole('textbox', { name: '问题' }).fill('为什么需要紧致性？');
    await page.getByRole('button', { name: '提问' }).click();
    await expect(page.getByRole('button', { name: /打开源块 02 的批注/ })).toHaveAttribute(
      'title',
      /为什么需要紧致性/,
    );
    await expect(page.getByRole('button', { name: /引用/ })).toHaveCount(2);

    await page.getByRole('button', { name: '展开阅读显示设置' }).click();
    await page.getByRole('slider', { name: '正文字号' }).fill('21');
    await page.getByRole('slider', { name: '正文行距' }).fill('1.9');
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('button', { name: /引用 1/ }).click();
    await expect(sourceBlock).toHaveAttribute('data-highlighted', 'true');
    expect(await page.evaluate(() => CSS.highlights.has('foundation-citation'))).toBe(true);
    await expect(page.getByRole('status')).toHaveText('已定位到源块 02');

    await page.reload();
    await expect(page.getByRole('button', { name: /打开源块 02 的批注/ })).toBeVisible();
    await expect(page.getByTestId('active-quote')).toContainText('紧致性把局部信息提升为全局控制');
    await expect(nextBlock).toBeVisible();
    await page.getByRole('textbox', { name: '问题' }).fill('重启后还能继续追问吗？');
    await page.getByRole('button', { name: '提问' }).click();
    await expect(
      page.getByRole('button', { name: /编辑消息：重启后还能继续追问吗/ }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /引用/ })).toHaveCount(4);
    await page
      .getByRole('button', { name: /引用 2/ })
      .last()
      .click();
    await expect(page.getByTestId('source-block-block-08')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
  });

  test('imports Markdown and opens a margin thread in the sidebar', async ({ page }) => {
    await page.goto('/foundation-spike');
    await page.getByLabel('导入 Markdown').setInputFiles({
      name: 'human-acceptance.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 验收文档\n\n第一段真实内容。\n\n## 第二节\n\n第二段真实内容。'),
    });
    await expect(page.getByRole('heading', { name: '验收文档', level: 1 })).toBeVisible();
    await expect(page.getByText('第一段真实内容。')).toBeVisible();

    const firstParagraph = page.getByTestId(/^source-block-/).nth(1);
    await firstParagraph.evaluate((element) => {
      const textNode = element.querySelector('[data-source-text]')!.querySelector('p')!.firstChild!;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.textContent!.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('textbox', { name: '问题' }).fill('这段在说什么？');
    await page.getByRole('button', { name: '提问' }).click();
    await page.getByRole('button', { name: '收起批注栏' }).click();
    await page.getByRole('button', { name: /打开源块 02 的批注/ }).click();
    await expect(page.getByLabel('对话批注')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '收起批注栏' }).click();
    await firstParagraph.getByText('第一段真实内容。').click({ position: { x: 8, y: 8 } });
    await expect(page.getByLabel('对话批注')).toBeVisible();
    await expect(page).toHaveURL(/\/foundation-spike$/);
  });

  test('uses an overlay sidebar in a narrow reading window', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 800 });
    await page.goto('/foundation-spike');

    const sourceBlock = page.getByTestId('source-block-block-02');
    await sourceBlock.evaluate((element) => {
      const textNode = element.querySelector('[data-source-text]')!.querySelector('p')!.firstChild!;
      const start = textNode.textContent!.indexOf('紧致性');
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + '紧致性'.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('textbox', { name: '问题' }).fill('窄屏批注');
    await page.getByRole('button', { name: '提问' }).click();

    const sidebar = page.getByLabel('对话批注');
    await expect(sidebar).toHaveCSS('position', 'fixed');
    await page.getByRole('button', { name: '关闭批注栏' }).click();
    await expect(sidebar).toHaveCount(0);
    const annotationPoint = await sourceBlock.evaluate((element) => {
      const textNode = element.querySelector('[data-source-text]')!.querySelector('p')!.firstChild!;
      const start = textNode.textContent!.indexOf('紧致性');
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + '紧致性'.length);
      const bounds = range.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    });
    await page.mouse.click(annotationPoint.x, annotationPoint.y);
    await expect(page.getByLabel('对话批注')).toBeVisible();
    await expect(page.getByText('窄屏批注', { exact: true }).first()).toBeVisible();
  });

  test('keeps rendered Markdown intact and resizes the desktop sidebar by its divider', async ({
    page,
  }) => {
    await page.goto('/foundation-spike');
    await page.getByLabel('导入 Markdown').setInputFiles({
      name: 'formatted.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '# 格式验收\n\n正文包含 **粗体**、*斜体* 和 [链接](https://example.com)。\n\n> 引用内容\n\n- 条目一\n- 条目二\n\n| 列一 | 列二 |\n| --- | --- |\n| A | B |\n\n```ts\nconst answer = 42;\n```',
      ),
    });

    await expect(page.getByRole('heading', { name: '格式验收', level: 1 })).toBeVisible();
    await expect(page.getByText('粗体')).toHaveJSProperty('tagName', 'STRONG');
    await expect(page.getByText('斜体')).toHaveJSProperty('tagName', 'EM');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('引用内容').locator('..')).toHaveJSProperty(
      'tagName',
      'BLOCKQUOTE',
    );

    const paragraph = page.getByText(/正文包含/).locator('..');
    const htmlBefore = await paragraph.evaluate((element) => element.innerHTML);
    await paragraph.evaluate((element) => {
      const strongText = element.querySelector('strong')!.firstChild!;
      const range = document.createRange();
      range.selectNodeContents(strongText);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('textbox', { name: '问题' }).fill('解释粗体');
    await page.getByRole('button', { name: '提问' }).click();
    expect(await paragraph.evaluate((element) => element.innerHTML)).toBe(htmlBefore);
    expect(await page.evaluate(() => CSS.highlights.has('foundation-annotations'))).toBe(true);

    await expect(page.getByRole('slider', { name: '正文宽度' })).toHaveCount(0);
    await page.getByRole('button', { name: '展开阅读显示设置' }).click();
    await expect(page.getByRole('slider', { name: '正文宽度' })).toBeVisible();
    await expect(page.getByRole('slider', { name: '批注栏宽度' })).toHaveCount(0);

    const sidebar = page.getByLabel('对话批注');
    const divider = page.getByRole('separator', { name: '调整批注栏宽度' });
    const widthBefore = (await sidebar.boundingBox())!.width;
    const dividerBox = await divider.boundingBox();
    if (!dividerBox) throw new Error('Sidebar divider is not visible');
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(dividerBox.x - 80, dividerBox.y + 20);
    await page.mouse.up();
    const widthAfter = (await sidebar.boundingBox())!.width;
    expect(widthAfter).toBeGreaterThanOrEqual(widthBefore + 75);
  });
});
