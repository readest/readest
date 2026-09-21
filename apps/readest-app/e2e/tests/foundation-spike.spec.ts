import { expect, test } from '@playwright/test';

test.describe('NL-270 foundation spike', () => {
  test('selects source text, follows citations, and restores the thread', async ({ page }) => {
    await page.goto('/foundation-spike');

    const sourceBlock = page.getByTestId('source-block-block-02');
    await sourceBlock.evaluate((element) => {
      const exactQuote = '紧致性把局部信息提升为全局控制';
      const textNode = element.firstChild!;
      const startOffset = textNode.textContent!.indexOf(exactQuote);
      const range = document.createRange();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, startOffset + exactQuote.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await expect(page.getByTestId('active-quote')).toHaveText('紧致性把局部信息提升为全局控制');
    await page.getByLabel('问题').fill('为什么需要紧致性？');
    await page.getByRole('button', { name: '提问' }).click();
    await expect(page.getByText('为什么需要紧致性？', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /引用/ })).toHaveCount(2);

    await page.getByRole('button', { name: '切换字号' }).click();
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('button', { name: '引用 1' }).click();
    await expect(sourceBlock).toHaveAttribute('data-highlighted', 'true');

    await page.reload();
    await expect(page.getByText('为什么需要紧致性？', { exact: true })).toBeVisible();
    await expect(page.getByTestId('active-quote')).toHaveText('紧致性把局部信息提升为全局控制');
    await page.getByLabel('问题').fill('重启后还能继续追问吗？');
    await page.getByRole('button', { name: '提问' }).click();
    await expect(page.getByText('重启后还能继续追问吗？', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /引用/ })).toHaveCount(4);
    await page.getByRole('button', { name: '引用 2' }).last().click();
    await expect(page.getByTestId('source-block-block-08')).toHaveAttribute(
      'data-highlighted',
      'true',
    );
  });
});
