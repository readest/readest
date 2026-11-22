'use client';

import React, { useRef, useState } from 'react';

import Popup from '@/components/Popup';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { Position } from '@/utils/sel';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
  lookupToPin,
  type UseDictionaryResultsArgs,
  type VocabularyCapture,
} from './DictionaryResultsView';
import type { DictionarySelectionContext } from '@/services/dictionaries/types';

interface DictionaryPopupProps {
  word: string;
  lang?: string;
  selection?: DictionarySelectionContext;
  /** Save this lookup to the vocabulary builder and show the Learning / Mastered chips. */
  capture?: VocabularyCapture;
  /** Ask the AI context dictionary alone (the Context Dictionary tool, #7497). */
  contextOnly?: boolean;
  position: Position;
  trianglePosition: Position;
  popupWidth: number;
  popupHeight: number;
  onDismiss?: () => void;
  /**
   * Invoked when the user clicks the header gear. The host (Annotator)
   * decides how to navigate — typically by opening the SettingsDialog and
   * deep-linking to the dictionaries sub-page.
   */
  onManage?: () => void;
  /** Move the lookup on screen into the Notebook's Dictionary tab (#7730). */
  onPin?: (lookup: UseDictionaryResultsArgs) => void;
}

type Box = { x: number; y: number; w: number; h: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

// Corner-grip resizing (#7344) and title-row moving (#7713), like the full
// Read Aloud player's grip. The box lives in this component only, so the next
// lookup opens at the default size. A resized or moved popup lets go of the
// word: it drops its triangle, stays inside the book's cell, grows from its
// top-start corner and never gets smaller than the size it opened at.
const usePopupBox = (padding: number) => {
  const [box, setBox] = useState<Box | null>(null);
  const openedRef = useRef<Box | null>(null);
  const dragRef = useRef<{
    move: boolean;
    x: number;
    y: number;
    start: Box;
    rtl: boolean;
    cellW: number;
    cellH: number;
  } | null>(null);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, move: boolean) => {
    const el = e.currentTarget.closest<HTMLElement>('.popup-container');
    const cell = el?.offsetParent;
    if (e.button !== 0 || !el || !cell) return;
    const start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    openedRef.current ??= start;
    dragRef.current = {
      move,
      x: e.clientX,
      y: e.clientY,
      start,
      rtl: getComputedStyle(el).direction === 'rtl',
      cellW: cell.clientWidth,
      cellH: cell.clientHeight,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const opened = openedRef.current;
    if (!drag || !opened) return;
    const { start, rtl, cellW, cellH } = drag;
    if (drag.move) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      // A tap, or a click's jitter, on the title row keeps the popup on its word.
      if (!box && Math.hypot(dx, dy) < 4) return;
      setBox({
        x: clamp(start.x + dx, padding, cellW - padding - start.w),
        y: clamp(start.y + dy, padding, cellH - padding - start.h),
        w: start.w,
        h: start.h,
      });
      return;
    }
    const dx = (e.clientX - drag.x) * (rtl ? -1 : 1);
    const w = clamp(start.w + dx, opened.w, cellW - 2 * padding);
    const h = clamp(start.h + e.clientY - drag.y, opened.h, cellH - 2 * padding);
    // The corner opposite the grip stays put until the cell's edge pushes it in.
    const x = rtl ? start.x + start.w - w : start.x;
    setBox({
      x: clamp(x, padding, cellW - padding - w),
      y: clamp(start.y, padding, cellH - padding - h),
      w,
      h,
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const dragProps = { onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  return {
    box,
    gripProps: {
      ...dragProps,
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => startDrag(e, false),
    },
    moveProps: {
      ...dragProps,
      // The title row's back, speak and gear buttons keep their clicks.
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        if (!(e.target as Element).closest('button')) startDrag(e, true);
      },
    },
  };
};

const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  word,
  lang,
  selection,
  capture,
  contextOnly,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
  onPin,
}) => {
  const state = useDictionaryResults({ word, lang, selection, capture, contextOnly });
  const handlePin = () =>
    onPin?.(lookupToPin({ word, lang, selection, capture, contextOnly }, state));
  const { box, gripProps, moveProps } = usePopupBox(useResponsiveSize(10));
  return (
    <Popup
      width={popupWidth}
      height={popupHeight}
      position={position}
      trianglePosition={box ? undefined : trianglePosition}
      additionalStyle={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
      className='select-text'
      onDismiss={onDismiss}
    >
      {/* `overflow-hidden rounded-lg` clips the body's section backgrounds /
          borders to the Popup's rounded shape. */}
      <div className='flex h-full flex-col overflow-hidden rounded-lg pt-4'>
        <DictionaryResultsHeader
          headerClassName='-mt-2'
          dragHandleProps={moveProps}
          currentWord={state.currentWord}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
          onPin={onPin && handlePin}
          onSpeak={state.speakWord}
          speaking={state.isSpeaking}
          vocabularyLang={state.vocabularyLang}
          manualVocabularyOccurrence={state.manualVocabularyOccurrence}
        />
        {/* pb-5 ends the body's scrollbar above the resize grip and its hit
            area, which would otherwise cover its down arrow. */}
        <div className='min-h-0 flex-1 pb-5'>
          <DictionaryResultsBody {...state} />
        </div>
      </div>
      {/* Pointer affordance in the bottom-end corner; the popup container is
          its containing block. The 16px icon sits 4px in from the corner, and
          its 32px hit area (DESIGN.md's minimum) reaches 12px past the popup's
          edges, so inside it stays below the body's pb-5. */}
      <div
        {...gripProps}
        data-dictionary-popup-resize
        aria-hidden
        className='text-base-content/40 absolute -bottom-3 -end-3 z-20 h-8 w-8 cursor-nwse-resize touch-none rtl:cursor-nesw-resize'
      >
        <svg viewBox='0 0 16 16' className='absolute bottom-4 end-4 h-4 w-4 rtl:-scale-x-100'>
          <path
            d='M15 6 6 15M15 11l-4 4'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinecap='round'
          />
        </svg>
      </div>
    </Popup>
  );
};

export default DictionaryPopup;
