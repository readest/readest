'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  SOURCE_DOC_FIXTURE,
  SourceDocSpikeStore,
  createSelectionAnchor,
  type SourceDocAnchor,
  type SourceDocCitation,
  type SourceDocThread,
} from '@/services/foundation/sourceDocSpike';

export default function FoundationSpike() {
  const [anchor, setAnchor] = useState<SourceDocAnchor | null>(null);
  const [thread, setThread] = useState<SourceDocThread | null>(null);
  const [question, setQuestion] = useState('');
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(null);
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

  const captureSelection = (blockId: string) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? '';
    const selectedBlock = SOURCE_DOC_FIXTURE.blocks.find((block) => block.id === blockId);
    if (!selectedBlock || !selectedText) return;
    const startOffset = selectedBlock.semanticText.indexOf(selectedText);
    if (startOffset < 0) return;
    setAnchor(createSelectionAnchor(selectedBlock, startOffset, startOffset + selectedText.length));
  };

  const ask = () => {
    if (!store || !anchor || !question.trim()) return;
    setThread(store.ask(SOURCE_DOC_FIXTURE, anchor, question.trim()));
    setQuestion('');
  };

  const navigateToCitation = (citation: SourceDocCitation) => {
    setHighlightedBlockId(citation.blockId);
    document.querySelector(`[data-block-id="${citation.blockId}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  return (
    <main
      className={`min-h-screen p-5 ${dark ? 'bg-neutral-900 text-neutral-100' : 'bg-neutral-100 text-neutral-900'}`}
    >
      <header className='mx-auto mb-4 flex max-w-6xl flex-wrap items-center justify-between gap-3'>
        <div>
          <p className='text-sm font-semibold text-blue-600'>NL-270 · Foundation Spike</p>
          <h1 className='text-2xl font-bold'>{SOURCE_DOC_FIXTURE.title}</h1>
        </div>
        <div className='flex gap-2'>
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
          className={`rounded-xl bg-base-100 p-6 shadow-sm ${largeText ? 'text-xl' : 'text-base'}`}
          aria-label='SOURCE_DOC 阅读区'
        >
          {SOURCE_DOC_FIXTURE.blocks.map((item) => {
            const className = `mb-4 scroll-m-24 rounded-md px-2 py-1 transition-colors ${
              highlightedBlockId === item.id ? 'bg-yellow-200 text-neutral-900' : ''
            }`;
            const common = {
              'data-block-id': item.id,
              'data-testid': `source-block-${item.id}`,
              'data-highlighted': highlightedBlockId === item.id ? 'true' : 'false',
              onMouseUp: () => captureSelection(item.id),
              className,
            };
            return item.type === 'heading' ? (
              <h2 key={item.id} {...common} className={`${className} mt-6 text-xl font-bold`}>
                {item.semanticText}
              </h2>
            ) : (
              <p key={item.id} {...common}>
                {item.semanticText}
              </p>
            );
          })}
        </article>

        <aside
          className='eink-bordered h-fit rounded-xl bg-base-100 p-4 shadow-sm'
          aria-label='对话批注'
        >
          <h2 className='mb-3 text-lg font-bold'>对话批注</h2>
          <div className='mb-4 rounded-md bg-base-200 p-3 text-sm'>
            {anchor ? (
              <q data-testid='active-quote'>{anchor.exactQuote}</q>
            ) : (
              '请先在左侧选择一段文字'
            )}
          </div>

          <div className='mb-4 max-h-96 space-y-3 overflow-y-auto'>
            {thread?.messages.map((message) => (
              <div key={message.id} className='rounded-md border border-base-300 p-3'>
                <p className='mb-1 text-xs font-semibold uppercase'>{message.role}</p>
                <p>{message.content}</p>
                {message.citations.length > 0 ? (
                  <div className='mt-2 flex flex-wrap gap-2'>
                    {message.citations.map((citation, index) => (
                      <button
                        key={`${message.id}-${citation.blockId}`}
                        className='btn btn-xs btn-outline'
                        aria-label={`引用 ${index + 1}：${citation.blockId}`}
                        onClick={() => navigateToCitation(citation)}
                      >
                        引用 {index + 1}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <label className='form-control'>
            <span className='label-text mb-1'>问题</span>
            <textarea
              className='textarea textarea-bordered eink-bordered'
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder='针对所选原文提问'
            />
          </label>
          <button className='btn btn-contrast mt-3 w-full' disabled={!anchor} onClick={ask}>
            提问
          </button>
          <p className='mt-3 text-xs opacity-60'>回答由固定 stub 生成，不访问网络或真实模型。</p>
        </aside>
      </div>
    </main>
  );
}
