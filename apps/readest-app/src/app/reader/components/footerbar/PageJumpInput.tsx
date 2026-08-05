import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { formatProgress, getReferencePageInfo } from '@/utils/progress';
import { clampPage, findReferencePageHref, fractionForPage, parsePageInput } from './pageJump';

interface PageJumpInputProps {
  bookKey: string;
  /** Always show '{current} / {total}' regardless of the progress style. */
  showFraction?: boolean;
  className?: string;
}

/**
 * The footer bar's progress label, editable in place: clicking it selects the
 * current page number inside the "94 / 251" text so a target page can be
 * typed over it. Enter jumps there; Escape or blur cancels. An invisible
 * sizer span reserves the label's width so toggling edit mode never shifts
 * the surrounding layout.
 */
const PageJumpInput: React.FC<PageJumpInputProps> = ({ bookKey, showFraction, className }) => {
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
      inputRef.current?.blur();
    }
  }, [hoveredBookKey, bookKey]);

  const { section, pageinfo } = progress || {};
  const pageInfo = bookData?.isFixedLayout ? section : pageinfo;
  const progressValid = !!pageInfo && pageInfo.total > 0 && pageInfo.current >= 0;
  if (!progressValid) return null;

  const progressFraction = (pageInfo.current + 1) / pageInfo.total;
  const referenceInfo =
    progressStyle === 'reference'
      ? getReferencePageInfo({
          pageList: bookData?.bookDoc?.pageList,
          pageItem: progress?.pageItem,
          fraction: progressFraction,
          referencePageCount: viewSettings?.referencePageCount,
        })
      : null;
  const template =
    showFraction || progressStyle === 'fraction' ? '{current} / {total}' : '{percent}%';
  const displayText = referenceInfo
    ? `${referenceInfo.current} / ${referenceInfo.total}`
    : formatProgress(pageInfo.current, pageInfo.total, template, false, 'en', 0);

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

  const stopEditing = () => {
    setEditing(false);
    inputRef.current?.blur();
  };

  const commitDraft = () => {
    const page = parsePageInput(draft);
    if (page !== null) jumpToPage(page);
    stopEditing();
  };

  const text = editing ? draft : displayText;

  return (
    <div
      className={clsx(
        'relative flex items-center rounded-md text-nowrap transition-colors',
        editing
          ? 'eink-bordered bg-base-content/10'
          : 'hover:bg-base-content/10 cursor-pointer bg-transparent',
        className,
      )}
    >
      {/* Invisible sizer: the box is always as wide as its text, so swapping
          between label and edit modes never shifts the surrounding layout. */}
      <span aria-hidden='true' className='invisible whitespace-pre px-1 py-0.5'>
        {text}
      </span>
      <input
        ref={inputRef}
        type='text'
        inputMode='numeric'
        enterKeyHint='go'
        title={_('Go to Page')}
        aria-label={_('Go to Page')}
        value={text}
        className='absolute inset-0 h-full w-full bg-transparent text-center focus:outline-none'
        onFocus={() => {
          // Keep the "current / total" text as-is (percentage style swaps to
          // it) and pre-select the page portion for type-over editing.
          setDraft(`${currentLabel} / ${total}`);
          setSelectLength(currentLabel.length);
          setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Keep keystrokes away from the reader's page-turn shortcuts and
          // the footer bar's spatial navigation.
          e.stopPropagation();
          if (e.key === 'Enter') commitDraft();
          else if (e.key === 'Escape') stopEditing();
        }}
      />
    </div>
  );
};

export default PageJumpInput;
