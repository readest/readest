'use client';

import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { loadLatexSource, loadSyncTex, type LatexSourceSidecar } from '@/services/latexSource';
import { sendPdfSourceTarget } from '@/services/pdfSourceNavigation';
import {
  cancelLocalLatex,
  compileLocalLatex,
  detectLocalLatexEngines,
  saveLocalLatexOutput,
  type LatexEngine,
  type LocalLatexResult,
} from '@/services/localLatex';
import {
  findPdfLocation,
  findSourceLocation,
  parseSyncTex,
  type SyncTexIndex,
  type SyncTexLocation,
} from '@/services/syncTex';
import { parseLatexSourceWindowQuery, type SourceWindowRequest } from './sourceWindowQuery';

type LoadState =
  | { status: 'loading' }
  | {
      status: 'ready';
      source: LatexSourceSidecar;
      syncTex: SyncTexIndex | null;
      location: SyncTexLocation | null;
    }
  | { status: 'error'; message: string };

export default function LatexSourcePage() {
  const { appService } = useEnv();
  const [windowRequest, setWindowRequest] = useState<SourceWindowRequest | null>(() =>
    typeof window === 'undefined'
      ? null
      : parseLatexSourceWindowQuery(window.location.search.slice(1)),
  );
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [navigationError, setNavigationError] = useState('');
  const [localEngines, setLocalEngines] = useState<LatexEngine[] | null>(null);
  const [selectedEngine, setSelectedEngine] = useState<LatexEngine | ''>('');
  const [compileJobId, setCompileJobId] = useState('');
  const [compileResult, setCompileResult] = useState<LocalLatexResult | null>(null);
  const [compileError, setCompileError] = useState('');

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebviewWindow()
      .listen<SourceWindowRequest>('source-location-requested', (event) => {
        setWindowRequest(event.payload);
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!appService || !windowRequest) return;
    let cancelled = false;
    setLoadState({ status: 'loading' });
    void appService
      .loadLibraryBooks()
      .then(async (library) => {
        const hash = windowRequest.request.bookKey.split('-')[0]!;
        const book = library.find((item) => item.hash === hash && !item.deletedAt);
        if (!book) throw new Error('这份 PDF 已不在书库中。');
        const source = await loadLatexSource(appService, book);
        if (!source) throw new Error('这份 PDF 尚未关联可读取的 LaTeX 源文件。');
        let syncTex: SyncTexIndex | null = null;
        let location: SyncTexLocation | null = null;
        const { pdfX, pdfY, page } = windowRequest.request;
        if (source.syncTexName) {
          const mapping = await loadSyncTex(appService, book);
          if (mapping) {
            try {
              syncTex = parseSyncTex(mapping);
              if (pdfX != null && pdfY != null) {
                location = findSourceLocation(syncTex, page, pdfX, pdfY);
              }
            } catch {
              syncTex = null;
            }
          }
        }
        if (!cancelled) setLoadState({ status: 'ready', source, syncTex, location });
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadState({
            status: 'error',
            message: error instanceof Error ? error.message : 'LaTeX 源文件加载失败。',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [appService, windowRequest]);

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    void detectLocalLatexEngines()
      .then((engines) => {
        setLocalEngines(engines);
        setSelectedEngine(engines[0] ?? '');
      })
      .catch(() => setLocalEngines([]));
  }, []);

  const compileLocally = async () => {
    if (!selectedEngine || loadState.status !== 'ready') return;
    const jobId = crypto.randomUUID();
    setCompileJobId(jobId);
    setCompileResult(null);
    setCompileError('');
    try {
      setCompileResult(await compileLocalLatex(jobId, selectedEngine, loadState.source.rawSource));
    } catch (error) {
      setCompileError(String(error));
    } finally {
      setCompileJobId('');
    }
  };

  const navigateToPdf = async (line: number) => {
    if (!windowRequest || loadState.status !== 'ready') return;
    setNavigationError('');
    try {
      if (!loadState.syncTex) throw new Error('没有可用的 SyncTeX 映射。');
      const location = findPdfLocation(loadState.syncTex, loadState.source.sourceName, line);
      if (!location) throw new Error('这行源码没有对应的 PDF 位置。');
      await sendPdfSourceTarget(windowRequest.readerWindowLabel, {
        bookKey: windowRequest.request.bookKey,
        page: location.page,
        x: location.x,
        y: location.y,
        width: location.width,
        height: location.height,
        depth: location.depth,
      });
    } catch (error) {
      setNavigationError(error instanceof Error ? error.message : '无法跳转到 PDF 位置。');
    }
  };

  return (
    <main className='bg-base-100 text-base-content flex h-screen flex-col overflow-hidden'>
      <header className='border-base-300 flex shrink-0 items-center justify-between border-b px-5 py-3'>
        <div>
          <h1 className='text-base font-semibold'>LaTeX 源代码</h1>
          <p className='text-base-content/60 text-xs'>独立只读源码窗口</p>
        </div>
        {windowRequest && (
          <span className='bg-base-200 rounded-md px-2 py-1 text-xs'>
            PDF 第 {windowRequest.request.page} 页
          </span>
        )}
      </header>

      {!windowRequest ? (
        <div className='m-auto max-w-md px-6 text-center'>源码定位请求无效。</div>
      ) : loadState.status === 'loading' ? (
        <div className='m-auto' role='status'>
          正在加载 LaTeX 源文件…
        </div>
      ) : loadState.status === 'error' ? (
        <div className='m-auto max-w-lg px-6 text-center' role='alert'>
          <p className='font-medium'>无法打开源码</p>
          <p className='text-base-content/60 mt-2 text-sm'>{loadState.message}</p>
          <p className='text-base-content/60 mt-4 text-xs'>
            请重新导入 PDF，并同时选择同名的 .tex 文件。
          </p>
        </div>
      ) : (
        <>
          <div
            className={`text-base-content border-b px-5 py-2 text-xs ${
              loadState.location
                ? 'border-success/30 bg-success/10'
                : 'border-warning/30 bg-warning/10'
            }`}
          >
            {loadState.location
              ? `SyncTeX 已将 PDF 选区定位到源码第 ${loadState.location.line} 行。`
              : '未找到可用的 SyncTeX 映射。已打开真实源文件，但无法精确定位源码行。'}
          </div>
          <div className='bg-base-200/40 border-base-300 flex shrink-0 items-center gap-2 border-b px-5 py-2 text-xs'>
            <span className='font-medium'>{loadState.source.sourceName}</span>
            <span className='text-base-content/50 truncate'>
              PDF 选区：{windowRequest.request.text}
            </span>
            {isTauriAppPlatform() && localEngines && (
              <div className='ml-auto flex shrink-0 items-center gap-2'>
                {localEngines.length === 0 ? (
                  <span className='text-base-content/50'>未检测到本机 LaTeX 引擎</span>
                ) : (
                  <>
                    <select
                      className='select select-bordered select-xs eink-bordered'
                      aria-label='本机 LaTeX 引擎'
                      value={selectedEngine}
                      disabled={!!compileJobId}
                      onChange={(event) => setSelectedEngine(event.target.value as LatexEngine)}
                    >
                      {localEngines.map((engine) => (
                        <option key={engine}>{engine}</option>
                      ))}
                    </select>
                    {compileJobId ? (
                      <button
                        type='button'
                        className='btn btn-ghost btn-xs eink-bordered'
                        onClick={() => void cancelLocalLatex(compileJobId)}
                      >
                        取消编译
                      </button>
                    ) : (
                      <button
                        type='button'
                        className='btn btn-contrast btn-xs'
                        onClick={() => void compileLocally()}
                      >
                        使用本机编译
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {compileResult && (
            <div className='border-success/30 bg-success/10 border-b px-5 py-2 text-xs'>
              <div className='flex items-center gap-2'>
                <span>已用 {compileResult.engine} 编译；当前阅读中的 PDF 未被替换。</span>
                <button
                  type='button'
                  className='btn btn-ghost btn-xs eink-bordered ml-auto'
                  onClick={() =>
                    void saveLocalLatexOutput(
                      'pdf',
                      loadState.source.sourceName,
                      compileResult.pdfBase64,
                    )
                  }
                >
                  另存 PDF
                </button>
                <button
                  type='button'
                  className='btn btn-ghost btn-xs eink-bordered'
                  onClick={() =>
                    void saveLocalLatexOutput(
                      'synctex',
                      loadState.source.sourceName,
                      compileResult.syncTexBase64,
                    )
                  }
                >
                  另存 SyncTeX
                </button>
              </div>
              <details className='mt-1'>
                <summary>编译日志</summary>
                <pre className='mt-2 max-h-40 overflow-auto whitespace-pre-wrap'>
                  {compileResult.log || '编译完成，没有额外输出。'}
                </pre>
              </details>
            </div>
          )}
          {compileError && (
            <details className='border-error/30 bg-error/10 border-b px-5 py-2 text-xs'>
              <summary>本机 LaTeX 编译失败</summary>
              <pre className='mt-2 max-h-40 overflow-auto whitespace-pre-wrap'>{compileError}</pre>
            </details>
          )}
          {navigationError && (
            <div className='border-error/30 bg-error/10 border-b px-5 py-2 text-xs' role='alert'>
              {navigationError}
            </div>
          )}
          <ol
            className='selection:bg-primary/25 flex-1 overflow-auto py-5 font-mono text-sm leading-6'
            data-testid='latex-source-content'
          >
            {loadState.source.rawSource.split('\n').map((line, index) => {
              const lineNumber = index + 1;
              const mapped = loadState.location?.line === lineNumber;
              return (
                <li
                  key={lineNumber}
                  ref={
                    mapped ? (element) => element?.scrollIntoView({ block: 'center' }) : undefined
                  }
                  className={`grid grid-cols-[4rem_1fr] px-5 whitespace-pre ${
                    mapped ? 'bg-primary/15' : ''
                  }`}
                  data-source-line={lineNumber}
                >
                  <button
                    type='button'
                    className='text-base-content/35 hover:text-primary w-fit cursor-pointer select-none'
                    title={`在 PDF 中查看第 ${lineNumber} 行`}
                    onClick={() => void navigateToPdf(lineNumber)}
                  >
                    {lineNumber}
                  </button>
                  <code>{line || ' '}</code>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
