'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createRangeAnchor,
  type SourceDocAnchor,
  type SourceDocCitation,
  type SourceDocThread,
} from '@/services/foundation/sourceDocSpike';

export default function FoundationSpike() {
  const [anchor, setAnchor] = useState<SourceDocAnchor | null>(null);
  const [thread, setThread] = useState<SourceDocThread | null>(null);
  const [question, setQuestion] = useState('');
  const [highlightedCitation, setHighlightedCitation] = useState<SourceDocCitation | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [navigationStatus, setNavigationStatus] = useState('');
  const [largeText, setLargeText] = useState(false);
  const [dark, setDark] = useState(false);
  const store = useMemo(
    () => (typeof window === 'undefined' ? null : new SourceDocSpikeStore(window.localStorage)),
    [],
  );

  useEffect(() => {
    const restored = store?.load() ?? null;
    setThread(restored);
    setAnchor(restored?.anchor ?? null);
  }, [store]);

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
    const sourceTexts = Array.from(document.querySelectorAll<HTMLElement>('[data-source-text]'));
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
      const prefix = document.createRange();
      prefix.selectNodeContents(element);
      prefix.setEnd(container, offset);
      return prefix.toString().length;
    };

    try {
      setAnchor(
        createRangeAnchor(
          SOURCE_DOC_FIXTURE,
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
      setSelectionError('');
    } catch {
      setSelectionError('选区无法建立锚点，请从前向后选择连续正文。');
    }
  };

  const ask = () => {
    if (!store || !anchor || !question.trim()) return;
    setThread(store.ask(SOURCE_DOC_FIXTURE, anchor, question.trim()));
    setQuestion('');
  };

  const navigateToCitation = (citation: SourceDocCitation) => {
    setHighlightedCitation(citation);
    document.querySelector(`[data-block-id="${citation.blockId}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    setNavigationStatus(`已定位到源块 ${citation.blockId.replace('block-', '')}`);
  };

  const blockLabel = (blockId: string) => `源块 ${blockId.replace('block-', '')}`;
  const sectionLabel = (blockId: string) => {
    const block = SOURCE_DOC_FIXTURE.blocks.find((item) => item.id === blockId);
    return SOURCE_DOC_FIXTURE.sections.find((item) => item.id === block?.sectionId)?.title ?? '';
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

  return (
    <main className='min-h-screen p-5' style={{ backgroundColor: surface, color: foreground }}>
      <header className='mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-3'>
        <div>
          <p className='text-sm font-semibold text-blue-600'>NL-270 · Foundation Spike</p>
          <h1 className='text-2xl font-bold'>{SOURCE_DOC_FIXTURE.title}</h1>
          <p className='mt-1 text-sm' style={{ color: muted }}>
            2 章 · {SOURCE_DOC_FIXTURE.blocks.length} 个编号源块 · 本页使用固定测试文档
          </p>
        </div>
        <div className='flex gap-2'>
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
              setAnchor(null);
              setThread(null);
            }}
          >
            清空会话
          </button>
        </div>
      </header>

      <div className='mx-auto grid max-w-6xl gap-4 md:grid-cols-[minmax(0,1fr)_24rem]'>
        <article
          className={`rounded-xl p-6 shadow-sm ${largeText ? 'text-xl' : 'text-base'}`}
          style={{ backgroundColor: panel, color: foreground }}
          aria-label='SOURCE_DOC 阅读区'
          onMouseUp={captureSelection}
        >
          {SOURCE_DOC_FIXTURE.blocks.map((item) => {
            const highlighted = highlightedCitation?.blockId === item.id;
            const className = 'mb-3 scroll-m-24 rounded-lg border p-3 transition-colors';
            const common = {
              'data-block-id': item.id,
              'data-testid': `source-block-${item.id}`,
              'data-highlighted': highlighted ? 'true' : 'false',
              className,
              style: {
                backgroundColor: highlighted ? '#fef08a' : mutedPanel,
                borderColor: highlighted ? '#ca8a04' : dark ? '#4b5563' : '#d1d5db',
                color: highlighted ? '#111827' : foreground,
              },
            };
            return (
              <section key={item.id} {...common}>
                <div className='mb-1 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide opacity-70'>
                  <span>{blockLabel(item.id)}</span>
                  <span>{item.type}</span>
                </div>
                {item.type === 'heading' ? (
                  <h2 data-source-text={item.id} className='text-xl font-bold'>
                    {renderBlockText(item.id, item.semanticText)}
                  </h2>
                ) : item.type === 'code' || item.type === 'table' ? (
                  <pre data-source-text={item.id} className='whitespace-pre-wrap font-mono'>
                    {renderBlockText(item.id, item.semanticText)}
                  </pre>
                ) : (
                  <p data-source-text={item.id}>{renderBlockText(item.id, item.semanticText)}</p>
                )}
              </section>
            );
          })}
        </article>

        <aside
          className='eink-bordered h-fit rounded-xl p-4 shadow-sm'
          style={{ backgroundColor: panel, color: foreground }}
          aria-label='对话批注'
        >
          <h2 className='mb-3 text-lg font-bold'>对话批注</h2>
          <p className='mb-2 text-xs' style={{ color: muted }}>
            先选择一个或多个连续源块中的文字。跨行、跨块均可。
          </p>
          <div className='mb-2 rounded-md p-3 text-sm' style={{ backgroundColor: mutedPanel }}>
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

          <div className='mb-4 max-h-96 space-y-3 overflow-y-auto'>
            {thread?.messages.map((message) => (
              <div
                key={message.id}
                className='rounded-md border p-3'
                style={{ borderColor: dark ? '#4b5563' : '#d1d5db' }}
              >
                <p className='mb-1 text-xs font-semibold uppercase'>{message.role}</p>
                <p>{message.content}</p>
                {message.citations.length > 0 ? (
                  <div className='mt-3 space-y-2'>
                    <p className='text-xs font-semibold'>回答依据（点击可回到原文）</p>
                    {message.citations.map((citation, index) => (
                      <button
                        key={`${message.id}-${citation.blockId}`}
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
          <button className='btn btn-contrast mt-3 w-full' disabled={!anchor} onClick={ask}>
            提问
          </button>
          <p className='mt-3 text-xs' style={{ color: muted }}>
            “打开原版书库”可测试 Readest 已支持格式；新格式导入与完整批注管理属于后续桌面
            alpha。回答由固定 stub 生成。
          </p>
        </aside>
      </div>
    </main>
  );
}
