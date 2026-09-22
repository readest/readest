import { expect, test } from '@playwright/test';

test.describe('NL-270 foundation spike', () => {
  test('selects source text, follows citations, and restores the thread', async ({ page }) => {
    await page.goto('/foundation-spike');

    await expect(page.getByTestId(/^source-block-/)).toHaveCount(12);
    const sourceBlock = page.getByTestId('source-block-block-02');
    const nextBlock = page.getByTestId('source-block-block-03');
    await sourceBlock.evaluate((element) => {
      const startText = '紧致性把局部信息提升为全局控制';
      const startNode = element.querySelector('[data-source-text]')!.firstChild!;
      const endNode = document.querySelector('[data-source-text="block-03"]')!.firstChild!;
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

    await page.getByRole('slider', { name: '正文字号' }).fill('21');
    await page.getByRole('slider', { name: '正文行距' }).fill('1.9');
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('button', { name: /引用 1/ }).click();
    await expect(sourceBlock).toHaveAttribute('data-highlighted', 'true');
    await expect(page.getByTestId('citation-highlight')).toContainText(
      '紧致性把局部信息提升为全局控制',
    );
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
      const textNode = element.querySelector('[data-source-text]')!.firstChild!;
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
    await page.getByRole('button', { name: /打开批注：第一段真实内容/ }).click();
    await expect(page.getByLabel('对话批注')).toBeVisible();
    await expect(page).toHaveURL(/\/foundation-spike$/);
  });

  test('uses an overlay sidebar in a narrow reading window', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 800 });
    await page.goto('/foundation-spike');

    const sourceBlock = page.getByTestId('source-block-block-02');
    await sourceBlock.evaluate((element) => {
      const textNode = element.querySelector('[data-source-text]')!.firstChild!;
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
    await page.getByRole('button', { name: '打开批注：紧致性' }).click();
    await expect(page.getByLabel('对话批注')).toBeVisible();
    await expect(page.getByText('窄屏批注', { exact: true }).first()).toBeVisible();
  });
});
