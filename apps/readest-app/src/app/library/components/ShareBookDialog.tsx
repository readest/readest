'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  IoCheckmarkCircle,
  IoCopyOutline,
  IoLinkOutline,
  IoShareSocialOutline,
} from 'react-icons/io5';
import Dialog from '@/components/Dialog';
import SegmentedControl from '@/components/SegmentedControl';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { Book } from '@/types/book';
import { SHARE_DEFAULT_EXPIRATION_DAYS, SHARE_EXPIRATION_DAYS } from '@/services/constants';
import { ShareApiError, createShare, revokeShare } from '@/libs/share';
import { formatBytes } from '@/utils/book';

interface ShareBookDialogProps {
  isOpen: boolean;
  book: Book | null;
  // Optional starting position when launched from the reader top bar.
  // When present, the dialog shows the "Share current page" toggle and
  // includes the cfi in the create payload if the toggle is checked.
  cfi?: string | null;
  onClose: () => void;
}

interface CreatedShare {
  url: string;
  expiresAt: string;
  hasCfi: boolean;
}

const ShareBookDialog: React.FC<ShareBookDialogProps> = ({ isOpen, book, cfi, onClose }) => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const [expirationDays, setExpirationDays] = useState<number>(SHARE_DEFAULT_EXPIRATION_DAYS);
  // Off by default — sharing the current page reveals where the user is in
  // the book, which is mild privacy data. Recipient still gets the book; the
  // toggle only adds the cfi to the link. Mirrors the dialog's reset effect.
  const [includeCfi, setIncludeCfi] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedShare | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fileSize, setFileSize] = useState<number | null>(null);

  // Reset transient state every time the dialog opens for a new book.
  useEffect(() => {
    if (!isOpen) return;
    setExpirationDays(SHARE_DEFAULT_EXPIRATION_DAYS);
    setIncludeCfi(false);
    setGenerating(false);
    setUploadProgress(null);
    setErrorMessage(null);
    setCreated(null);
    setRevoking(false);
    setCopied(false);
    setFileSize(null);
  }, [isOpen, book?.hash]);

  // Look up the book's file size for the Hero metadata line. Mirrors the
  // BookDetailModal pattern: ask appService once per (open, book) pair and
  // tolerate failures silently — file size is decorative, not required.
  useEffect(() => {
    if (!isOpen || !book || !appService) return;
    let cancelled = false;
    (async () => {
      try {
        const size = await appService.getBookFileSize(book);
        if (!cancelled) setFileSize(size);
      } catch {
        // Local file may be unavailable (cloud-only book); leave size null.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, book?.hash, appService]); // eslint-disable-line react-hooks/exhaustive-deps

  const expiryLabel = useMemo(() => {
    if (!created) return null;
    const date = new Date(created.expiresAt);
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }, [created]);

  if (!book) return null;

  const handleGenerate = async () => {
    if (!book || generating) return;
    setGenerating(true);
    setErrorMessage(null);
    try {
      // Upload first if the book lives only locally.
      if (!book.uploadedAt && appService) {
        try {
          await appService.uploadBook(book, (progress) => {
            setUploadProgress((progress.progress / progress.total) * 100);
          });
        } finally {
          setUploadProgress(null);
        }
      }

      const response = await createShare({
        bookHash: book.hash,
        expirationDays,
        title: book.title,
        author: book.author ?? null,
        format: book.format,
        cfi: cfi && includeCfi ? cfi : null,
      });

      setCreated({
        url: response.url,
        expiresAt: response.expiresAt,
        hasCfi: !!(cfi && includeCfi),
      });
    } catch (err) {
      const message =
        err instanceof ShareApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : _('Could not create share link');
      setErrorMessage(message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Link copied'),
        timeout: 2000,
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Could not copy link'),
        timeout: 2000,
      });
    }
  };

  const handleNativeShare = async () => {
    if (!created) return;
    const title = book.title;
    const url = created.url;

    // Tauri (mobile + desktop windowed): try sharekit. If the import or
    // call throws, the plugin isn't usable on this platform — fall through
    // to web/copy. If it resolves (success OR user dismissed the sheet
    // without picking), we're done; do NOT silently copy on top of that.
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

    // Web: navigator.share rejects with AbortError when the user dismisses
    // the share sheet — that's an explicit "don't share" choice, not a
    // signal to silently copy as a "helpful" fallback. Return on either
    // resolve or reject; only fall through if the API isn't supported at all.
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        // User dismissed or share-time error; respect the choice.
      }
      return;
    }

    // Last resort: clipboard copy. Reached only when no native share method
    // is available on this platform (e.g., Linux desktop without sharekit).
    await handleCopy();
  };

  const handleRevoke = async () => {
    if (!created || revoking) return;
    if (!created.url) return;
    // Extract token from the canonical URL we received from the server.
    const segments = created.url.split('/');
    const token = segments[segments.length - 1];
    if (!token) return;
    setRevoking(true);
    try {
      await revokeShare(token);
      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('Share revoked'),
        timeout: 2000,
      });
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : _('Could not revoke share');
      setErrorMessage(message);
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      title={_('Share Book')}
      onClose={onClose}
      boxClassName='sm:min-w-[460px] sm:max-w-[460px] sm:h-auto sm:max-h-[90%]'
      contentClassName='!px-6 !py-4'
    >
      <div className='flex flex-col gap-5 pt-2'>
        {/* Hero: cover + metadata. Cover gets a real shadow so it reads as a
            physical book rather than a bordered thumbnail. Author + format
            collapse into a single muted line for cleaner hierarchy. */}
        <div className='flex items-center gap-4'>
          {book.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverImageUrl}
              alt=''
              className='h-28 w-20 shrink-0 rounded-lg object-cover shadow-md'
              loading='lazy'
            />
          ) : (
            <div className='bg-base-200 flex h-28 w-20 shrink-0 items-center justify-center rounded-lg shadow-md'>
              <IoLinkOutline className='text-base-content/30 h-8 w-8' aria-hidden='true' />
            </div>
          )}
          <div className='min-w-0 flex-1'>
            <div className='text-base-content line-clamp-2 text-lg font-semibold leading-tight'>
              {book.title}
            </div>
            <div className='text-base-content/60 mt-1.5 truncate text-sm'>
              {[book.author, book.format, formatBytes(fileSize)].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        {!created ? (
          <>
            {/* Settings-card group: each row is a label + control, separated
                by a hairline divider. Mirrors the iOS native settings idiom. */}
            <div className='bg-base-200/60 divide-base-content/5 divide-y overflow-hidden rounded-2xl'>
              {/* Both rows share min-h-12 so the segmented control's internal
                  pill height doesn't make this row visibly taller than the
                  toggle row below. */}
              <div className='flex min-h-12 items-center justify-between gap-3 px-4 py-2'>
                <span className='text-base-content text-sm font-medium'>{_('Expires in')}</span>
                <SegmentedControl<number>
                  ariaLabel={_('Expires in')}
                  value={expirationDays}
                  onChange={setExpirationDays}
                  disabled={generating}
                  options={SHARE_EXPIRATION_DAYS.map((n) => ({
                    value: n,
                    label: _('{{count}} days', { count: n }),
                  }))}
                />
              </div>

              {cfi && (
                <label className='flex min-h-12 cursor-pointer select-none items-center justify-between gap-3 px-4 py-2'>
                  <span className='text-base-content text-sm font-medium'>
                    {_('Share reading progress')}
                  </span>
                  <input
                    type='checkbox'
                    className='toggle toggle-primary'
                    checked={includeCfi}
                    onChange={(e) => setIncludeCfi(e.target.checked)}
                    disabled={generating}
                  />
                </label>
              )}
            </div>

            {uploadProgress !== null && (
              <div>
                <div className='text-base-content/70 mb-1.5 text-xs'>
                  {_('Uploading book…')} {Math.round(uploadProgress)}%
                </div>
                <progress
                  className='progress progress-primary w-full'
                  value={uploadProgress}
                  max={100}
                />
              </div>
            )}

            {errorMessage && (
              <p className='text-error text-xs' role='alert'>
                {errorMessage}
              </p>
            )}

            <button
              type='button'
              onClick={handleGenerate}
              disabled={generating}
              className='btn btn-primary btn-block gap-2 rounded-2xl'
            >
              <IoLinkOutline className='h-5 w-5' aria-hidden='true' />
              {generating ? _('Generating…') : _('Generate share link')}
            </button>
          </>
        ) : (
          <>
            {created.hasCfi && (
              <div className='text-primary inline-flex items-center gap-1.5 self-start text-xs font-medium'>
                <IoCheckmarkCircle className='h-4 w-4' aria-hidden='true' />
                {_('Includes your reading progress')}
              </div>
            )}

            {/* URL pill: softer than a bordered input, with the copy button
                as an inline action chip. */}
            <div className='bg-base-200/60 flex items-center gap-2 rounded-2xl p-2 pl-4'>
              <input
                type='text'
                readOnly
                value={created.url}
                aria-label={_('Share URL')}
                className='text-base-content min-w-0 flex-1 bg-transparent font-mono text-xs outline-none'
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type='button'
                onClick={handleCopy}
                className={`btn btn-sm gap-1 rounded-xl ${copied ? 'btn-success' : 'btn-primary'}`}
                aria-label={_('Copy link')}
              >
                {copied ? (
                  <IoCheckmarkCircle className='h-4 w-4' aria-hidden='true' />
                ) : (
                  <IoCopyOutline className='h-4 w-4' aria-hidden='true' />
                )}
                {copied ? _('Copied') : _('Copy')}
              </button>
            </div>

            <button
              type='button'
              onClick={handleNativeShare}
              className='btn btn-block gap-2 rounded-2xl'
            >
              <IoShareSocialOutline className='h-5 w-5' aria-hidden='true' />
              {_('Share via…')}
            </button>

            <p className='text-base-content/60 text-center text-xs'>
              {_('Expires {{date}}', { date: expiryLabel ?? '' })}
              <span className='mx-1.5'>·</span>
              <button
                type='button'
                onClick={handleRevoke}
                disabled={revoking}
                className='link link-error text-xs'
              >
                {revoking ? _('Revoking…') : _('Revoke share')}
              </button>
            </p>

            {errorMessage && (
              <p className='text-error text-xs' role='alert'>
                {errorMessage}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
};

export default ShareBookDialog;
