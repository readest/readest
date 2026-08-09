'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IoPricetag } from 'react-icons/io5';
import { MdArrowDropDown } from 'react-icons/md';
import { Book } from '@/types/book';
import { OPDSPublication, REL, SYMBOL, OPDSAcquisitionLink, OPDSStreamLink } from '@/types/opds';
import { getOPDSCoverHref } from '@/services/opds/cover';
import {
  classifyAcquisitionLink,
  getFormatName,
  getFormatTier,
  pickPreferredLink,
} from '@/services/opds/formats';
import { useTranslation } from '@/hooks/useTranslation';
import { formatDate, formatLanguage } from '@/utils/book';
import { getImportErrorMessage, ImportError } from '@/services/errors';
import { eventDispatcher } from '@/utils/event';
import { navigateToReader } from '@/utils/nav';
import { CachedImage } from '@/components/CachedImage';
import { groupByArray, getOPDSNavLink, formatContributorName } from '../utils/opdsUtils';
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
  onGenerateCachedImageUrl: (url: string, cacheVersion?: string) => Promise<string>;
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

  // Same pick the download path stores as the book cover, so the detail view
  // never previews artwork the library won't end up showing (issue #5270).
  const coverHref = useMemo(() => getOPDSCoverHref(publication), [publication]);

  const imageUrl = coverHref ? resolveURL(coverHref, baseURL) : null;

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
      .filter((a): a is { name: string; href: string | undefined } => Boolean(a.name))
      .map((a) => ({ ...a, name: formatContributorName(a.name) }));
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

  // `formatExt` names the format the button would fetch. Only the generic
  // Download label takes it: the entitlement rels describe an action rather
  // than a file, so "Borrow EPUB" would read wrong (#5583).
  const getAcquisitionLabel = (rel: string, formatExt?: string): string => {
    if (rel === REL.ACQ + '/open-access') return _('Open Access');
    if (rel === REL.ACQ + '/borrow') return _('Borrow');
    if (rel === REL.ACQ + '/buy') return _('Buy');
    if (rel === REL.ACQ + '/subscribe') return _('Subscribe');
    if (rel === REL.ACQ + '/sample') return _('Sample');
    return formatExt
      ? _('Download {{format}}', { format: formatExt.toUpperCase() })
      : _('Download');
  };

  const formatMenu = (links: OPDSAcquisitionLink[]) => (
    <div
      // Stays absolutely positioned (daisyui's default). Forcing `relative`
      // here puts the menu in flow inside the fixed-height detail column, and
      // `justify-between` then shoves the whole button row 156px up the moment
      // it opens.
      className={clsx(
        'dropdown-content no-triangle',
        'border-base-300 eink-bordered !bg-base-200 z-20 mt-2 max-w-[80vw] min-w-max',
        'rounded-2xl border shadow-2xl',
      )}
    >
      {links.map((link, idx: number) => (
        <MenuItem
          key={idx}
          noIcon
          transient
          label={link.title || getFormatName(link).toUpperCase() || _('Download')}
          onClick={() => handleActionButton(link.href!, link.type)}
        />
      ))}
    </div>
  );

  // DESIGN.md §4.1/§4.4: one solid primary per surface, everything else quieter.
  // `btn-contrast` sets its background with `!important`, so it survives the
  // `bg-base-300/50` tint the Dropdown puts on an open toggle -- a plain
  // `btn-primary` half would turn beige while its sibling stayed filled. The
  // secondary gets a soft surface rather than a bare ghost: a transparent half
  // has no shape to split, so its caret rendered as a detached sliver.
  const SOLID_ACTION = 'btn btn-contrast';
  const FLAT_ACTION =
    'btn eink-bordered border-transparent !bg-base-200 hover:!bg-base-300 text-base-content';

  /**
   * A default action plus, when there is more than one format to choose from, a
   * caret that opens the full list.
   *
   * The halves are separated by a 1px gap showing the page behind rather than a
   * border: `btn-contrast` declares its own border `!important`, so a seam
   * colour set here is ignored. The gap also survives e-ink, where hover does
   * not exist and two same-tone buttons would otherwise flatten into one.
   */
  const splitDownloadButton = (
    label: string,
    onPrimary: () => void,
    menuLinks: OPDSAcquisitionLink[],
    solid = true,
  ) => (
    <div className='flex gap-px'>
      <button
        type='button'
        onClick={onPrimary}
        disabled={downloading}
        className={clsx(
          solid ? SOLID_ACTION : FLAT_ACTION,
          'min-w-20 rounded-l-3xl rounded-r-none px-4',
        )}
      >
        {label}
      </button>
      <Dropdown
        label={_('More formats')}
        className='dropdown-bottom dropdown-end'
        buttonClassName={clsx(
          solid ? SOLID_ACTION : FLAT_ACTION,
          'w-10 rounded-l-none rounded-r-3xl px-0',
        )}
        disabled={downloading}
        toggleButton={<MdArrowDropDown size={20} />}
      >
        {formatMenu(menuLinks)}
      </Dropdown>
    </div>
  );

  const content = publication.metadata?.[SYMBOL.CONTENT] || publication.metadata?.content;
  const description = publication.metadata?.description;
  // OPDS 2.0 JSON keeps the summary in the plain `description` string (no typed
  // <content>), and catalogs like pglaf/Gutenberg fill it with HTML. Fall back
  // to it so that markup renders as markup instead of literal tags; the helper
  // sanitizes either source (readest issue #4749).
  const descriptionHtml = useMemo(
    () => getOPDSDescriptionHtml(content ?? description),
    [content, description],
  );

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
              cacheVersion={publication.metadata?.updated}
              onGenerateCachedImageUrl={onGenerateCachedImageUrl}
            />
          </div>
        </div>

        {/* Min-height, not height: `justify-between` still pins the actions to
            the bottom alongside the cover, but a narrow viewport that wraps the
            action row onto a second line grows the column instead of spilling
            the buttons over the description. */}
        <div className='flex min-h-44 min-w-0 flex-1 flex-col justify-between max-[320px]:min-h-32 sm:min-h-56 md:min-h-64'>
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
                    {index > 0 && ' & '}
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

          {!downloadedBook && acquisitionLinks.length === 0 && streamLinks.length === 0 && (
            <p className='text-base-content/60 text-sm'>{_('No downloadable format available')}</p>
          )}

          {(acquisitionLinks.length > 0 || streamLinks.length > 0) && (
            <div className='flex flex-wrap items-center gap-2'>
              {acquisitionLinks.map(({ rel, links }) => {
                const validLinks = links.filter((l) => l.href);
                if (validLinks.length === 0) return null;

                // Drop formats Readest cannot import — unless that would leave
                // nothing, in which case the incompatible links are still the
                // only path this book has (#5583).
                const compatible = validLinks.filter(
                  (l) => classifyAcquisitionLink(l) !== 'unsupported',
                );
                const usableLinks = compatible.length > 0 ? compatible : validLinks;
                const menuLinks = [...usableLinks].sort(
                  (a, b) => getFormatTier(a) - getFormatTier(b),
                );
                const preferred = pickPreferredLink(usableLinks)!;
                // Only an EPUB earns a default action. Anything else and the
                // user picks, rather than the app quietly taking second best.
                const hasDefaultAction = getFormatTier(preferred) <= 1;
                const primaryLabel = getAcquisitionLabel(
                  rel,
                  hasDefaultAction || usableLinks.length === 1
                    ? getFormatName(preferred)
                    : undefined,
                );
                const showCaret = usableLinks.length > 1;

                return (
                  <div key={rel} className='flex flex-wrap items-center gap-2'>
                    {downloadedBook ? (
                      <>
                        {/* Reading the copy you already have is the primary
                            action here, so it takes the one solid button and
                            re-downloading drops to flat. */}
                        <button
                          type='button'
                          onClick={() => handleActionButton(preferred.href!, preferred.type)}
                          disabled={downloading}
                          className={clsx(SOLID_ACTION, 'min-w-20 rounded-3xl px-4')}
                        >
                          {_('Open & Read')}
                        </button>
                        {showCaret ? (
                          splitDownloadButton(
                            _('Download Again'),
                            () => handleActionButton(preferred.href!, preferred.type, true),
                            menuLinks,
                            false,
                          )
                        ) : (
                          <button
                            type='button'
                            onClick={() =>
                              handleActionButton(preferred.href!, preferred.type, true)
                            }
                            disabled={downloading}
                            className={clsx(FLAT_ACTION, 'min-w-20 rounded-3xl px-4')}
                          >
                            {_('Download Again')}
                          </button>
                        )}
                      </>
                    ) : !showCaret ? (
                      <button
                        type='button'
                        onClick={() => handleActionButton(preferred.href!, preferred.type)}
                        disabled={downloading}
                        className={clsx(SOLID_ACTION, 'min-w-20 rounded-3xl px-4')}
                      >
                        {primaryLabel}
                      </button>
                    ) : hasDefaultAction ? (
                      splitDownloadButton(
                        primaryLabel,
                        () => handleActionButton(preferred.href!, preferred.type),
                        menuLinks,
                      )
                    ) : (
                      <Dropdown
                        label={_('Download')}
                        className='dropdown-bottom dropdown-center flex justify-center'
                        buttonClassName={clsx(SOLID_ACTION, 'min-w-20 gap-1 rounded-3xl px-4')}
                        disabled={downloading}
                        toggleButton={
                          <div className='flex items-center gap-1'>
                            {primaryLabel}
                            <MdArrowDropDown size={18} />
                          </div>
                        }
                      >
                        {formatMenu(menuLinks)}
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
                          authorNames.join(' & '),
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

              {/* Rendered only while a download is running. A permanently
                  mounted 48px slot left a dead gap after the actions on every
                  viewport, and cost real width on narrow ones. */}
              {downloading && progress !== null && progress > 0 && (
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
                  aria-valuenow={progress}
                  role='progressbar'
                >
                  {progress}%
                </div>
              )}
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
