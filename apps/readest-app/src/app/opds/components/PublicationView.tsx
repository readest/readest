'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IoPricetag } from 'react-icons/io5';
import { Book } from '@/types/book';
import { OPDSPublication, REL, SYMBOL, OPDSAcquisitionLink, OPDSStreamLink } from '@/types/opds';
import { useTranslation } from '@/hooks/useTranslation';
import { getFileExtFromMimeType } from '@/libs/document';
import { formatDate, formatLanguage } from '@/utils/book';
import { getImportErrorMessage, ImportError } from '@/services/errors';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { CachedImage } from '@/components/CachedImage';
import { groupByArray, getOPDSNavLink } from '../utils/opdsUtils';
import { getOPDSDescriptionHtml } from '../utils/opdsContent';
import Dropdown from '@/components/Dropdown';
import MenuItem from '@/components/MenuItem';

interface PublicationViewProps {
  publication: OPDSPublication;
  baseURL: string;
  /**
   * Book in the user's library that already corresponds to this publication,
   * if any. When provided, the acquisition button skips Download and goes
   * straight to "Open & Read" — matching the post-download UX even after the
   * component remounts (e.g. returning from the reader, or switching
   * publications inside the same OPDS browser session). null/undefined means
   * "no copy in library, show the normal acquisition button".
   */
  existingBook?: Book | null;
  resolveURL: (url: string, base: string) => string;
  onNavigate: (url: string) => void;
  onDownload: (
    href: string,
    type?: string,
    onProgress?: (progress: { progress: number; total: number }) => void,
  ) => Promise<Book | null | undefined>;
  onStream?: (href: string, count: number, title: string, author: string) => void;
  onGenerateCachedImageUrl: (url: string) => Promise<string>;
}

