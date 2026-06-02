'use client';

import { useCallback, useRef, useState } from 'react';
import { MdUploadFile, MdCheckCircle, MdError, MdLink, MdExtension } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { ingestFile } from '@/services/ingestService';
import {
  convertFileIfNeeded,
  convertToEpubWithWorker,
} from '@/services/send/conversion/conversionWorker';
import { getClipOptions } from '@/services/send/clipOptions';
import { invoke } from '@tauri-apps/api/core';
import { LOCAL_ONLY_MODE } from '@/services/featureFlags';
import LocalOnlyRedirect from '@/components/LocalOnlyRedirect';

type ItemStatus = 'working' | 'done' | 'error';

interface SendItem {
  id: string;
  label: string;
  status: ItemStatus;
  detail?: string;
}

/**
 * The Send to Readest web page. Being a Readest client itself, it runs the
 * shared import pipeline directly (no inbox round-trip): drop a file or paste
 * an article URL and it lands in the cloud library, syncing to every device.
 */
export default function SendPage() {
  if (LOCAL_ONLY_MODE) return <LocalOnlyRedirect />;

  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { settings } = useSettingsStore();
  // Direct client fetch only works without CORS, i.e. inside the Tauri
  // webview. On the pure web build the URL flow has no reliable way to scrape
  // the full article (server-proxied fetches lose to bot detection / login
  // walls / JS rendering), so the URL field is hidden and the user is pointed
  // at the browser extension instead.
  const canClipFromUrl = isTauriAppPlatform();

  const [items, setItems] = useState<SendItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setItem = useCallback((id: string, patch: Partial<SendItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const importResolvedFile = useCallback(
    async (file: File, id: string, label: string) => {
      if (!appService) throw new Error('App not ready');
      const { library } = useLibraryStore.getState();
      const book = await ingestFile(
        { file, books: library, forceUpload: true },
        { appService, settings, isLoggedIn: !!user },
      );
      if (!book) throw new Error('Import produced no book');
      await useLibraryStore.getState().updateBooks(envConfig, [book]);
      setItem(id, { status: 'done', label: book.title || label });
    },
    [appService, settings, user, envConfig, setItem],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const id = crypto.randomUUID();
        setItems((prev) => [...prev, { id, label: file.name, status: 'working' }]);
        try {
          const resolved = await convertFileIfNeeded(file);
          await importResolvedFile(resolved, id, file.name);
        } catch (err) {
          setItem(id, {
            status: 'error',
            detail: err instanceof Error ? err.message : _('Import failed'),
          });
        }
      }
    },
    [importResolvedFile, setItem, _],
  );

  const handleUrl = useCallback(async () => {
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) return;
    setUrl('');
    const id = crypto.randomUUID();
    setItems((prev) => [...prev, { id, label: target, status: 'working' }]);
    try {
      // Tauri-only: route through the Rust `clip_url` command which
      // spawns a hidden webview, lets the real browser engine load the
      // URL (so TLS fingerprint + JS challenges resolve naturally) and
      // returns `document.documentElement.outerHTML`. On web we never
      // reach here — the URL field is hidden.
      const html = await invoke<string>('clip_url', { url: target, options: getClipOptions(_) });
      const book = await convertToEpubWithWorker({ kind: 'page', html, url: target });
      await importResolvedFile(book.file, id, book.title);
    } catch (err) {
      const detail =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : _('Could not fetch this page');
      setItem(id, {
        status: 'error',
        detail,
      });
    }
  }, [url, importResolvedFile, setItem, _]);

  if (!user) {
    return (
      <div className='mx-auto flex max-w-[560px] flex-col items-center px-4 py-16 text-center'>
        <h1 className='text-xl font-semibold'>{_('Send to Readest')}</h1>
        <p className='text-base-content/70 mt-2 text-sm'>
          {_('Sign in to send books and articles to your library.')}
        </p>
      </div>
    );
  }

  return (
    <div className='mx-auto flex max-w-[560px] flex-col gap-6 px-4 py-10'>
      <header>
        <h1 className='text-xl font-semibold tracking-tight'>{_('Send to Readest')}</h1>
        <p className='text-base-content/70 mt-1 text-sm'>
          {_('Drop a book or document, or paste an article link. It syncs to all your devices.')}
        </p>
      </header>

      <button
        type='button'
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={`eink-bordered flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-100'
        }`}
      >
        <MdUploadFile className='text-base-content/50 h-8 w-8' />
        <span className='text-sm font-medium'>
          {_('Drop a book or document, or tap to choose')}
        </span>
        <span className='text-base-content/55 text-xs'>
          {_('EPUB, PDF, MOBI, AZW3, FB2, CBZ, TXT, DOCX, RTF, HTML')}
        </span>
      </button>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={(e) => {
          if (e.target.files) void handleFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />

      {canClipFromUrl ? (
        <div className='flex gap-2'>
          <input
            type='url'
            className='input input-bordered eink-bordered flex-1'
            placeholder={_('Paste an article URL')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleUrl();
            }}
          />
          <button type='button' className='btn btn-contrast' onClick={() => void handleUrl()}>
            <MdLink className='h-4 w-4' />
            {_('Add')}
          </button>
        </div>
      ) : (
        <section className='card eink-bordered border-base-200 bg-base-100 flex flex-col gap-2 border p-5'>
          <div className='flex items-center gap-2'>
            <MdExtension className='text-base-content/70 h-5 w-5 flex-shrink-0' />
            <h2 className='text-sm font-medium'>{_('Send a web article')}</h2>
          </div>
          <p className='text-base-content/70 text-xs leading-relaxed'>
            {_(
              'Install the Readest browser extension to send the article you are reading to your library. It clips the page from your browser so paywalled and login-only sites still work.',
            )}
          </p>
        </section>
      )}

      {items.length > 0 && (
        <ul className='card eink-bordered border-base-200 bg-base-100 divide-base-200 divide-y overflow-hidden border'>
          {items.map((item) => (
            <li key={item.id} className='flex items-center gap-3 px-4 py-3'>
              {item.status === 'working' && (
                <span className='loading loading-spinner loading-sm flex-shrink-0' />
              )}
              {item.status === 'done' && (
                <MdCheckCircle className='text-success h-5 w-5 flex-shrink-0' />
              )}
              {item.status === 'error' && <MdError className='text-error h-5 w-5 flex-shrink-0' />}
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-sm'>{item.label}</span>
                <span className='text-base-content/60 text-xs'>
                  {item.status === 'done'
                    ? _('Added to your library. It will sync to your other devices.')
                    : item.status === 'error'
                      ? item.detail
                      : _('Working…')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
