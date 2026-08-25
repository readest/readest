'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { MdClose, MdLanguage } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { openWebBrowser } from '@/services/webBrowser/webBrowser';
import { getWebBrowserOptions } from '@/services/webBrowser/webBrowserOptions';
import {
  addWebSource,
  normalizeWebSourceUrl,
  removeWebSource,
} from '@/services/webBrowser/webSources';
import { navigateToReader } from '@/utils/nav';
import type { WebSource } from '@/types/webSource';

// Stable fallback: a fresh `[]` per render would be an unstable zustand
// snapshot and loop React until error #185 (seen on the first device run).
const NO_SOURCES: WebSource[] = [];

interface WebSourcesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * "From Web Browser" (#5775): saved sites (Calibre-Web, Kavita,
 * Audiobookshelf, ...) the user browses inside Readest. Tapping a source
 * opens the in-app browser; downloads made there are imported by
 * `useWebBrowserDownloads`. Tauri-only, like "From Web URL".
 */
const WebSourcesDialog: React.FC<WebSourcesDialogProps> = ({ isOpen, onClose }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const sources = useSettingsStore((s) => s.settings.webSources ?? NO_SOURCES);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setUrl('');
    setError(null);
    setOpening(false);
  }, [isOpen]);

  const persist = (next: WebSource[]) => {
    const { settings, setSettings, saveSettings } = useSettingsStore.getState();
    settings.webSources = next;
    setSettings(settings);
    saveSettings(envConfig, settings);
  };

  const handleAdd = () => {
    const normalized = normalizeWebSourceUrl(url);
    if (!normalized) {
      setError(_('Please enter a valid http(s) URL'));
      return;
    }
    setError(null);
    persist(addWebSource(sources, name, normalized));
    setName('');
    setUrl('');
  };

  const handleOpen = async (source: WebSource) => {
    if (opening) return;
    setOpening(true);
    try {
      const result = await openWebBrowser(
        source.url,
        getWebBrowserOptions(_, !!appService?.isEink),
      );
      if (result.openBookHash) {
        onClose();
        navigateToReader(router, [result.openBookHash]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={_('From Web Browser')}
      boxClassName='sm:!w-[480px] sm:!max-w-[480px] sm:!h-auto sm:!max-h-[80vh]'
    >
      <div className='flex flex-col gap-4 pb-6 pt-2'>
        <p className='text-base-content/60 text-sm leading-relaxed'>
          {_(
            'Browse your Calibre-Web, Kavita or other book server inside Readest. Books you download there are added to your library.',
          )}
        </p>

        {sources.length > 0 && (
          <ul className='eink-bordered border-base-200 divide-base-200 divide-y rounded-lg border'>
            {sources.map((source) => (
              <li key={source.id} className='flex items-center gap-2 pe-1 ps-3'>
                <button
                  type='button'
                  disabled={opening}
                  onClick={() => void handleOpen(source)}
                  className={clsx(
                    'flex min-w-0 flex-1 items-center gap-3 py-3 text-start',
                    'focus-visible:ring-base-content/15 rounded-md focus-visible:outline-none focus-visible:ring-2',
                  )}
                >
                  <MdLanguage className='text-base-content/70 h-5 w-5 shrink-0' />
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate text-sm font-medium'>{source.name}</span>
                    <span className='text-base-content/60 truncate text-xs'>{source.url}</span>
                  </span>
                </button>
                <button
                  type='button'
                  aria-label={_('Remove')}
                  title={_('Remove')}
                  onClick={() => persist(removeWebSource(sources, source.id))}
                  className='btn btn-ghost btn-circle btn-sm h-8 min-h-8 w-8 p-0'
                >
                  <MdClose className='h-4 w-4' />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className='flex flex-col gap-2'>
          <input
            type='text'
            className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
            placeholder={_('Name (optional)')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type='url'
            className='input input-bordered eink-bordered placeholder:text-base-content/35 w-full'
            placeholder='https://calibre.example.com'
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />
          {error && <p className='text-error text-sm leading-relaxed'>{error}</p>}
        </div>

        <div className='flex justify-end gap-2 pt-1'>
          <button type='button' className='btn btn-ghost btn-sm eink-bordered' onClick={onClose}>
            {_('Close')}
          </button>
          <button
            type='button'
            className='btn btn-contrast btn-sm'
            onClick={handleAdd}
            disabled={!url.trim()}
          >
            {_('Add Source')}
          </button>
        </div>
      </div>
    </Dialog>
  );
};

export default WebSourcesDialog;
