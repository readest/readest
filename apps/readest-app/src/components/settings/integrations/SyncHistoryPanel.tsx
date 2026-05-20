import clsx from 'clsx';
import React, { useState } from 'react';
import { WebDAVSyncLogEntry, WebDAVSyncLogStatus } from '@/types/settings';
import { BoxedList, SettingsRow } from '../primitives';

/**
 * Diagnostic surface for the most-recent ten WebDAV manual runs —
 * Sync now from the form plus batch cleanups (Delete from server)
 * issued from the WebDAV browser. Auto-syncs triggered while reading
 * are intentionally NOT logged here; they fire once per page-turn
 * and would drown out the manual signal users care about.
 *
 * Why a separate component (rather than inline JSX in WebDAVForm):
 *  - Keeps the outer form file legible; the panel has its own state
 *    model (which entry is expanded) that doesn't belong in the parent.
 *  - Co-locates the per-entry rendering (counters, failure list,
 *    duration) with the component that owns it. The parent only knows
 *    about "the log" as a whole and how to clear it.
 *
 * Presentational: all persistence happens in the parent
 * (`appendSyncLogEntry` / `handleClearSyncLog`). We accept the
 * translation function `t` rather than calling `useTranslation` here so
 * the parent stays the single source of locale truth for the page.
 */
