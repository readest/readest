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
    const findText = (element: Element, value: string) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const offset = node.textContent?.indexOf(value) ?? -1;
        if (offset >= 0) return { node, offset };
      }
      throw new Error(`Text not found: ${value}`);
    };
    const start = findText(startElement, startText);
    const end = findText(endElement, endText);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + endText.length);
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
    expect(block.getAttribute('style')).toContain('color: rgb(17, 24, 39)');
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

    fireEvent.click(screen.getByRole('button', { name: '展开阅读显示设置' }));
    fireEvent.change(screen.getByRole('slider', { name: '正文字号' }), {
      target: { value: '22' },
    });
    fireEvent.change(screen.getByRole('slider', { name: '正文行距' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '切换主题' }));

    expect(screen.getByTestId('active-quote').textContent).toBe(exactQuote);
    expect(screen.getByLabelText('SOURCE_DOC 阅读区').getAttribute('style')).toContain(
      'font-size: 22px',
    );
    expect(screen.getByLabelText('SOURCE_DOC 阅读区').getAttribute('style')).toContain(
      'line-height: 2',
    );
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

  it('opens a thread from the annotation rail and the underlined source text', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '为什么？' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    const railMarker = screen.getByRole('button', { name: /打开源块 02 的批注/ });
    const annotatedText = screen.getByTestId('source-block-block-02').querySelector('p')!;
    expect(screen.getByTestId('source-block-block-02').className).not.toContain('border');
    expect(annotatedText.textContent).toContain('紧致性');
    expect(annotatedText.querySelector('button')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '完整批注对话' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '收起批注栏' }));
    expect(screen.queryByLabelText('对话批注')).toBeNull();

    fireEvent.click(railMarker);
    expect(screen.getByLabelText('对话批注')).not.toBeNull();
    expect(screen.getAllByText('为什么？').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '收起批注栏' }));
    window.getSelection()?.removeAllRanges();
    fireEvent.click(screen.getByTestId('source-block-block-02').querySelector('p')!);
    expect(screen.getByLabelText('对话批注')).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps sidebar and margin marker synchronized after editing and archiving', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '旧标题问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    fireEvent.click(screen.getByRole('button', { name: '打开批注管理' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名批注：旧标题问题' }));
    fireEvent.change(screen.getByLabelText('批注标题'), { target: { value: '新批注标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标题' }));
    expect(screen.getAllByText('新批注标题').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: '编辑消息：旧标题问题' }));
    fireEvent.change(screen.getByLabelText('消息内容'), { target: { value: '修改后的问题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存消息' }));
    expect(screen.getByText('修改后的问题')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '归档批注：新批注标题' }));
    expect(screen.getByText('已归档')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '显示已归档' }));
    expect(screen.getByRole('button', { name: /打开源块 02 的批注/ })).not.toBeNull();
  });

  it('collapses display settings and resizes the sidebar from its divider', () => {
    const first = render(<FoundationSpike />);
    expect(screen.queryByRole('slider', { name: '正文宽度' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开阅读显示设置' }));
    fireEvent.change(screen.getByRole('slider', { name: '正文宽度' }), {
      target: { value: '760' },
    });
    expect(screen.getByLabelText('SOURCE_DOC 阅读区').getAttribute('style')).toContain(
      'width: 760px',
    );
    expect(screen.queryByRole('slider', { name: '批注栏宽度' })).toBeNull();
    const divider = screen.getByRole('separator', { name: '调整批注栏宽度' });
    fireEvent.pointerDown(divider, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 820, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(screen.getByLabelText('对话批注').getAttribute('style')).toContain('width: 480px');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(screen.getByLabelText('对话批注').getAttribute('style')).toContain('width: 490px');
    fireEvent.pointerDown(divider, { clientX: 900, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 0, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });
    expect(screen.getByLabelText('对话批注').getAttribute('style')).toContain('width: 560px');
    first.unmount();

    render(<FoundationSpike />);
    fireEvent.click(screen.getByRole('button', { name: '展开阅读显示设置' }));
    expect((screen.getByRole('slider', { name: '正文宽度' }) as HTMLInputElement).value).toBe(
      '760',
    );
    expect(screen.getByLabelText('对话批注').getAttribute('style')).toContain('width: 560px');
  });

  it('renders Markdown semantics without changing them after annotation', async () => {
    render(<FoundationSpike />);
    const input = screen.getByLabelText('导入 Markdown');
    const markdown = [
      '# 格式验收',
      '',
      '正文包含 **粗体**、*斜体* 和 [链接](https://example.com)。',
      '',
      '> 引用内容',
      '',
      '- 条目一',
      '- 条目二',
      '',
      '| 列一 | 列二 |',
      '| --- | --- |',
      '| A | B |',
      '',
      '```ts',
      'const answer = 42;',
      '```',
    ].join('\n');
    fireEvent.change(input, {
      target: { files: [new File([markdown], '格式验收.md', { type: 'text/markdown' })] },
    });

    const bold = await screen.findByText('粗体');
    expect(bold.tagName).toBe('STRONG');
    expect(screen.getByText('斜体').tagName).toBe('EM');
    expect(screen.getByRole('link', { name: '链接' }).getAttribute('href')).toBe(
      'https://example.com',
    );
    expect(screen.getByText('引用内容').closest('blockquote')).not.toBeNull();
    expect(screen.getByText('条目一').closest('li')).not.toBeNull();
    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.getByText('const answer = 42;').closest('code')).not.toBeNull();

    const paragraphBlock = bold.closest('[data-testid^="source-block-"]') as HTMLElement;
    const sourceText = paragraphBlock.querySelector('[data-source-text]')!;
    const textBefore = sourceText.textContent;
    const htmlBefore = sourceText.innerHTML;
    selectText(paragraphBlock.dataset['testid']!.replace('source-block-', ''), '粗体');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '解释粗体' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(sourceText.textContent).toBe(textBefore);
    expect(sourceText.innerHTML).toBe(htmlBefore);
    expect(sourceText.querySelector('strong')?.textContent).toBe('粗体');
    expect(sourceText.querySelector('button')).toBeNull();
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
