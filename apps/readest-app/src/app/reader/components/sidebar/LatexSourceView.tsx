import { useEffect, useMemo, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import {
  loadLatexSourceSidecar,
  type LatexSourceBlock,
  type LatexSourceSidecar,
} from '@/services/foundation/latexSource';

const blockHeading = (block: LatexSourceBlock) =>
  `${block.label} · ${block.sourceFile}:${block.startLine}`;

export default function LatexSourceView({ bookKey }: { bookKey: string }) {
  const { appService } = useEnv();
  const book = useBookDataStore((state) => state.getBookData(bookKey)?.book);
  const [sidecar, setSidecar] = useState<LatexSourceSidecar | null>(null);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!appService || !book) return;
    void loadLatexSourceSidecar(appService, book).then((loaded) => {
      if (!cancelled) setSidecar(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [appService, book]);

  const visibleBlocks = useMemo(() => {
    if (!sidecar) return [];
    const term = query.trim().toLocaleLowerCase();
    if (!term) return sidecar.blocks;
    return sidecar.blocks.filter((block) =>
      `${block.label} ${block.semanticText} ${block.sourceText}`.toLocaleLowerCase().includes(term),
    );
  }, [query, sidecar]);

  if (!sidecar) {
    return <p className='text-base-content/60 p-4 text-sm'>这本 PDF 没有配对的 LaTeX 原文。</p>;
  }

  return (
    <section className='flex h-full min-h-0 flex-col' aria-label='LaTeX 原文'>
      <div className='border-base-300 border-b p-3'>
        <div className='font-semibold'>{sidecar.title}</div>
        <div className='text-base-content/65 mt-1 text-xs'>
          阅读版：{sidecar.pdf.name} · 原文：{sidecar.source.name}
        </div>
        <div className='mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-xs'>
          当前为页级关联：可以查看和引用原文，但不会伪装成精确框选。
        </div>
        <input
          className='input input-sm input-bordered mt-3 w-full'
          aria-label='搜索 LaTeX 原文'
          placeholder='搜索章节、定理、证明或公式'
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-3'>
        {visibleBlocks.map((block) => {
          const expanded = expandedBlockId === block.id;
          return (
            <article className='border-base-300 rounded-lg border p-3' key={block.id}>
              <div className='text-base-content/60 text-[11px]'>{blockHeading(block)}</div>
              <p className='mt-1 whitespace-pre-wrap text-sm'>{block.semanticText}</p>
              <button
                type='button'
                className='btn btn-ghost btn-xs mt-2'
                aria-expanded={expanded}
                onClick={() => setExpandedBlockId(expanded ? null : block.id)}
              >
                {expanded ? '收起原文' : '查看原文'}
              </button>
              {expanded ? (
                <pre className='bg-base-300 mt-2 overflow-x-auto whitespace-pre-wrap rounded-md p-2 text-xs'>
                  {block.sourceText}
                </pre>
              ) : null}
            </article>
          );
        })}
        {visibleBlocks.length === 0 ? (
          <p className='text-base-content/60 py-6 text-center text-sm'>没有匹配的原文。</p>
        ) : null}
      </div>
    </section>
  );
}