export interface SyncHistoryPanelProps {
  entries: WebDAVSyncLogEntry[];
  onClear: () => void | Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const SyncHistoryPanel: React.FC<SyncHistoryPanelProps> = ({ entries, onClear, t }) => {
  // Only one entry expanded at a time keeps the panel scannable on
  // mobile — multiple open rows can quickly push the disconnect button
  // off-screen. Set to null when no row is expanded.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hasEntries = entries.length > 0;

  return (
    <BoxedList>
      <SettingsRow
        label={t('Sync History')}
        description={t(
          "Manual syncs and cleanups — automatic syncs while reading aren't logged here.",
        )}
      >
        {hasEntries ? (
          <button
            type='button'
            onClick={() => onClear()}
            className='btn btn-ghost btn-sm h-8 min-h-8 px-2'
            title={t('Clear Sync History')}
            aria-label={t('Clear Sync History')}
          >
            {t('Clear')}
          </button>
        ) : (
          <span className='text-base-content/50 text-xs'>{t('No manual syncs yet')}</span>
        )}
      </SettingsRow>
      {hasEntries && (
        <ul className='divide-base-200 divide-y'>
          {entries.map((entry) => {
            const isExpanded = expandedId === entry.id;
            return (
              <li key={entry.id} className='px-4 py-3'>
                <button
                  type='button'
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className='group flex w-full items-center gap-3 text-left'
                  aria-expanded={isExpanded}
                >
                  <SyncStatusBadge status={entry.status} t={t} />
                  {entry.kind === 'cleanup' && <SyncKindBadge t={t} />}
                  <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                    <span className='text-sm'>{formatSyncSummaryLine(entry, t)}</span>
                    <span className='text-base-content/60 text-[0.75em]'>
                      {formatSyncTimestamp(entry.startedAt, entry.finishedAt, t)}
                    </span>
                  </div>
                  <span
                    className={clsx(
                      'text-base-content/50 transition-transform',
                      isExpanded && 'rotate-90',
                    )}
                    aria-hidden
                  >
                    ›
                  </span>
                </button>
                {isExpanded && <SyncHistoryDetails entry={entry} t={t} />}
              </li>
            );
          })}
        </ul>
      )}
    </BoxedList>
  );
};

/**
 * Coloured pill summarising an entry's status. We pick semantic
 * Tailwind utilities (success / warning / error) so the badge respects
 * the user's theme (eink, dark, light) without per-mode overrides.
 */
const SyncStatusBadge: React.FC<{ status: WebDAVSyncLogStatus; t: SyncHistoryPanelProps['t'] }> = ({
  status,
  t,
}) => {
  const map: Record<WebDAVSyncLogStatus, { label: string; className: string }> = {
    success: { label: t('OK'), className: 'bg-success/15 text-success' },
    partial: { label: t('Partial'), className: 'bg-warning/15 text-warning' },
    failure: { label: t('Failed'), className: 'bg-error/15 text-error' },
  };
  const { label, className } = map[status];
  return (
    <span
      className={clsx(
        'flex h-6 flex-shrink-0 items-center rounded px-2 text-[0.7rem] font-medium',
        className,
      )}
    >
      {label}
    </span>
  );
};

/**
 * Secondary badge that flags non-sync runs (currently only batch
 * cleanups from the WebDAV browser). Sync entries don't get a kind
 * badge — the absence is the signal — so the row stays visually
 * unchanged for the common case. The cleanup variant uses a neutral
 * info colour rather than red/orange because the run already carries
 * its own status badge (success / partial / failed) right next to
 * it; piling more colour on would just shout.
 */
const SyncKindBadge: React.FC<{ t: SyncHistoryPanelProps['t'] }> = ({ t }) => {
  return (
    <span
      className={clsx(
        'flex h-6 flex-shrink-0 items-center rounded px-2 text-[0.7rem] font-medium',
        'bg-info/15 text-info',
      )}
    >
      {t('Cleanup')}
    </span>
  );
};

/**
 * Build the one-line summary shown next to each history row's status
 * badge. We re-derive it from the structured counters (rather than
 * reusing the toast's `entry.summary`) so the text in the log stays
 * compact even when the original toast was multi-line.
 */
const formatSyncSummaryLine = (
  entry: WebDAVSyncLogEntry,
  t: SyncHistoryPanelProps['t'],
): string => {
  if (entry.status === 'failure') {
    return (
      entry.errorMessage || (entry.kind === 'cleanup' ? t('Cleanup failed') : t('Sync failed'))
    );
  }
  if (entry.kind === 'cleanup') {
    // Cleanup runs only have two interesting numbers: how many
    // server-side dirs got deleted and how many failed. None of the
    // sync counters apply, so build a dedicated summary rather than
    // running the cleanup entry through the upload/download formatter
    // and watching every clause come up zero.
    const parts: string[] = [];
    if ((entry.booksDeleted ?? 0) > 0) {
      parts.push(t('{{n}} deleted', { n: entry.booksDeleted ?? 0 }));
    }
    if (entry.failures > 0) {
      parts.push(t('{{n}} failed', { n: entry.failures }));
    }
    return parts.length > 0 ? parts.join(' · ') : t('Nothing deleted');
  }
  const parts: string[] = [];
  if (entry.booksDownloaded > 0) {
    parts.push(t('{{n}} downloaded', { n: entry.booksDownloaded }));
  }
  if (entry.filesUploaded > 0) {
    parts.push(t('{{n}} uploaded', { n: entry.filesUploaded }));
  }
  if (entry.configsUploaded > 0 || entry.configsDownloaded > 0) {
    parts.push(t('{{n}} progress', { n: entry.configsUploaded + entry.configsDownloaded }));
  }
  if (entry.failures > 0) {
    parts.push(t('{{n}} failed', { n: entry.failures }));
  }
  return parts.length > 0 ? parts.join(' · ') : t('Up to date');
};

/**
 * "Mar 18, 14:32 · 4.2 s" — short locale-aware timestamp plus a
 * duration so users can spot abnormally slow runs at a glance.
 */
const formatSyncTimestamp = (
  startedAt: number,
  finishedAt: number,
  t: SyncHistoryPanelProps['t'],
): string => {
  const when = new Date(startedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const durMs = Math.max(0, finishedAt - startedAt);
  const dur = durMs >= 1000 ? `${(durMs / 1000).toFixed(1)} s` : `${durMs} ms`;
  return t('{{when}} · {{dur}}', { when, dur });
};

/**
 * Expanded body of one history entry: the full counter grid plus the
 * per-book failure list when present. Counters that are zero are
 * suppressed so the grid only shows what actually happened — a
 * partial-failure row with three items is much easier to read than
 * the same row with seven zeroes interleaved.
 */
const SyncHistoryDetails: React.FC<{
  entry: WebDAVSyncLogEntry;
  t: SyncHistoryPanelProps['t'];
}> = ({ entry, t }) => {
  // Counters are grouped semantically so the user can scan them at a
  // glance instead of treating eight numbers as a flat blob:
  //   - "activity": work performed during this run
  //   - "skipped":  work that was deduped / no-op'd
  //   - "outcome":  totals + failure count for at-a-glance triage
  // Each group renders independently and is separated by a divider so
  // it's visually obvious that "Configs uploaded" and "Total books"
  // are different things — they previously sat side-by-side in a
  // single grid which read as one block.
  const groups: { label: string; value: number }[][] = [
    [
      { label: t('Books downloaded'), value: entry.booksDownloaded },
      { label: t('Files uploaded'), value: entry.filesUploaded },
      { label: t('Configs uploaded'), value: entry.configsUploaded },
      { label: t('Configs downloaded'), value: entry.configsDownloaded },
      { label: t('Covers uploaded'), value: entry.coversUploaded },
      // Cleanup-specific counter. Suppressed by the zero-filter on
      // sync entries (which always set this to zero/undefined), so
      // it only shows up on cleanup runs without polluting the
      // common sync detail view.
      { label: t('Books deleted'), value: entry.booksDeleted ?? 0 },
    ],
    [{ label: t('Files in sync'), value: entry.filesAlreadyInSync }],
    [
      { label: t('Failures'), value: entry.failures },
      { label: t('Total books'), value: entry.totalBooks },
    ],
  ]
    // Suppress zero-only groups entirely so we don't render an empty
    // section + divider for a group whose every counter happens to be
    // zero this run (common: 'skipped' and 'outcome' rows on a quiet
    // sync). The within-group filter keeps individual zero entries out
    // of mixed groups.
    .map((group) => group.filter((c) => c.value > 0))
    .filter((group) => group.length > 0);

  return (
    <div className='mt-3 flex flex-col gap-3 pl-9'>
      {groups.length > 0 && (
        // Six-column grid: each of the three semantic groups occupies
        // a (label-column, value-column) pair. Label columns flex with
        // available space and wrap naturally for long strings like
        // "Configs uploaded"; value columns are sized to content so
        // the numbers stay tightly packed against their labels. Border
        // dividers between every other column visually separate the
        // three groups; we draw them with `border-l` on columns 3 and
        // 5 rather than CSS `divide-x` because divide-x can't honour
        // the "skip every two columns" pattern.
        <div
          className={clsx(
            'border-base-200 grid rounded border',
            'gap-x-3 gap-y-2 px-3 py-2 text-xs',
          )}
          style={{
            gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr) auto',
          }}
        >
          {(() => {
            // All three columns share row count to keep the grid rows
            // aligned. Compute it once outside the per-group map so
            // each column sees the same value.
            const maxRows = Math.max(...groups.map((g) => g.length), 0);
            return [0, 1, 2].map((groupIdx) => {
              const group = groups[groupIdx] ?? [];
              const cells: React.ReactNode[] = [];
              for (let row = 0; row < maxRows; row++) {
                const c = group[row];
                cells.push(
                  <div
                    key={`l-${groupIdx}-${row}`}
                    className={clsx(
                      'text-base-content/60 leading-tight',
                      // Group separator: every group except the first
                      // gets a left border on its label column. The
                      // negative left margin offsets the gap so the
                      // line falls inside the gutter rather than
                      // beside the text itself.
                      groupIdx > 0 && 'border-base-200 -ml-3 border-l pl-3',
                    )}
                  >
                    {c?.label ?? ''}
                  </div>,
                );
                cells.push(
                  <div key={`v-${groupIdx}-${row}`} className='text-end font-medium tabular-nums'>
                    {c?.value ?? ''}
                  </div>,
                );
              }
              return cells;
            });
          })()}
        </div>
      )}
      {entry.errorMessage && (
        <div className='text-error/90 break-words text-xs'>
          <span className='text-base-content/60 mr-1'>{t('Error:')}</span>
          {entry.errorMessage}
        </div>
      )}
      {entry.failedBooks && entry.failedBooks.length > 0 && (
        <div className='flex flex-col gap-1'>
          <span className='text-base-content/60 text-xs'>{t('Failed books')}</span>
          <ul className='flex flex-col gap-1 text-xs'>
            {entry.failedBooks.map((f) => (
              <li key={f.hash} className='border-base-200 break-words rounded border px-2 py-1.5'>
                <div className='font-medium'>{f.title}</div>
                <div className='text-base-content/70 mt-0.5'>{f.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SyncHistoryPanel;
