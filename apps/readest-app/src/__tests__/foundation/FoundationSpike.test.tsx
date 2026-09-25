import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';

const libraryAppService = vi.hoisted(() => ({
  loadLibraryBooks: vi.fn(async (): Promise<Book[]> => []),
  loadBookContent: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: libraryAppService }),
}));

import FoundationSpike, { restoredWindowSize } from '@/app/foundation-spike/page';

describe('foundation spike page', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, '', '/foundation-spike');
    libraryAppService.loadLibraryBooks.mockResolvedValue([]);
    libraryAppService.loadBookContent.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  const selectText = (
    startBlockId: string,
    startText: string,
    endBlockId = startBlockId,
    endText = startText,
    ctrlKey = false,
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
    fireEvent.mouseUp(startElement.closest('article')!, { ctrlKey });
  };

  it('restores the pre-fullscreen size or half of the work area without overflowing', () => {
    expect(restoredWindowSize({ width: 1280, height: 760 }, { width: 1920, height: 1040 })).toEqual(
      {
        width: 1280,
        height: 760,
      },
    );
    expect(restoredWindowSize(null, { width: 1920, height: 1040 })).toEqual({
      width: 1440,
      height: 780,
    });
    expect(restoredWindowSize({ width: 2400, height: 1400 }, { width: 1600, height: 900 })).toEqual(
      {
        width: 1600,
        height: 900,
      },
    );
  });

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
    const evidenceToggle = screen.getByRole('button', { name: /回答依据 2 段/ });
    expect(evidenceToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(evidenceToggle);
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
    fireEvent.click(screen.getAllByRole('button', { name: /回答依据/ }).at(-1)!);
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
    expect(screen.getByRole('link', { name: '返回书库' }).getAttribute('href')).toBe('/library');
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

  it('previews an annotation anchor while hovering a same-paragraph thread choice', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '第一条' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));
    selectText('block-02', '局部信息');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '第二条' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    fireEvent.click(screen.getByRole('button', { name: /打开源块 02 的批注，共 2 条/ }));
    const firstChoice = screen.getByRole('button', { name: /预览并打开批注：第一条/ });
    fireEvent.mouseEnter(firstChoice);
    expect(screen.getByTestId('source-block-block-02').getAttribute('data-previewed')).toBe('true');
    fireEvent.mouseLeave(firstChoice);
    expect(screen.getByTestId('source-block-block-02').getAttribute('data-previewed')).toBe(
      'false',
    );
  });

  it('keeps the gutter cursor unchanged and scrolls an overflowing attachment list', () => {
    render(<FoundationSpike />);
    expect(screen.getByTestId('reader-gutter').className).not.toContain('cursor-not-allowed');

    for (const text of ['紧致性', '局部信息', '全局控制']) {
      fireEvent.click(screen.getByRole('button', { name: '将选中文本作为问题附件' }));
      selectText('block-02', text);
    }

    const list = screen.getByTestId('question-attachments-list');
    expect(list.className).toContain('max-h-40');
    expect(list.className).toContain('overflow-y-auto');
    expect(screen.getAllByRole('button', { name: /删除附件/ })).toHaveLength(3);
  });

  it('shows Ctrl selections as separate cards and stores them as separate anchors', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    selectText('block-03', '因此', 'block-03', '因此', true);

    expect(screen.getAllByTestId('selection-card')).toHaveLength(2);
    expect(screen.getByText('已选择 2 处独立原文')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '比较这两处' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    const stored = JSON.parse(localStorage.getItem('readest:annotation-schema:v1') ?? '{}');
    expect(stored.threads[0].anchorIds).toHaveLength(2);
  });

  it('keeps sent attachments separate and opens long content in a movable dialog', () => {
    render(<FoundationSpike />);
    for (const text of ['紧致性', '局部信息']) {
      fireEvent.click(screen.getByRole('button', { name: '将选中文本作为问题附件' }));
      selectText('block-02', text);
    }
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '附件问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(screen.getAllByTestId('message-attachment-card')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '查看完整附件 1' }));
    const dialog = screen.getByRole('dialog', { name: '完整原文附件' });
    expect(dialog.textContent).toContain('紧致性');
    expect(screen.getByLabelText('拖动附件窗口')).not.toBeNull();
  });

  it('shows TXT navigation and allows dismissing source warnings', async () => {
    window.history.replaceState({}, '', '/foundation-spike?book=library-txt');
    const txtBook: Book = {
      hash: 'library-txt',
      format: 'TXT',
      title: '长文本',
      author: '',
      createdAt: 1,
      updatedAt: 1,
    };
    libraryAppService.loadLibraryBooks.mockResolvedValue([txtBook]);
    libraryAppService.loadBookContent.mockResolvedValue({
      book: txtBook,
      file: new File(['chapter 1\n\nplain text'], 'low.txt'),
    });
    render(<FoundationSpike />);

    const navigationButton = await screen.findByRole('button', { name: '打开导航目录' });
    expect(navigationButton).not.toBeNull();
    fireEvent.click(navigationButton);
    expect(screen.getByRole('navigation', { name: '文档导航目录' })).not.toBeNull();
    const warning = await screen.findByRole('status');
    expect(warning.textContent).toContain('文字显示异常');
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByText(/文字显示异常/)).toBeNull();
  });

  it('loads all unified article variants and switches formats independently', async () => {
    window.history.replaceState({}, '', '/foundation-spike?book=library-txt');
    const books: Book[] = [
      {
        hash: 'library-txt',
        format: 'TXT',
        title: '三种格式的同一篇文章',
        sourceTitle: '10-same-content.txt',
        author: '',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        hash: 'library-html',
        format: 'HTML',
        title: '三种格式的同一篇文章',
        sourceTitle: '10-same-content.html',
        author: '',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        hash: 'library-epub',
        format: 'EPUB',
        title: '三种格式的同一篇文章',
        sourceTitle: '10-same-content.epub',
        author: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    libraryAppService.loadLibraryBooks.mockResolvedValue(books);
    libraryAppService.loadBookContent.mockImplementation(async (selected: Book) => ({
      book: selected,
      file:
        selected.format === 'HTML'
          ? new File(['<h1>HTML 版本</h1><p>网页正文</p>'], '10-same-content.html')
          : new File(['TXT 版本\n\n纯文本正文'], '10-same-content.txt'),
    }));
    render(<FoundationSpike />);

    const formatSelect = await screen.findByRole('combobox', { name: '切换统一文章格式' });
    expect(formatSelect.querySelectorAll('option')).toHaveLength(3);
    fireEvent.change(formatSelect, { target: { value: 'library-html' } });
    expect(await screen.findByText('网页正文')).not.toBeNull();
    expect(window.location.search).toBe('?book=library-html');
    expect(
      localStorage.getItem('readest:annotation-schema:v1:library:library-html'),
    ).not.toBeNull();
  });

  it('loads a Markdown book from the native library into a book-scoped workspace', async () => {
    window.history.replaceState({}, '', '/foundation-spike?book=library-md');
    const book: Book = {
      hash: 'library-md',
      format: 'MD',
      title: '书库里的书',
      sourceTitle: '书库里的书.md',
      author: '',
      createdAt: 1,
      updatedAt: 1,
    };
    libraryAppService.loadLibraryBooks.mockResolvedValue([book]);
    libraryAppService.loadBookContent.mockResolvedValue({
      book,
      file: new File(['# 书库里的书\n\n这是原生书库文件。'], '书库里的书.md', {
        type: 'text/markdown',
      }),
    });

    render(<FoundationSpike />);

    expect(await screen.findByText('这是原生书库文件。')).not.toBeNull();
    expect(screen.queryByText(/已从书库打开/)).toBeNull();
    expect(localStorage.getItem('readest:annotation-schema:v1:library:library-md')).not.toBeNull();
  });

  it('shows one rail marker for one annotation spanning multiple blocks', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性', 'block-03', '因此');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '跨段问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(screen.getAllByRole('button', { name: /打开源块 .* 的批注/ })).toHaveLength(1);
  });

  it('renames annotations and deletes selected threads in bulk without opening them', () => {
    render(<FoundationSpike />);
    selectText('block-02', '紧致性');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '旧标题问题' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    selectText('block-03', '因此');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '第二条批注' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    fireEvent.click(screen.getByRole('button', { name: '打开批注管理' }));
    fireEvent.click(screen.getByRole('button', { name: '选择批注：旧标题问题' }));
    fireEvent.click(screen.getByRole('button', { name: '重命名选中批注' }));
    fireEvent.change(screen.getByLabelText('批注标题'), { target: { value: '新批注标题' } });
    fireEvent.click(screen.getByRole('button', { name: '保存标题' }));
    expect(screen.getAllByText('新批注标题').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: '选择批注：第二条批注' }));
    expect(
      (screen.getByRole('button', { name: '批量删除 2 条批注' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条批注' }));
    expect(screen.queryByText('新批注标题')).toBeNull();
    expect(screen.queryByText('第二条批注')).toBeNull();
    expect(screen.queryByRole('button', { name: /打开源块 02 的批注/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /打开源块 03 的批注/ })).toBeNull();
  });

  it('keeps annotation highlights when Markdown DOM rerenders after management changes', async () => {
    render(<FoundationSpike />);
    fireEvent.change(screen.getByLabelText('导入 Markdown'), {
      target: {
        files: [
          new File(['# 标题\n\n第一段包含 **粗体**。\n\n第二段正文。'], '高亮.md', {
            type: 'text/markdown',
          }),
        ],
      },
    });
    const bold = await screen.findByText('粗体');
    const blockId = (bold.closest('[data-testid^="source-block-"]') as HTMLElement).dataset[
      'testid'
    ]!.replace('source-block-', '');
    selectText(blockId, '粗体');
    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '高亮稳定吗？' } });
    fireEvent.click(screen.getByRole('button', { name: '提问' }));

    expect(screen.getByRole('button', { name: /打开源块 02 的批注/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开批注管理' }));
    fireEvent.change(screen.getByLabelText('搜索批注'), { target: { value: '高亮稳定' } });
    fireEvent.click(screen.getByRole('button', { name: '选择批注：高亮稳定吗？' }));
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

  it('uses a viewport workbench with reader-scoped controls and a chat-first sidebar', () => {
    render(<FoundationSpike />);

    const main = document.querySelector('main')!;
    expect(main.className).toContain('full-height');
    expect(main.className).toContain('overflow-hidden');
    const reader = document.querySelector('.foundation-reader')!;
    expect(reader.className).toContain('overflow-y-auto');
    expect(screen.getByLabelText('阅读工具栏').className).toContain('w-[min(780px');

    const sidebar = screen.getByLabelText('对话批注');
    expect(sidebar.className).toContain('overflow-hidden');
    expect(screen.getByLabelText('批注对话消息').className).toContain('overflow-y-auto');
    expect(screen.getByLabelText('问题').closest('footer')).not.toBeNull();
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
    expect(screen.queryByText(/已导入/)).toBeNull();
  });
});
