'use client';

import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createRangeAnchor,
  type SourceDocAnchor,
  type SourceDocCitation,
  type SourceDocFixture,
  type SourceDocThread,
} from '@/services/foundation/sourceDocSpike';

const READING_SETTINGS_KEY = 'readest:foundation-spike:reading-settings:v1';

interface ReadingSettings {
  contentWidth: number;
  sidebarWidth: number;
  fontSize: number;
  lineHeight: number;
}

const DEFAULT_READING_SETTINGS: ReadingSettings = {
  contentWidth: 720,
  sidebarWidth: 400,
  fontSize: 18,
  lineHeight: 1.75,
};

const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const ANNOTATION_HIGHLIGHT = 'foundation-annotations';
const CITATION_HIGHLIGHT = 'foundation-citation';

interface HighlightRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}

interface HighlightConstructor {
  new (...ranges: Range[]): unknown;
}

function textBoundary(element: HTMLElement, offset: number): [Node, number] | null {
  const walker = globalThis.document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let lastNode: Text | null = null;
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    lastNode = textNode;
    const next = consumed + textNode.data.length;
    if (offset <= next) return [textNode, Math.max(0, offset - consumed)];
    consumed = next;
  }
  return lastNode ? [lastNode, lastNode.data.length] : null;
}

function domRange(element: HTMLElement, start: number, end: number): Range | null {
  const startBoundary = textBoundary(element, start);
  const endBoundary = textBoundary(element, end);
  if (!startBoundary || !endBoundary || end <= start) return null;
  const range = globalThis.document.createRange();
  range.setStart(...startBoundary);
  range.setEnd(...endBoundary);
  return range;
}

