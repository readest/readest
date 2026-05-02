'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  IoBookOutline,
  IoCopyOutline,
  IoLinkOutline,
  IoShareSocialOutline,
  IoTrashOutline,
} from 'react-icons/io5';
import { PiDotsThreeVerticalBold } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { listShares, revokeShare } from '@/libs/share';
import { formatBytes } from '@/utils/book';
import Dropdown from '@/components/Dropdown';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';

interface ShareRow {
  id: string;
  token: string;
  bookHash: string;
  title: string;
  author: string | null;
  format: string;
  size: number;
  hasCfi: boolean;
  expiresAt: string;
  revokedAt: string | null;
  downloadCount: number;
  createdAt: string;
}

type Status = 'active' | 'expiring' | 'expired' | 'revoked';

const getStatus = (row: ShareRow): Status => {
  if (row.revokedAt) return 'revoked';
  const ms = new Date(row.expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  if (ms < 24 * 60 * 60 * 1000) return 'expiring';
  return 'active';
};

// Small inline cover thumbnail. Falls back to a book-icon placeholder when the
// cover endpoint 404s (no cover uploaded) or 410s (share revoked/expired).
const ShareCover: React.FC<{ token: string; alt: string }> = ({ token, alt }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className='border-base-300 bg-base-200 flex h-14 w-10 shrink-0 items-center justify-center rounded border'>
        <IoBookOutline className='text-base-content/40 h-5 w-5' aria-hidden='true' />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/share/${encodeURIComponent(token)}/cover`}
      alt={alt}
      onError={() => setFailed(true)}
      className='border-base-300 bg-base-200 h-14 w-10 shrink-0 rounded border object-cover'
      loading='lazy'
    />
  );
};

const SharedLinksSection: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [shareUrlBase, setShareUrlBase] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (next: string | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await listShares(next);
        const incoming = response.shares as unknown as ShareRow[];
        setShareUrlBase(
          (response as unknown as { shareUrlBase?: string }).shareUrlBase ?? shareUrlBase,
        );
        setRows((prev) => (append ? [...prev, ...incoming] : incoming));
        setCursor(response.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : _('Could not load your shares'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [_, shareUrlBase],
  );

  useEffect(() => {
    void loadPage(null, false);
    // Initial load only; pagination is driven by the Load more button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildUrl = (row: ShareRow): string | null => {
    if (!row.token || !shareUrlBase) return null;
    return `${shareUrlBase}/${row.token}`;
  };

  const handleCopy = async (row: ShareRow) => {
    const url = buildUrl(row);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Link copied'),
        timeout: 2000,
      });
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Could not copy link'),
        timeout: 2000,
      });
    }
  };

  const handleNativeShare = async (row: ShareRow) => {
    const url = buildUrl(row);
    if (!url) return;
    const title = row.title;

    // See ShareBookDialog.handleNativeShare for the rationale: only fall
    // through to copy when no native share method is available at all.
    // User-dismissal of the share sheet must NOT silently copy the link.
    if (appService?.isMobileApp || appService?.hasWindow) {
      let sharekitWorked = false;
      try {
        const { shareText } = await import('@choochmeque/tauri-plugin-sharekit-api');
        await shareText(`${title}\n${url}`);
        sharekitWorked = true;
      } catch (err) {
        console.error('shareText failed; falling back:', err);
      }
      if (sharekitWorked) return;
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        // User dismissed or share-time error; respect the choice.
      }
      return;
    }

    await handleCopy(row);
  };

  const handleRevoke = async (row: ShareRow) => {
    if (!row.token) return;
    const previous = rows;
    // Optimistic remove. On failure, restore.
    setRows((current) => current.filter((r) => r.id !== row.id));
    try {
      await revokeShare(row.token);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Share revoked'),
        timeout: 2000,
      });
    } catch (err) {
      setRows(previous);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: err instanceof Error ? err.message : _('Could not revoke share'),
        timeout: 2500,
      });
    }
  };

  const renderExpiry = (row: ShareRow) => {
    const status = getStatus(row);
    if (status === 'revoked') return _('Revoked');
    const ms = new Date(row.expiresAt).getTime() - Date.now();
    if (status === 'expired') return _('Expired');
    if (status === 'expiring') {
      const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
      return _('Expires in {{count}} hours', { count: hours });
    }
    const days = Math.max(1, Math.round(ms / (24 * 60 * 60 * 1000)));
    return _('Expires in {{count}} days', { count: days });
  };

  const badgeClass = (status: Status) => {
    if (status === 'active') return 'badge badge-info';
    if (status === 'expiring') return 'badge badge-warning';
    return 'badge badge-ghost';
  };

  if (loading) {
    return (
      <section>
        <h3 className='text-base-content text-lg font-semibold'>{_('Shared books')}</h3>
        <div className='mt-4 flex flex-col gap-2'>
          {[0, 1, 2].map((k) => (
            <div key={k} className='bg-base-200 h-16 w-full animate-pulse rounded-lg' />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section>
        <h3 className='text-base-content text-lg font-semibold'>{_('Shared books')}</h3>
        <p className='text-error mt-2 text-sm'>{error}</p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section>
        <div className='flex items-baseline justify-between'>
          <h3 className='text-base-content text-lg font-semibold'>{_('Shared books')}</h3>
        </div>
        <div className='border-base-300 mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center'>
          <div className='bg-base-200 flex h-16 w-16 items-center justify-center rounded-2xl'>
            <IoLinkOutline className='text-base-content/60 h-8 w-8' aria-hidden='true' />
          </div>
          <p className='text-base-content text-base font-semibold'>
            {_("You haven't shared any books yet")}
          </p>
          <p className='text-base-content/70 text-sm'>
            {_('Open a book and tap Share to send it to a friend.')}
          </p>
        </div>
      </section>
    );
  }

  const activeCount = rows.filter(
    (r) => getStatus(r) === 'active' || getStatus(r) === 'expiring',
  ).length;

  return (
    <section>
      <div className='flex items-baseline justify-between'>
        <h3 className='text-base-content text-lg font-semibold'>{_('Shared books')}</h3>
        <span className='text-base-content/60 text-xs'>
          {_('{{count}} active', { count: activeCount })}
        </span>
      </div>
      <ul className='border-base-300 mt-4 divide-y divide-[var(--fallback-bc,oklch(var(--bc)/0.1))] overflow-hidden rounded-2xl border'>
        {rows.map((row) => {
          const status = getStatus(row);
          const dimmed = status === 'expired' || status === 'revoked';
          return (
            <li
              key={row.id}
              className={`flex items-center gap-3 p-3 sm:p-4 ${dimmed ? 'opacity-60' : ''}`}
            >
              <ShareCover token={row.token} alt={row.title} />
              <div className='min-w-0 flex-1'>
                <div className='text-base-content truncate text-sm font-medium'>{row.title}</div>
                <div className='text-base-content/60 truncate text-xs'>
                  {row.author ?? '—'} · {row.format.toUpperCase()} · {formatBytes(row.size)}
                </div>
                <div className='mt-1 flex items-center gap-2 text-xs'>
                  <span className={badgeClass(status)}>{renderExpiry(row)}</span>
                  {row.downloadCount > 0 && (
                    <span className='text-base-content/60'>
                      {_('{{count}} downloads', { count: row.downloadCount })}
                    </span>
                  )}
                  {row.hasCfi && (
                    <span className='text-base-content/60'>{_('starts at saved page')}</span>
                  )}
                </div>
              </div>
              {!dimmed && (
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    title={_('Copy link')}
                    aria-label={_('Copy link')}
                    onClick={() => handleCopy(row)}
                    className='btn btn-ghost btn-sm'
                  >
                    <IoCopyOutline className='h-4 w-4' aria-hidden='true' />
                  </button>
                  <button
                    type='button'
                    title={_('Share via…')}
                    aria-label={_('Share via…')}
                    onClick={() => handleNativeShare(row)}
                    className='btn btn-ghost btn-sm'
                  >
                    <IoShareSocialOutline className='h-4 w-4' aria-hidden='true' />
                  </button>
                  {/*
                   * Use the project's Dropdown component (Headless-UI-style with
                   * an Overlay backdrop) instead of daisyUI's <details>/<summary>
                   * pattern. The bare daisyUI version doesn't position correctly
                   * inside this scrollable settings layout — it gets clipped by
                   * the rounded-2xl border on the surrounding <ul>.
                   */}
                  <Dropdown
                    label={_('More actions')}
                    className='dropdown-bottom dropdown-end'
                    buttonClassName='btn btn-ghost btn-sm'
                    toggleButton={
                      <PiDotsThreeVerticalBold className='h-4 w-4' aria-hidden='true' />
                    }
                  >
                    <Menu className='dropdown-content bg-base-100 rounded-box z-[1] w-44 border p-1 shadow'>
                      <MenuItem
                        label={_('Revoke share')}
                        Icon={IoTrashOutline}
                        onClick={() => handleRevoke(row)}
                      />
                    </Menu>
                  </Dropdown>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {cursor && (
        <button
          type='button'
          onClick={() => loadPage(cursor, true)}
          disabled={loadingMore}
          className='btn btn-ghost btn-block mt-3'
        >
          {loadingMore ? _('Loading…') : _('Load more')}
        </button>
      )}
    </section>
  );
};

export default SharedLinksSection;
