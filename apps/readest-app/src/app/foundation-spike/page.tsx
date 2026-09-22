'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createRangeAnchor,
  type SourceDocAnchor,
  type SourceDocCitation,
  type SourceDocFixture,
  type SourceDocThread,
} from '@/services/foundation/sourceDocSpike';

export default function FoundationSpike() {
  const [documentModel, setDocumentModel] = useState<SourceDocFixture>(SOURCE_DOC_FIXTURE);
  const [anchor, setAnchor] = useState<SourceDocAnchor | null>(null);
  const [threads, setThreads] = useState<SourceDocThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
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
  const [largeText, setLargeText] = useState(false);
  const [dark, setDark] = useState(false);
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
  }, [store]);

  useEffect(() => {
    if (!openThreadId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenThreadId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [openThreadId]);

  const activeThread = threads.find((item) => item.id === activeThreadId) ?? null;
  const openThread = threads.find((item) => item.id === openThreadId) ?? null;
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

  const selectThread = (thread: SourceDocThread, open = false) => {
    setActiveThreadId(thread.id);
    setAnchor(thread.anchor);
    if (open) setOpenThreadId(thread.id);
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
    setOpenThreadId(null);
    refreshThreads(null);
  };

  const blockLabel = (blockId: string) => {
    const index = documentModel.blocks.findIndex((item) => item.id === blockId);
    return `源块 ${String(index + 1).padStart(2, '0')}`;
  };
  const sectionLabel = (blockId: string) => {
    const block = documentModel.blocks.find((item) => item.id === blockId);
    return documentModel.sections.find((item) => item.id === block?.sectionId)?.title ?? '';
  };
  const renderBlockText = (blockId: string, text: string) => {
    if (highlightedCitation?.blockId !== blockId) return text;
    const quoteOffset = text.indexOf(highlightedCitation.exactQuote);
    if (quoteOffset < 0) return text;
    return (
      <>
        {text.slice(0, quoteOffset)}
        <mark
          data-testid='citation-highlight'
          className='rounded bg-yellow-300 px-0.5 text-neutral-950'
        >
          {highlightedCitation.exactQuote}
        </mark>
        {text.slice(quoteOffset + highlightedCitation.exactQuote.length)}
      </>
    );
  };

  const surface = dark ? '#111827' : '#f3f4f6';
  const panel = dark ? '#1f2937' : '#ffffff';
  const mutedPanel = dark ? '#374151' : '#e5e7eb';
  const foreground = dark ? '#f9fafb' : '#111827';
  const muted = dark ? '#d1d5db' : '#4b5563';

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
    <main className='min-h-screen p-5' style={{ backgroundColor: surface, color: foreground }}>
      <header className='mx-auto mb-4 flex max-w-7xl flex-wrap items-center justify-between gap-3'>
        <div>
          <p className='text-sm font-semibold text-blue-600'>NL-270 · Markdown 对话批注 Alpha</p>
          <h1 className='text-2xl font-bold'>{documentModel.title}</h1>
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
          <button className='btn btn-sm' onClick={() => setLargeText((value) => !value)}>
            切换字号
          </button>
          <button className='btn btn-sm' onClick={() => setDark((value) => !value)}>
            切换主题
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
          className='mx-auto mb-3 max-w-7xl rounded-md bg-blue-100 p-2 text-sm text-blue-950'
        >
          {importStatus}
        </p>
      ) : null}

      <div className='mx-auto grid max-w-7xl gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]'>
        <article
          className={`rounded-xl p-6 shadow-sm ${largeText ? 'text-xl' : 'text-base'}`}
          style={{ backgroundColor: panel, color: foreground }}
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
                className='mb-3 scroll-m-24 rounded-lg border p-3 transition-colors'
                style={{
                  backgroundColor: highlighted ? '#fef08a' : mutedPanel,
                  borderColor: highlighted ? '#ca8a04' : dark ? '#4b5563' : '#d1d5db',
                  color: highlighted ? '#111827' : foreground,
                }}
              >
                <div className='mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide opacity-70'>
                  <span>{blockLabel(item.id)}</span>
                  <span>{item.type}</span>
                </div>
                {item.type === 'heading' ? (
                  <h2 data-source-text={item.id} className='text-xl font-bold'>
                    {renderBlockText(item.id, item.semanticText)}
                  </h2>
                ) : item.type === 'code' || item.type === 'table' || item.type === 'list' ? (
                  <pre data-source-text={item.id} className='whitespace-pre-wrap font-mono'>
                    {renderBlockText(item.id, item.semanticText)}
                  </pre>
                ) : (
                  <p data-source-text={item.id}>{renderBlockText(item.id, item.semanticText)}</p>
                )}
                {previewThread ? (
                  <button
                    className='eink-bordered mt-3 block w-full rounded-lg border-l-4 border-blue-500 bg-blue-50 p-2 text-left text-sm text-blue-950'
                    aria-label={`打开${blockLabel(item.id)} 的批注，共 ${blockThreads.length} 条`}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectThread(previewThread, true);
                    }}
                  >
                    <span className='block text-xs font-bold'>
                      批注预览 · {blockThreads.length} 条
                      {previewThread.status === 'archived' ? ' · 已归档' : ''}
                    </span>
                    <span className='block truncate font-semibold'>{previewThread.title}</span>
                    <span className='block truncate'>{previewThread.messages.at(-1)?.content}</span>
                  </button>
                ) : null}
              </section>
            );
          })}
        </article>

        <aside
          className='eink-bordered h-fit rounded-xl p-4 shadow-sm'
          style={{ backgroundColor: panel, color: foreground }}
          aria-label='对话批注'
        >
          <h2 className='text-lg font-bold'>对话批注</h2>
          <p className='mb-3 text-xs' style={{ color: muted }}>
            选择连续文字可新建批注；点击正文小卡片或列表可原位打开旧批注。
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
          {selectionError ? <p className='mb-3 text-sm text-red-500'>{selectionError}</p> : null}

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
                <button className='btn btn-xs' onClick={() => setOpenThreadId(activeThread.id)}>
                  打开完整对话
                </button>
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
            <div className='mb-4 max-h-72 overflow-y-auto'>{threadConversation(activeThread)}</div>
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

          <div className='mt-5 border-t pt-4' style={{ borderColor: dark ? '#4b5563' : '#d1d5db' }}>
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
      </div>

      {openThread ? (
        <div
          className='fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-4 sm:items-center'
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpenThreadId(null);
          }}
        >
          <section
            role='dialog'
            aria-modal='true'
            aria-label='完整批注对话'
            className='eink-bordered max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl p-5 shadow-xl'
            style={{ backgroundColor: panel, color: foreground }}
          >
            <div className='mb-3 flex items-start justify-between gap-3'>
              <div>
                <p className='text-xs font-semibold text-blue-500'>
                  {blockLabel(openThread.anchor.blockId)} ·{' '}
                  {sectionLabel(openThread.anchor.blockId)}
                </p>
                <h2 className='text-xl font-bold'>{openThread.title}</h2>
                <q className='mt-1 block text-sm' style={{ color: muted }}>
                  {openThread.anchor.exactQuote}
                </q>
              </div>
              <button
                autoFocus
                className='btn btn-sm'
                aria-label='关闭完整对话'
                onClick={() => setOpenThreadId(null)}
              >
                关闭
              </button>
            </div>
            {threadConversation(openThread)}
          </section>
        </div>
      ) : null}
    </main>
  );
}
