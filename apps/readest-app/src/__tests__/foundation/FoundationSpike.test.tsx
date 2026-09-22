import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FoundationSpike from '@/app/foundation-spike/page';

describe('foundation spike page', () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  const selectText = (
    startBlockId: string,
    startText: string,
    endBlockId = startBlockId,
    endText = startText,
  ) => {
    const startElement = screen
      .getByTestId(`source-block-${startBlockId}`)
      .querySelector('[data-source-text]')!;
    const endElement = screen
      .getByTestId(`source-block-${endBlockId}`)
      .querySelector('[data-source-text]')!;
    const startNode = startElement.firstChild!;
    const endNode = endElement.firstChild!;
    const range = document.createRange();
    range.setStart(startNode, startNode.textContent!.indexOf(startText));
    range.setEnd(endNode, endNode.textContent!.indexOf(endText) + endText.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(startElement.closest('article')!);
  };

  it('runs selection, question, citations, and navigation as one loop', () => {
    render(<FoundationSpike />);

    const block = screen.getByTestId('source-block-block-02');
    const exactQuote = '紧致性把局部信息提升为全局控制';
    selectText('block-02', exactQuote);

    expect(screen.getByTestId('active-quote').textContent).toBe(exactQuote);
    fireEvent.change(screen.getByLabelText('问题'), {
      target: { value: '为什么需要紧致性？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(screen.getAllByText('为什么需要紧致性？').length).toBeGreaterThan(0);
    const citations = screen.getAllByRole('button', { name: /引用/ });
    expect(citations).toHaveLength(2);
    fireEvent.click(citations[0]!);
    expect(block.getAttribute('data-highlighted')).toBe('true');
    expect(screen.getByTestId('citation-highlight').textContent).toBe(exactQuote);
    expect(screen.getByRole('status').textContent).toContain('已定位到源块 02');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('restores the anchor and continues the thread after remount', () => {
    const first = render(<FoundationSpike />);
    const exactQuote = '紧致性';
    selectText('block-02', exactQuote);
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '它有什么作用？' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    first.unmount();

    render(<FoundationSpike />);
    expect(screen.getAllByText('它有什么作用？').length).toBeGreaterThan(0);
    expect(screen.getByTestId('active-quote').textContent).toBe(exactQuote);
    fireEvent.change(screen.getByLabelText('问题'), {
      target: { value: '重启后还能继续追问吗？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(screen.getAllByText('重启后还能继续追问吗？').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: /引用/ })[0]!);
    expect(screen.getByTestId('source-block-block-02').getAttribute('data-highlighted')).toBe(
      'true',
    );
  });

  it('keeps the selected anchor after display settings change', () => {
    render(<FoundationSpike />);
    const exactQuote = '局部信息';
    selectText('block-02', exactQuote);

    fireEvent.click(screen.getByRole('button', { name: '切换字号' }));
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));

    expect(screen.getByTestId('active-quote').textContent).toBe(exactQuote);
    expect(document.querySelector('main')?.getAttribute('style')).toContain(
      'background-color: rgb(17, 24, 39)',
    );
  });

  it('shows all source blocks and captures a cross-block selection', () => {
    render(<FoundationSpike />);

    expect(screen.getAllByTestId(/source-block-/)).toHaveLength(12);
    expect(screen.getByText('2 章 · 12 个编号源块 · 内置测试文档')).not.toBeNull();
    expect(screen.getByRole('link', { name: '打开原版书库' }).getAttribute('href')).toBe('/');
    selectText('block-02', '紧致性', 'block-03', '因此');

    expect(screen.getByText('当前锚点 · 2 块')).not.toBeNull();
    expect(screen.getByTestId('active-quote').textContent).toContain('因此');
  });

  it('shows an inline preview and opens the full thread without leaving the reader', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '为什么？' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    const preview = screen.getByRole('button', { name: /打开源块 02 的批注/ });
    expect(preview.textContent).toContain('为什么？');
    fireEvent.click(preview);
    expect(screen.getByRole('dialog', { name: '完整批注对话' })).not.toBeNull();
    expect(screen.getAllByText('为什么？').length).toBeGreaterThan(0);
    expect(window.location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: '关闭完整对话' }));
  });

  it('keeps sidebar and inline preview synchronized after editing and archiving', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '旧标题问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    fireEvent.click(screen.getByRole('button', { name: '重命名批注' }));
    fireEvent.change(screen.getByLabelText('批注标题'), { target: { value: '新批注标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标题' }));
    expect(screen.getAllByText('新批注标题').length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole('button', { name: '编辑消息：旧标题问题' }));
    fireEvent.change(screen.getByLabelText('消息内容'), { target: { value: '修改后的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存消息' }));
    expect(screen.getByText('修改后的问题')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '归档批注' }));
    expect(screen.getByText('已归档')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示已归档' }));
    expect(screen.getByRole('button', { name: /打开源块 02 的批注/ })).not.toBeNull();
  });

  it('imports a Markdown file through the reader toolbar', async () => {
    render(<FoundationSpike />);
    const input = screen.getByLabelText('导入 Markdown');
    const file = new File(['# 我的书\n\n这是上传的真实正文。'], '我的书.md', {
      type: 'text/markdown',
    });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: '我的书', level: 1 })).not.toBeNull();
    expect(screen.getByText('这是上传的真实正文。')).not.toBeNull();
    expect(screen.getByText(/已导入“我的书.md”/)).not.toBeNull();
  });
});
