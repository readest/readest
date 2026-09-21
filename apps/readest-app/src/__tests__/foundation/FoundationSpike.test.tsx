import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FoundationSpike from '@/app/foundation-spike/page';

describe('foundation spike page', () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('runs selection, question, citations, and navigation as one loop', () => {
    render(<FoundationSpike />);

    const block = screen.getByTestId('source-block-block-02');
    const textNode = block.firstChild;
    expect(textNode).not.toBeNull();
    const text = textNode!.textContent!;
    const exactQuote = '紧致性把局部信息提升为全局控制';
    const startOffset = text.indexOf(exactQuote);
    const range = document.createRange();
    range.setStart(textNode!, startOffset);
    range.setEnd(textNode!, startOffset + exactQuote.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(block);

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
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('restores the anchor and continues the thread after remount', () => {
    const first = render(<FoundationSpike />);
    const block = screen.getByTestId('source-block-block-02');
    const textNode = block.firstChild!;
    const exactQuote = '紧致性';
    const startOffset = textNode.textContent!.indexOf(exactQuote);
    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, startOffset + exactQuote.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(block);
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
    const block = screen.getByTestId('source-block-block-02');
    const textNode = block.firstChild!;
    const exactQuote = '局部信息';
    const startOffset = textNode.textContent!.indexOf(exactQuote);
    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, startOffset + exactQuote.length);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(block);

    fireEvent.click(screen.getByRole('button', { name: '切换字号' }));
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));

    expect(screen.getByTestId('active-quote').textContent).toBe(exactQuote);
  });
});