export function PublicationView({
  publication,
  baseURL,
  existingBook,
  resolveURL,
  onNavigate,
  onDownload,
  onStream,
  onGenerateCachedImageUrl,
}: PublicationViewProps) {
  const _ = useTranslation();
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  // Seeded from existingBook so users who reopen a publication they've already
  // downloaded see "Open & Read" immediately, without having to re-download.
  // When existingBook later changes (parent switches to a different
  // publication, or the library finishes loading after this mounts) the
  // effect below resyncs.
  const [downloadedBook, setDownloadedBook] = useState<Book | null>(existingBook ?? null);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    // Only resync from the parent-provided existingBook; don't blow away a
    // book set locally by a successful handleActionButton download just
    // because the parent re-rendered without recomputing existingBook yet.
    if (existingBook && existingBook.hash !== downloadedBook?.hash) {
      setDownloadedBook(existingBook);
    } else if (!existingBook && downloadedBook && !downloading) {
      // existingBook went from set to null — happens when the parent rebuilds
      // the publication (new feed loaded). Drop the stale state so the next
      // publication starts from "Download" instead of inheriting the prior
      // book's "Open & Read".
      setDownloadedBook(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingBook]);

  const linksByRel = useMemo(
    () => groupByArray(publication.links, (link) => link.rel),
    [publication.links],
  );

  const coverImage = useMemo(() => {
    const covers = publication.images?.filter((img) =>
      REL.COVER.some((rel: string) => img.rel?.includes(rel)),
    );
    return covers?.[0] || publication.images?.[0];
  }, [publication.images]);

  const imageUrl = coverImage?.href ? resolveURL(coverImage.href, baseURL) : null;

  const authors = useMemo(() => {
    const author = publication.metadata?.author;
    if (!author) return [] as Array<{ name: string; href: string | undefined }>;

    const authorList = Array.isArray(author) ? author : [author];

    return authorList
      .map((a) =>
        typeof a === 'string'
          ? { name: a, href: undefined as string | undefined }
          : { name: a?.name, href: getOPDSNavLink(a?.links) },
      )
      .filter((a): a is { name: string; href: string | undefined } => Boolean(a.name));
  }, [publication.metadata?.author]);

  const authorNames = useMemo(() => authors.map((a) => a.name), [authors]);

  const acquisitionLinks = useMemo(() => {
    const links: Array<{ rel: string; links: OPDSAcquisitionLink[] }> = [];
    for (const [rel, linkList] of Array.from(linksByRel.entries())) {
      if (rel?.startsWith(REL.ACQ)) {
        links.push({ rel, links: linkList as OPDSAcquisitionLink[] });
      }
    }
    return links;
  }, [linksByRel]);

  const streamLinks = useMemo(() => {
    return (linksByRel.get(REL.STREAM) || []) as OPDSStreamLink[];
  }, [linksByRel]);

  const handleActionButton = async (href: string, type?: string, forceDownload = false) => {
    if (downloadedBook && !forceDownload) {
      navigateToReader(router, [downloadedBook.hash]);
      return;
    }

    setDownloading(true);
    setProgress(null);

    try {
      const book = await onDownload(href, type, (prog) => {
        if (prog.total > 0) {
          const percentage = Math.floor((prog.progress / prog.total) * 100);
          setProgress(percentage);
        }
      });
      if (book) {
        setDownloadedBook(book);
      }
      eventDispatcher.dispatch('toast', { type: 'success', message: _('Download completed') });
    } catch (error) {
      console.error('Download failed:', error);
      if (error instanceof ImportError) {
        const friendlyMsg = _(getImportErrorMessage(error.message));
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Import failed') + `:\n${friendlyMsg}`,
          timeout: 5000,
        });
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Download failed') + `:\n${href}`,
        });
      }
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const getAcquisitionLabel = (rel: string): string => {
    if (rel === REL.ACQ + '/open-access') return _('Open Access');
    if (rel === REL.ACQ + '/borrow') return _('Borrow');
    if (rel === REL.ACQ + '/buy') return _('Buy');
    if (rel === REL.ACQ + '/subscribe') return _('Subscribe');
    if (rel === REL.ACQ + '/sample') return _('Sample');
    return _('Download');
  };

  const content = publication.metadata?.[SYMBOL.CONTENT] || publication.metadata?.content;
  const description = publication.metadata?.description;
  const descriptionHtml = useMemo(() => getOPDSDescriptionHtml(content), [content]);

  return (
    <div className='flex w-full flex-col px-6 py-6'>
      <div className='mb-6 flex w-full flex-row items-start gap-6 max-[320px]:flex-col'>
        <div className='h-44 flex-shrink-0 sm:h-56 md:h-64'>
          <div className='bg-base-200 relative aspect-[28/41] h-full overflow-hidden rounded-none shadow-lg'>
            <CachedImage
              src={imageUrl}
              alt={publication.metadata?.title || 'Book cover'}
              fill
              className='object-cover'
              sizes='(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
              onGenerateCachedImageUrl={onGenerateCachedImageUrl}
            />
          </div>
        </div>

        <div className='flex h-44 min-w-0 flex-col justify-between max-[320px]:h-32 sm:h-56 md:h-64'>
          <div className='flex flex-col'>
            {publication.metadata?.subtitle && (
              <p className='text-base-content/60 mb-1 text-sm'>{publication.metadata.subtitle}</p>
            )}
            <h1 className='mb-2 text-base font-bold'>
              {publication.metadata?.title || 'Untitled'}
            </h1>
            {authors.length > 0 && (
              <p className='text-base-content/70 text-sm'>
                {authors.map((author, index) => (
                  <span key={index}>
                    {index > 0 && ', '}
                    {author.href ? (
                      <button
                        type='button'
                        onClick={() => onNavigate(resolveURL(author.href!, baseURL))}
                        className='hover:underline'
                      >
                        {author.name}
                      </button>
                    ) : (
                      author.name
                    )}
                  </span>
                ))}
              </p>
            )}
          </div>

          {(acquisitionLinks.length > 0 || streamLinks.length > 0) && (
            <div className='flex flex-wrap items-center gap-2'>
              {acquisitionLinks.map(({ rel, links }) => {
                const validLinks = links.filter((l) => l.href);
                if (validLinks.length === 0) return null;

                return (
                  <div key={rel} className='flex gap-1'>
                    {downloadedBook ? (
                      <>
                        <button
                          type='button'
                          onClick={() =>
                            handleActionButton(validLinks[0]!.href!, validLinks[0]!.type)
                          }
                          disabled={downloading}
                          className='btn btn-primary btn-success min-w-20 rounded-3xl'
                        >
                          {_('Open & Read')}
                        </button>
                        <button
                          type='button'
                          onClick={() =>
                            handleActionButton(validLinks[0]!.href!, validLinks[0]!.type, true)
                          }
                          disabled={downloading}
                          className='btn btn-primary min-w-20 rounded-3xl'
                        >
                          {_('Download Again')}
                        </button>
                      </>
                    ) : validLinks.length === 1 ? (
                      <button
                        type='button'
                        onClick={() =>
                          handleActionButton(validLinks[0]!.href!, validLinks[0]!.type)
                        }
                        disabled={downloading}
                        className='btn btn-primary min-w-20 rounded-3xl'
                      >
                        {getAcquisitionLabel(rel)}
                      </button>
                    ) : (
                      <Dropdown
                        label={_('Download')}
                        className='dropdown-bottom dropdown-center flex justify-center'
                        buttonClassName='btn btn-primary min-w-20 rounded-3xl p-0 bg-primary hover:bg-primary'
                        disabled={downloading}
                        toggleButton={<div>{getAcquisitionLabel(rel)}</div>}
                      >
                        <div
                          className={clsx(
                            'delete-menu dropdown-content no-triangle !relative',
                            'border-base-300 !bg-base-200 z-20 mt-2 max-w-[80vw] shadow-2xl',
                          )}
                        >
                          {validLinks.map((link, idx: number) => (
                            <MenuItem
                              key={idx}
                              noIcon
                              transient
                              label={
                                link.title ||
                                getFileExtFromMimeType(link.type || '').toUpperCase() ||
                                idx.toString()
                              }
                              onClick={() => handleActionButton(link.href!, link.type)}
                            />
                          ))}
                        </div>
                      </Dropdown>
                    )}
                  </div>
                );
              })}

              {streamLinks.map((link, idx) => {
                if (!link.href) return null;
                const countRaw =
                  link.properties?.['pse:count'] ?? link.properties?.numberOfItems ?? 0;
                const count = Number(countRaw);

                if (count > 0) {
                  return (
                    <button
                      key={`stream-${idx}`}
                      type='button'
                      onClick={() =>
                        onStream?.(
                          link.href!,
                          count,
                          publication.metadata?.title || '',
                          authorNames.join(', '),
                        )
                      }
                      disabled={downloading || !!downloadedBook}
                      className={clsx('btn btn-secondary min-w-20 rounded-3xl')}
                    >
                      {_('Read (Stream)')}
                    </button>
                  );
                }
                return null;
              })}

              <div className='flex h-12 w-12 items-center justify-center'>
                {downloading && progress && progress > 0 && (
                  <div
                    className='radial-progress flex items-center justify-center'
                    style={
                      {
                        '--value': progress,
                        '--size': '2.5rem',
                        fontSize: '0.6rem',
                        lineHeight: '0.8rem',
                      } as React.CSSProperties
                    }
                    aria-valuenow={progress || 0}
                    role='progressbar'
                  >
                    {progress}%
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className='max-w-xl items-start space-y-6'>
        {/* Description */}
        {(descriptionHtml || description) && (
          <div className='prose prose-sm max-w-none'>
            {descriptionHtml ? (
              <div dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
            ) : (
              <p>{description}</p>
            )}
          </div>
        )}

        {/* Metadata Table */}
        <div>
          <style>
            {`
              .table :where(th, td) {
                padding: 10px 0px;
              }
            `}
          </style>
          <table className='table text-sm'>
            <tbody>
              {publication.metadata?.publisher && (
                <tr>
                  <th className='w-32'>{_('Publisher')}</th>
                  <td>
                    {typeof publication.metadata.publisher === 'string'
                      ? publication.metadata.publisher
                      : Array.isArray(publication.metadata.publisher)
                        ? publication.metadata.publisher
                            .map((p) => (typeof p === 'string' ? p : p.name))
                            .filter(Boolean)
                            .join(', ')
                        : publication.metadata.publisher.name}
                  </td>
                </tr>
              )}
              {publication.metadata?.published && (
                <tr>
                  <th>{_('Published')}</th>
                  <td>{formatDate(publication.metadata.published, true)}</td>
                </tr>
              )}
              {publication.metadata?.language && (
                <tr>
                  <th>{_('Language')}</th>
                  <td>
                    {Array.isArray(publication.metadata.language)
                      ? publication.metadata.language.map((lang) => formatLanguage(lang)).join(', ')
                      : formatLanguage(publication.metadata.language)}
                  </td>
                </tr>
              )}
              {publication.metadata?.identifier && (
                <tr>
                  <th>{_('Identifier')}</th>
                  <td>
                    <code className='text-xs'>{publication.metadata.identifier}</code>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Tags/Subjects */}
        {publication.metadata?.subject && publication.metadata.subject.length > 0 && (
          <div>
            <h2 className='mb-3 text-sm font-semibold'>{_('Tags')}</h2>
            <div className='flex flex-wrap gap-2'>
              {publication.metadata.subject.map((subject, index: number) => {
                const tag =
                  typeof subject === 'string' ? subject : subject.name || subject.code || _('Tag');
                const href =
                  typeof subject === 'string' ? undefined : getOPDSNavLink(subject.links);
                const badgeClass = 'badge badge-outline max-w-full gap-1';
                const inner = (
                  <>
                    <IoPricetag className='h-3 min-h-3 w-3 min-w-3' />
                    <div className='truncate' title={tag}>
                      {tag}
                    </div>
                  </>
                );
                return href ? (
                  <button
                    key={index}
                    type='button'
                    onClick={() => onNavigate(resolveURL(href, baseURL))}
                    className={clsx(badgeClass, 'hover:bg-base-200 cursor-pointer')}
                  >
                    {inner}
                  </button>
                ) : (
                  <div key={index} className={badgeClass}>
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
