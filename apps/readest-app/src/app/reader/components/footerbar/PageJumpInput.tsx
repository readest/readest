import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import type { PageInfo } from '@/types/book';
import {
  collectLabels,
  formatProgress,
  formatProgressPercent,
  getReferencePageInfo,
} from '@/utils/progress';
import { clampPage, findReferencePageHref, fractionForPage, parsePageInput } from './pageJump';

interface PageJumpInputProps {
  bookKey: string;
  /** Always show '{current} / {total}' regardless of the progress style. */
  showFraction?: boolean;
  /** The progress slider's position while it is dragged, shown until the reader relocates. */
  previewFraction?: number | null;
  className?: string;
}

/**
 * The footer bar's progress label, editable in place: clicking it selects the
 * current page number inside the "94 / 251" text so a target page can be
 * typed over it. Enter or leaving the field jumps there (the iOS number pad
 * has no Enter key, only the keyboard bar's Done); Escape cancels. An
 * invisible sizer span reserves the label's width so toggling edit mode never
 * shifts the surrounding layout.
 */
const PageJumpInput: React.FC<PageJumpInputProps> = ({
  bookKey,
  showFraction,
  previewFraction,
  className,
}) => {
  const _ = useTranslation();
  const { hoveredBookKey, getView, getProgress, getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();
  const view = getView(bookKey);
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const progressStyle = viewSettings?.progressStyle || 'percentage';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [selectLength, setSelectLength] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set while the field is blurred on purpose, so onBlur doesn't commit.
  const quietBlurRef = useRef(false);
  const [lastPageInfo, setLastPageInfo] = useState<PageInfo | null>(null);

  useEffect(() => {
    if (!editing) return;
    // Select the current page portion so typing replaces it. The rAF runs
    // after the browser's own click handling, which would otherwise collapse
    // the selection to a caret on mouse-up.
    const raf = requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(0, selectLength);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing, selectLength]);

  useEffect(() => {
    // The footer bar hid (or another book took focus) mid-edit.
    if (hoveredBookKey !== bookKey && document.activeElement === inputRef.current) {
      quietBlurRef.current = true;
      inputRef.current?.blur();
      quietBlurRef.current = false;
    }
  }, [hoveredBookKey, bookKey]);

  const { section, pageinfo } = progress || {};
  const livePageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const liveValid = !!livePageInfo && livePageInfo.total > 0 && livePageInfo.current >= 0;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (liveValid) setLastPageInfo(livePageInfo);
  }, [liveValid, livePageInfo]);

  // Keep showing the last valid page while a relocation briefly reports an
  // invalid one: unmounting the label widens the progress slider under a
  // dragging cursor, which jumps somewhere else and brings the label back,
  // looping into a jitter (#6646).
  const pageInfo = liveValid ? livePageInfo : lastPageInfo;
  if (!pageInfo) return null;

  const pageList = bookData?.bookDoc?.pageList;
  const progressFraction = (pageInfo.current + 1) / pageInfo.total;
  const referenceInfo =
    progressStyle === 'reference'
      ? getReferencePageInfo({
          pageList,
          pageItem: progress?.pageItem,
          fraction: progressFraction,
          referencePageCount: viewSettings?.referencePageCount,
        })
      : null;

  // While the slider is dragged, label the page under it: the same page the
  // slider shows for a location, (current + 1) / total.
  const preview = previewFraction ?? null;
  const shownPageInfo =
    preview === null
      ? pageInfo
      : {
          ...pageInfo,
          current: Math.min(
            pageInfo.total - 1,
            Math.max(0, Math.ceil(preview * pageInfo.total) - 1),
          ),
        };
  // A PDF page list has one entry per physical page, so the page under the
  // slider has a label of its own; other page lists only get an estimate.
  const previewPageItem =
    preview !== null && pageList?.every((item, index) => item.index === index)
      ? pageList[Math.min(pageList.length, Math.max(1, Math.ceil(preview * pageList.length))) - 1]
      : undefined;
  const shownReferenceInfo =
    preview === null || !referenceInfo
      ? referenceInfo
      : getReferencePageInfo({
          pageList,
          pageItem: previewPageItem,
          fraction: preview,
          referencePageCount: viewSettings?.referencePageCount,
        });
  const template =
    showFraction || progressStyle === 'fraction' ? '{current} / {total}' : '{percent}%';
  const displayText = shownReferenceInfo
    ? `${shownReferenceInfo.current} / ${shownReferenceInfo.total}`
    : template === '{percent}%'
      ? formatProgressPercent(
          bookData?.isFixedLayout ? undefined : (preview ?? progress?.fraction),
          shownPageInfo.current,
          shownPageInfo.total,
          false,
          'en',
          0,
        )
      : formatProgress(shownPageInfo.current, shownPageInfo.total, template, false, 'en', 0);

  const total = referenceInfo ? referenceInfo.total : pageInfo.total;
  const currentLabel = referenceInfo ? referenceInfo.current : String(pageInfo.current + 1);

  const jumpToPage = (page: number) => {
    if (!view) return;
    const target = clampPage(page, total);
    if (referenceInfo) {
      const href = findReferencePageHref(bookData?.bookDoc?.pageList, target);
      if (href) view.goTo(href);
      else view.goToFraction(fractionForPage(target, total));
    } else if (bookData?.isFixedLayout) {
      view.goTo(target - 1);
    } else {
      view.goToFraction(fractionForPage(target, total));
    }
  };

  const initialDraft = `${currentLabel} / ${total}`;

  const commitDraft = () => {
    if (draft === initialDraft) return;
    const page = parsePageInput(draft);
    if (page !== null) jumpToPage(page);
  };

  const stopEditing = () => {
    setEditing(false);
    quietBlurRef.current = true;
    inputRef.current?.blur();
    quietBlurRef.current = false;
  };

  const text = editing ? draft : displayText;
  // Size the box for the book's widest label (the last page in tabular digits,
  // or the longest page-list label), so a label that changes while the slider
  // is dragged, or turns into the draft on focus, never moves the slider under
  // the cursor (#6646).
  const widestLabel = referenceInfo
    ? collectLabels(pageList ?? []).reduce(
        (widest, label) => (label.length > widest.length ? label : widest),
        String(total),
      )
    : String(total);
  const widestText =
    template === '{percent}%' && !referenceInfo ? '100%' : `${widestLabel} / ${total}`;
  const sizerText = text.length > widestText.length ? text : widestText;

  return (
    <div
      className={clsx(
        'relative flex items-center rounded-md text-nowrap tabular-nums transition-colors',
        editing
          ? 'eink-bordered bg-base-content/10'
          : 'hover:bg-base-content/10 cursor-pointer bg-transparent',
        className,
      )}
    >
      {/* Invisible sizer: the box is always as wide as its text, so swapping
          between label and edit modes never shifts the surrounding layout. */}
      <span aria-hidden='true' className='invisible whitespace-pre px-1 py-0.5'>
        {sizerText}
      </span>
      <input
        ref={inputRef}
        type='text'
        inputMode='numeric'
        enterKeyHint='go'
        title={_('Go to Page')}
        aria-label={_('Go to Page')}
        value={text}
        className='absolute inset-0 h-full w-full bg-transparent text-center focus:outline-hidden'
        onFocus={() => {
          // Keep the "current / total" text as-is (percentage style swaps to
          // it) and pre-select the page portion for type-over editing.
          setDraft(initialDraft);
          setSelectLength(currentLabel.length);
          setEditing(true);
        }}
        onBlur={() => {
          setEditing(false);
          if (!quietBlurRef.current) commitDraft();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Keep keystrokes away from the reader's page-turn shortcuts and
          // the footer bar's spatial navigation.
          e.stopPropagation();
          if (e.key === 'Enter') {
            commitDraft();
            stopEditing();
          } else if (e.key === 'Escape') stopEditing();
        }}
      />
    </div>
  );
};

export default PageJumpInput;