export default function FoundationSpike() {
  const [documentModel, setDocumentModel] = useState<SourceDocFixture>(SOURCE_DOC_FIXTURE);
  const [anchor, setAnchor] = useState<SourceDocAnchor | null>(null);
  const [threads, setThreads] = useState<SourceDocThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [question, setQuestion] = useState('');
  const [highlightedCitation, setHighlightedCitation] = useState<SourceDocCitation | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [navigationStatus, setNavigationStatus] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [messageDraft, setMessageDraft] = useState('');
  const [readingSettings, setReadingSettings] = useState(DEFAULT_READING_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const sidebarDrag = useRef<{ startX: number; startWidth: number } | null>(null);
  const sourcePointerStart = useRef<{ x: number; y: number } | null>(null);
  const store = useMemo(
    () => (typeof window === 'undefined' ? null : new SourceDocSpikeStore(window.localStorage)),
    [],
  );

  const refreshThreads = (preferredId?: string | null) => {
    if (!store) return;
    const nextThreads = store.listThreads();
    setThreads(nextThreads);
    const nextId = preferredId ?? activeThreadId ?? nextThreads[0]?.id ?? null;
    setActiveThreadId(nextThreads.some((item) => item.id === nextId) ? nextId : null);
  };

  useEffect(() => {
    if (!store) return;
    const currentDocument = store.loadCurrentDocument();
    const restored = store.load();
    setDocumentModel(currentDocument);
    setThreads(store.listThreads());
    setActiveThreadId(restored?.id ?? null);
    setAnchor(restored?.anchor ?? null);
    try {
      const savedSettings = window.localStorage.getItem(READING_SETTINGS_KEY);
      if (savedSettings) {
        setReadingSettings({ ...DEFAULT_READING_SETTINGS, ...JSON.parse(savedSettings) });
      }
    } catch {
      window.localStorage.removeItem(READING_SETTINGS_KEY);
    }
  }, [store]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!sidebarDrag.current) return;
      const width = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(
          SIDEBAR_MIN_WIDTH,
          sidebarDrag.current.startWidth + sidebarDrag.current.startX - event.clientX,
        ),
      );
      updateReadingSetting('sidebarWidth', width);
    };
    const onPointerUp = () => {
      sidebarDrag.current = null;
      globalThis.document.body.style.removeProperty('cursor');
      globalThis.document.body.style.removeProperty('user-select');
    };
    globalThis.addEventListener('pointermove', onPointerMove);
    globalThis.addEventListener('pointerup', onPointerUp);
    return () => {
      globalThis.removeEventListener('pointermove', onPointerMove);
      globalThis.removeEventListener('pointerup', onPointerUp);
    };
  });

  const activeThread = threads.find((item) => item.id === activeThreadId) ?? null;
  const visibleThreads = threads.filter(
    (item) =>
      (showArchived || item.status === 'active') &&
      (!search.trim() ||
        `${item.title} ${item.anchor.exactQuote} ${item.messages.map((message) => message.content).join(' ')}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const threadsByBlock = new Map<string, SourceDocThread[]>();
  for (const item of threads) {
    threadsByBlock.set(item.anchor.blockId, [
      ...(threadsByBlock.get(item.anchor.blockId) ?? []),
      item,
    ]);
  }

  const captureSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const startElement =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer.nodeType === Node.ELEMENT_NODE
        ? (range.endContainer as Element)
        : range.endContainer.parentElement;
    const sourceTexts = Array.from(
      globalThis.document.querySelectorAll<HTMLElement>('[data-source-text]'),
    );
    const intersectedTexts = sourceTexts.filter((element) => range.intersectsNode(element));
    const startText =
      startElement?.closest<HTMLElement>('[data-source-text]') ?? intersectedTexts[0];
    const endText =
      endElement?.closest<HTMLElement>('[data-source-text]') ?? intersectedTexts.at(-1);
    const startBlockId = startText?.dataset['sourceText'];
    const endBlockId = endText?.dataset['sourceText'];
    if (!startText || !endText || !startBlockId || !endBlockId) {
      setSelectionError('请选择左侧编号源块中的连续文字。');
      return;
    }
    const offsetWithin = (element: HTMLElement, container: Node, offset: number) => {
      const prefix = globalThis.document.createRange();
      prefix.selectNodeContents(element);
      prefix.setEnd(container, offset);
      return prefix.toString().length;
    };
    try {
      setAnchor(
        createRangeAnchor(
          documentModel,
          startBlockId,
          startText.contains(range.startContainer)
            ? offsetWithin(startText, range.startContainer, range.startOffset)
            : 0,
          endBlockId,
          endText.contains(range.endContainer)
            ? offsetWithin(endText, range.endContainer, range.endOffset)
            : (endText.textContent?.length ?? 0),
        ),
      );
      setActiveThreadId(null);
      setSelectionError('');
    } catch {
      setSelectionError('选区无法建立锚点，请从前向后选择连续正文。');
    }
  };

  const ask = () => {
    if (!store || !anchor || !question.trim()) return;
    const updated = store.ask(documentModel, anchor, question.trim(), activeThreadId ?? undefined);
    setQuestion('');
    refreshThreads(updated.id);
  };

  const selectThread = (thread: SourceDocThread) => {
    setActiveThreadId(thread.id);
    setAnchor(thread.anchor);
    setSidebarOpen(true);
    globalThis.document
      .querySelector(`[data-block-id="${thread.anchor.blockId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const navigateToCitation = (citation: SourceDocCitation) => {
    setHighlightedCitation(citation);
    globalThis.document
      .querySelector(`[data-block-id="${citation.blockId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setNavigationStatus(`已定位到${blockLabel(citation.blockId)}`);
  };

  const importMarkdown = async (file: File | undefined) => {
    if (!file || !store) return;
    try {
      const imported = store.importMarkdown(file.name, await file.text());
      setDocumentModel(imported);
      setAnchor(null);
      setActiveThreadId(null);
      setHighlightedCitation(null);
      setImportStatus(
        `已导入“${file.name}”：${imported.sections.length} 章，${imported.blocks.length} 个源块。`,
      );
      refreshThreads(null);
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Markdown 导入失败');
    }
  };

  const renameActiveThread = () => {
    if (!store || !activeThread) return;
    store.renameThread(activeThread.id, titleDraft);
    setEditingTitle(false);
    refreshThreads(activeThread.id);
  };

  const toggleArchive = () => {
    if (!store || !activeThread) return;
    store.setThreadArchived(activeThread.id, activeThread.status !== 'archived');
    refreshThreads(activeThread.id);
  };

  const saveMessage = () => {
    if (!store || !editingMessageId || !messageDraft.trim()) return;
    store.editMessage(editingMessageId, messageDraft);
    setEditingMessageId(null);
    setMessageDraft('');
    refreshThreads(activeThreadId);
  };

  const deleteActiveThread = () => {
    if (!store || !activeThread) return;
    store.deleteThread(activeThread.id);
    setAnchor(null);
    refreshThreads(null);
  };

  const updateReadingSetting = (key: keyof ReadingSettings, value: number) => {
    setReadingSettings((current) => {
      const nextSettings = { ...current, [key]: value };
      window.localStorage.setItem(READING_SETTINGS_KEY, JSON.stringify(nextSettings));
      return nextSettings;
    });
  };

  const blockLabel = (blockId: string) => {
    const index = documentModel.blocks.findIndex((item) => item.id === blockId);
    return `源块 ${String(index + 1).padStart(2, '0')}`;
  };
  const sectionLabel = (blockId: string) => {
    const block = documentModel.blocks.find((item) => item.id === blockId);
    return documentModel.sections.find((item) => item.id === block?.sectionId)?.title ?? '';
  };
  useEffect(() => {
    const css = globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry };
    const HighlightClass = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor })
      .Highlight;
    if (!css.highlights || !HighlightClass) return;
    const annotationRanges: Range[] = [];
    for (const thread of threads) {
      for (const blockId of thread.anchor.selectedBlockIds) {
        const element = globalThis.document.querySelector<HTMLElement>(
          `[data-source-text="${blockId}"]`,
        );
        const block = documentModel.blocks.find((item) => item.id === blockId);
        if (!element || !block) continue;
        const blockPosition = thread.anchor.selectedBlockIds.indexOf(blockId);
        const range = domRange(
          element,
          blockPosition === 0 ? thread.anchor.startOffset : 0,
          blockPosition === thread.anchor.selectedBlockIds.length - 1
            ? thread.anchor.endOffset
            : block.semanticText.length,
        );
        if (range) annotationRanges.push(range);
      }
    }
    css.highlights.set(ANNOTATION_HIGHLIGHT, new HighlightClass(...annotationRanges));
    css.highlights.delete(CITATION_HIGHLIGHT);
    if (highlightedCitation) {
      const element = globalThis.document.querySelector<HTMLElement>(
        `[data-source-text="${highlightedCitation.blockId}"]`,
      );
      const start = element?.textContent?.indexOf(highlightedCitation.exactQuote) ?? -1;
      const range = element
        ? domRange(element, start, start + highlightedCitation.exactQuote.length)
        : null;
      if (range) css.highlights.set(CITATION_HIGHLIGHT, new HighlightClass(range));
    }
    return () => {
      css.highlights?.delete(ANNOTATION_HIGHLIGHT);
      css.highlights?.delete(CITATION_HIGHLIGHT);
    };
  }, [documentModel, highlightedCitation, threads]);

  const openThreadAtPointer = (
    event: ReactMouseEvent<HTMLElement>,
    blockThreads: SourceDocThread[],
  ) => {
    const sourceText = event.currentTarget;
    const blockId = sourceText?.dataset['sourceText'];
    const pointerStart = sourcePointerStart.current;
    sourcePointerStart.current = null;
    if (!sourceText || !blockId) return;
    if (
      pointerStart &&
      (Math.abs(event.clientX - pointerStart.x) > 4 || Math.abs(event.clientY - pointerStart.y) > 4)
    )
      return;
    const documentWithCaret = globalThis.document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    const caretPosition = documentWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
    const caretRange = documentWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
    const selection = window.getSelection();
    const node = caretPosition?.offsetNode ?? caretRange?.startContainer ?? selection?.focusNode;
    const nodeOffset = caretPosition?.offset ?? caretRange?.startOffset ?? selection?.focusOffset;
    let offset: number | null = null;
    if (node && nodeOffset !== undefined && sourceText.contains(node)) {
      const prefix = globalThis.document.createRange();
      prefix.selectNodeContents(sourceText);
      prefix.setEnd(node, nodeOffset);
      offset = prefix.toString().length;
    }
    const matching = blockThreads.filter((thread) => {
      if (offset === null) return true;
      const position = thread.anchor.selectedBlockIds.indexOf(blockId);
      const start = position === 0 ? thread.anchor.startOffset : 0;
      const end =
        position === thread.anchor.selectedBlockIds.length - 1
          ? thread.anchor.endOffset
          : (sourceText.textContent?.length ?? 0);
      return offset >= start && offset <= end;
    });
    const preferred = matching.find((thread) => thread.status === 'active') ?? matching[0];
    if (preferred) selectThread(preferred);
  };

  const surface = dark ? '#111827' : '#f3f4f6';
  const panel = dark ? '#1f2937' : '#ffffff';
  const mutedPanel = dark ? '#374151' : '#e5e7eb';
  const foreground = dark ? '#f9fafb' : '#111827';
  const muted = dark ? '#d1d5db' : '#4b5563';

  const markdownComponents = {
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className='mb-4 text-[1.55em] font-bold leading-tight'>{children}</h1>
    ),
    h2: ({ children }: { children?: ReactNode }) => (
      <h2 className='mb-3 mt-7 text-[1.35em] font-bold leading-tight'>{children}</h2>
    ),
    h3: ({ children }: { children?: ReactNode }) => (
      <h3 className='mb-2 mt-6 text-[1.18em] font-semibold leading-tight'>{children}</h3>
    ),
    p: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className='my-2 border-l-4 border-blue-500/40 pl-4 italic'>{children}</blockquote>
    ),
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className='my-2 list-disc space-y-1 pl-6'>{children}</ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className='my-2 list-decimal space-y-1 pl-6'>{children}</ol>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <div className='my-2 overflow-x-auto'>
        <table className='w-full border-collapse text-left text-[0.9em]'>{children}</table>
      </div>
    ),
    th: ({ children }: { children?: ReactNode }) => (
      <th className='border px-3 py-2 font-semibold'>{children}</th>
    ),
    td: ({ children }: { children?: ReactNode }) => (
      <td className='border px-3 py-2'>{children}</td>
    ),
    pre: ({ children }: { children?: ReactNode }) => (
      <pre
        className='my-2 overflow-x-auto whitespace-pre-wrap rounded-md px-3 py-2 font-mono text-[0.88em]'
        style={{ backgroundColor: mutedPanel }}
      >
        {children}
      </pre>
    ),
    code: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <code className={className}>
        {className ? String(children).replace(/\n$/, '') : children}
      </code>
    ),
    a: ({ children, href }: { children?: ReactNode; href?: string }) => (
      <a
        className='text-blue-600 underline underline-offset-2'
        href={href}
        target='_blank'
        rel='noopener noreferrer'
      >
        {children}
      </a>
    ),
  };

  const markdownSource = (item: SourceDocFixture['blocks'][number]) => {
    if (documentModel.sourceFormat === 'markdown') return item.sourceText;
    if (item.type === 'heading') return `## ${item.sourceText}`;
    if (item.type === 'code') return `\`\`\`\n${item.sourceText}\n\`\`\``;
    return item.sourceText;
  };

  const threadConversation = (thread: SourceDocThread) => (
    <div className='space-y-3'>
      {thread.messages.map((message) => (
        <div
          key={message.id}
          className='rounded-md border p-3'
          style={{ borderColor: dark ? '#4b5563' : '#d1d5db' }}
        >
          <p className='mb-1 text-xs font-semibold uppercase'>
            {message.role === 'user' ? '你' : '本地固定回复'}
          </p>
          {editingMessageId === message.id ? (
            <div className='space-y-2'>
              <textarea
                aria-label='消息内容'
                className='textarea textarea-bordered w-full'
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
              />
              <button className='btn btn-xs btn-contrast' onClick={saveMessage}>
                保存消息
              </button>
            </div>
          ) : (
            <div className='flex items-start justify-between gap-2'>
              <p>{message.content}</p>
              {thread.id === activeThreadId ? (
                <button
                  className='btn btn-ghost btn-xs'
                  aria-label={`编辑消息：${message.content}`}
                  onClick={() => {
                    setEditingMessageId(message.id);
                    setMessageDraft(message.content);
                  }}
                >
                  编辑
                </button>
              ) : null}
            </div>
          )}
          {message.citations.length > 0 ? (
            <div className='mt-3 space-y-2'>
              <p className='text-xs font-semibold'>回答依据（点击可回到原文）</p>
              {message.citations.map((citation, index) => (
                <button
                  key={citation.id ?? `${message.id}-${citation.blockId}`}
                  className='block w-full rounded-md border p-2 text-left text-sm'
                  style={{ borderColor: '#2563eb', color: foreground }}
                  aria-label={`引用 ${index + 1}：${citation.blockId}`}
                  onClick={() => navigateToCitation(citation)}
                >
                  <span className='block font-semibold text-blue-500'>
                    证据 {index + 1} · {blockLabel(citation.blockId)}
                  </span>
                  <span className='block text-xs' style={{ color: muted }}>
                    {sectionLabel(citation.blockId)}
                  </span>
                  <q className='mt-1 block line-clamp-3'>{citation.exactQuote}</q>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );

  return (
    <main
      className='min-h-screen px-4 py-5'
      style={{ backgroundColor: surface, color: foreground }}
    >
      <style>{`
        ::highlight(${ANNOTATION_HIGHLIGHT}) {
          text-decoration: underline rgba(59, 130, 246, 0.55) 1px;
          text-underline-offset: 0.22em;
        }
        ::highlight(${CITATION_HIGHLIGHT}) {
          background-color: #fde047;
          color: #111827;
        }
      `}</style>
      <header className='mx-auto mb-4 flex max-w-[96rem] flex-wrap items-center justify-between gap-3'>
        <div>
          <p className='text-sm font-semibold text-blue-600'>NL-270 · Markdown 对话批注 Alpha</p>
          <div className='text-2xl font-bold'>{documentModel.title}</div>
          <p className='mt-1 text-sm' style={{ color: muted }}>
            {documentModel.sections.length} 章 · {documentModel.blocks.length} 个编号源块 ·{' '}
            {documentModel.sourceFormat === 'markdown' ? '用户 Markdown' : '内置测试文档'}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <label className='btn btn-primary btn-sm cursor-pointer'>
            导入 Markdown
            <input
              aria-label='导入 Markdown'
              className='hidden'
              type='file'
              accept='.md,.markdown,text/markdown,text/plain'
              onChange={(event) => void importMarkdown(event.target.files?.[0])}
            />
          </label>
          <a className='btn btn-sm' href='/'>
            打开原版书库
          </a>
          <button className='btn btn-sm' onClick={() => setDark((value) => !value)}>
            切换主题
          </button>
          <button
            className='btn btn-sm'
            aria-label={sidebarOpen ? '收起批注栏' : '展开批注栏'}
            onClick={() => setSidebarOpen((value) => !value)}
          >
            {sidebarOpen ? '收起批注栏' : '展开批注栏'}
          </button>
          <button
            className='btn btn-sm'
            onClick={() => {
              store?.clear();
              setDocumentModel(SOURCE_DOC_FIXTURE);
              setAnchor(null);
              setThreads([]);
              setActiveThreadId(null);
            }}
          >
            清空测试数据
          </button>
        </div>
      </header>
      {importStatus ? (
        <p
          role='status'
          className='mx-auto mb-3 max-w-[96rem] rounded-md bg-blue-100 p-2 text-sm text-blue-950'
        >
          {importStatus}
        </p>
      ) : null}

      <section
        aria-label='阅读显示设置'
        className='eink-bordered mx-auto mb-4 max-w-[96rem] rounded-xl px-4 py-2 shadow-sm'
        style={{ backgroundColor: panel }}
      >
        <button
          type='button'
          className='flex w-full items-center justify-between py-1 text-sm font-semibold'
          aria-label={settingsOpen ? '收起阅读显示设置' : '展开阅读显示设置'}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          <span>阅读显示设置</span>
          <span aria-hidden='true'>{settingsOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {settingsOpen ? (
          <div className='mt-2 grid gap-x-6 gap-y-2 border-t pt-3 sm:grid-cols-3'>
            {(
              [
                ['contentWidth', '正文宽度', 520, 1000, 20, `${readingSettings.contentWidth} px`],
                ['fontSize', '正文字号', 14, 28, 1, `${readingSettings.fontSize} px`],
                ['lineHeight', '正文行距', 1.35, 2.4, 0.05, readingSettings.lineHeight.toFixed(2)],
              ] as const
            ).map(([key, label, minimum, maximum, step, display]) => (
              <label key={key} className='flex min-w-0 items-center gap-3 text-sm'>
                <span className='w-20 shrink-0 font-medium'>{label}</span>
                <input
                  aria-label={label}
                  className='range range-xs min-w-0 flex-1'
                  type='range'
                  min={minimum}
                  max={maximum}
                  step={step}
                  value={readingSettings[key]}
                  onChange={(event) => updateReadingSetting(key, Number(event.target.value))}
                />
                <span className='w-14 shrink-0 text-right text-xs' style={{ color: muted }}>
                  {display}
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <div className='mx-auto flex max-w-[96rem] items-start justify-center gap-4'>
        <article
          className='min-w-0 rounded-xl px-5 py-8 shadow-sm sm:px-10'
          style={{
            backgroundColor: panel,
            color: foreground,
            fontSize: `${readingSettings.fontSize}px`,
            lineHeight: readingSettings.lineHeight,
            width: `${readingSettings.contentWidth}px`,
            maxWidth: '100%',
          }}
          aria-label='SOURCE_DOC 阅读区'
          onMouseUp={captureSelection}
        >
          {documentModel.blocks.map((item) => {
            const highlighted = highlightedCitation?.blockId === item.id;
            const blockThreads = threadsByBlock.get(item.id) ?? [];
            const previewThread =
              blockThreads.find((candidate) => candidate.status === 'active') ?? blockThreads[0];
            return (
              <section
                key={item.id}
                data-block-id={item.id}
                data-testid={`source-block-${item.id}`}
                data-highlighted={highlighted ? 'true' : 'false'}
                className={`relative scroll-m-24 pl-1 ${item.type === 'heading' ? 'mb-5 mt-9 first:mt-0' : 'mb-[1em]'}`}
                style={{ color: highlighted ? '#111827' : foreground }}
              >
                {previewThread ? (
                  <button
                    className='eink-bordered absolute right-full top-[0.15em] mr-3 flex h-7 min-w-7 items-center justify-center rounded-full border border-blue-500/40 bg-blue-50 px-1.5 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100 focus-visible:outline-2 focus-visible:outline-blue-500'
                    aria-label={`打开${blockLabel(item.id)} 的批注，共 ${blockThreads.length} 条`}
                    title={`${previewThread.title}：${previewThread.messages.at(-1)?.content ?? ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectThread(previewThread);
                    }}
                  >
                    {blockThreads.length > 1 ? blockThreads.length : '●'}
                  </button>
                ) : null}
                <div
                  data-source-text={item.id}
                  className='source-markdown [&_p]:m-0'
                  style={{ backgroundColor: highlighted ? '#fef08a' : undefined }}
                  onPointerDown={(event) => {
                    sourcePointerStart.current = { x: event.clientX, y: event.clientY };
                  }}
                  onClick={(event) => openThreadAtPointer(event, blockThreads)}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {markdownSource(item)}
                  </ReactMarkdown>
                </div>
              </section>
            );
          })}
        </article>

        {sidebarOpen ? (
          <>
            <div
              role='separator'
              aria-label='调整批注栏宽度'
              aria-orientation='vertical'
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={readingSettings.sidebarWidth}
              className='sticky top-4 hidden h-[calc(100vh-2rem)] w-2 shrink-0 cursor-col-resize touch-none rounded-full bg-transparent hover:bg-blue-500/20 lg:block'
              onPointerDown={(event) => {
                sidebarDrag.current = {
                  startX: event.clientX,
                  startWidth: readingSettings.sidebarWidth,
                };
                globalThis.document.body.style.cursor = 'col-resize';
                globalThis.document.body.style.userSelect = 'none';
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                updateReadingSetting(
                  'sidebarWidth',
                  Math.min(
                    SIDEBAR_MAX_WIDTH,
                    Math.max(
                      SIDEBAR_MIN_WIDTH,
                      readingSettings.sidebarWidth + (event.key === 'ArrowLeft' ? 10 : -10),
                    ),
                  ),
                );
              }}
              tabIndex={0}
            />
            <aside
              className='eink-bordered fixed inset-y-3 right-3 z-40 max-h-[calc(100vh-1.5rem)] max-w-[calc(100vw-1.5rem)] shrink-0 overflow-y-auto rounded-xl p-4 shadow-xl lg:sticky lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:shadow-sm'
              style={{
                backgroundColor: panel,
                color: foreground,
                width: readingSettings.sidebarWidth,
              }}
              aria-label='对话批注'
            >
              <div className='mb-1 flex items-center justify-between gap-2'>
                <h2 className='text-lg font-bold'>对话批注</h2>
                <button
                  className='btn btn-ghost btn-sm'
                  aria-label='关闭批注栏'
                  onClick={() => setSidebarOpen(false)}
                >
                  收起
                </button>
              </div>
              <p className='mb-3 text-xs' style={{ color: muted }}>
                选择连续文字可新建批注；点击左侧标记、带下划线的原文或列表可打开旧批注。
              </p>
              <div className='mb-3 rounded-md p-3 text-sm' style={{ backgroundColor: mutedPanel }}>
                {anchor ? (
                  <div>
                    <p className='mb-1 text-xs font-semibold'>
                      当前锚点 · {anchor.selectedBlockIds.length} 块
                    </p>
                    <q data-testid='active-quote' className='whitespace-pre-line'>
                      {anchor.exactQuote}
                    </q>
                  </div>
                ) : (
                  '请先在左侧选择一段文字'
                )}
              </div>
              {selectionError ? (
                <p className='mb-3 text-sm text-red-500'>{selectionError}</p>
              ) : null}

              {activeThread ? (
                <div
                  className='mb-3 rounded-lg border p-3'
                  style={{ borderColor: dark ? '#4b5563' : '#d1d5db' }}
                >
                  {editingTitle ? (
                    <div className='flex gap-2'>
                      <input
                        aria-label='批注标题'
                        className='input input-sm input-bordered min-w-0 flex-1'
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                      />
                      <button className='btn btn-sm btn-contrast' onClick={renameActiveThread}>
                        保存标题
                      </button>
                    </div>
                  ) : (
                    <div className='flex items-start justify-between gap-2'>
                      <div>
                        <p className='font-bold'>{activeThread.title}</p>
                        {activeThread.status === 'archived' ? (
                          <span className='badge badge-sm'>已归档</span>
                        ) : null}
                      </div>
                      <button
                        className='btn btn-ghost btn-xs'
                        aria-label='重命名批注'
                        onClick={() => {
                          setTitleDraft(activeThread.title);
                          setEditingTitle(true);
                        }}
                      >
                        重命名
                      </button>
                    </div>
                  )}
                  <div className='mt-2 flex flex-wrap gap-2'>
                    <button className='btn btn-xs' aria-label='归档批注' onClick={toggleArchive}>
                      {activeThread.status === 'archived' ? '取消归档' : '归档'}
                    </button>
                    <button className='btn btn-xs text-red-600' onClick={deleteActiveThread}>
                      删除
                    </button>
                  </div>
                </div>
              ) : null}

              {activeThread ? (
                <div className='mb-4 max-h-72 overflow-y-auto'>
                  {threadConversation(activeThread)}
                </div>
              ) : null}
              {navigationStatus ? (
                <p role='status' className='mb-3 text-sm font-semibold text-green-600'>
                  {navigationStatus}
                </p>
              ) : null}
              <label className='form-control'>
                <span className='label-text mb-1'>问题</span>
                <textarea
                  className='textarea textarea-bordered eink-bordered'
                  style={{ backgroundColor: mutedPanel, color: foreground }}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder='针对所选原文提问'
                />
              </label>
              <button
                aria-label='提问'
                className='btn btn-contrast mt-3 w-full'
                disabled={!anchor}
                onClick={ask}
              >
                {activeThreadId ? '继续追问' : '新建批注并提问'}
              </button>

              <div
                className='mt-5 border-t pt-4'
                style={{ borderColor: dark ? '#4b5563' : '#d1d5db' }}
              >
                <div className='mb-2 flex items-center justify-between'>
                  <h3 className='font-bold'>全部批注（{threads.length}）</h3>
                  <button
                    className='btn btn-ghost btn-xs'
                    aria-label='显示已归档'
                    onClick={() => setShowArchived((value) => !value)}
                  >
                    {showArchived ? '隐藏归档' : '显示已归档'}
                  </button>
                </div>
                <input
                  aria-label='搜索批注'
                  className='input input-sm input-bordered mb-2 w-full'
                  placeholder='搜索标题、原文或对话'
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className='max-h-72 space-y-2 overflow-y-auto'>
                  {visibleThreads.map((item) => (
                    <button
                      key={item.id}
                      className='block w-full rounded-md border p-2 text-left text-sm'
                      style={{
                        borderColor:
                          item.id === activeThreadId ? '#2563eb' : dark ? '#4b5563' : '#d1d5db',
                      }}
                      onClick={() => selectThread(item)}
                    >
                      <span className='block font-semibold'>{item.title}</span>
                      <span className='block truncate text-xs' style={{ color: muted }}>
                        {blockLabel(item.anchor.blockId)} ·{' '}
                        {item.status === 'archived' ? '已归档' : `${item.messages.length} 条消息`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <p className='mt-3 text-xs' style={{ color: muted }}>
                当前不接真实模型；每次回答仅从内置固定候选中本地随机选择，不发生网络请求。
              </p>
            </aside>
          </>
        ) : null}
      </div>
    </main>
  );
}
