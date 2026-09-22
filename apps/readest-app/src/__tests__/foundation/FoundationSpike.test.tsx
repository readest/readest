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

    expect(screen.getByText('为什么需要紧致性？')).not.toBeNull();
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
    expect(screen.getByText('它有什么作用？')).not.toBeNull();
    expect(screen.getByTestId('active-quote').textContent).toBe(exactQuote);
    fireEvent.change(screen.getByLabelText('问题'), {
      target: { value: '重启后还能继续追问吗？' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    expect(screen.getByText('重启后还能继续追问吗？')).not.toBeNull();
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
    expect(screen.getByText('2 章 · 12 个编号源块 · 本页使用固定测试文档')).not.toBeNull();
    expect(screen.getByRole('link', { name: '打开原版书库' }).getAttribute('href')).toBe('/');
    selectText('block-02', '紧致性', 'block-03', '因此');

    expect(screen.getByText('当前锚点 · 2 块')).not.toBeNull();
    expect(screen.getByTestId('active-quote').textContent).toContain('因此');
  });
});
