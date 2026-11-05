'use client';

import React, { useRef, useState } from 'react';

import Popup from '@/components/Popup';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { Position } from '@/utils/sel';
import {
  useDictionaryResults,
  DictionaryResultsHeader,
  DictionaryResultsBody,
  type VocabularyCapture,
} from './DictionaryResultsView';
import type { DictionarySelectionContext } from '@/services/dictionaries/types';

interface DictionaryPopupProps {
  word: string;
  lang?: string;
  selection?: DictionarySelectionContext;
  /** Save this lookup to the vocabulary builder and show the Learning / Mastered chips. */
  capture?: VocabularyCapture;
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
}

type Box = { x: number; y: number; w: number; h: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

// Corner-grip resizing (#7344), like the full Read Aloud player's. The size
// lives in this component only, so the next lookup opens at the default size.
// A resized popup lets go of the word: it drops its triangle and grows from its
// top-start corner, inside the book's cell and never below the size it opened at.
const usePopupResize = (padding: number) => {
  const [box, setBox] = useState<Box | null>(null);
  const openedRef = useRef<Box | null>(null);
  const dragRef = useRef<{
    x: number;
    y: number;
    start: Box;
    rtl: boolean;
    cellW: number;
    cellH: number;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget.closest<HTMLElement>('.popup-container');
    const cell = el?.offsetParent;
    if (e.button !== 0 || !el || !cell) return;
    const start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    openedRef.current ??= start;
    dragRef.current = {
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

  return {
    box,
    gripProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
};

const DictionaryPopup: React.FC<DictionaryPopupProps> = ({
  word,
  lang,
  selection,
  capture,
  position,
  trianglePosition,
  popupWidth,
  popupHeight,
  onDismiss,
  onManage,
}) => {
  const state = useDictionaryResults({ word, lang, selection, capture });
  const { box, gripProps } = usePopupResize(useResponsiveSize(10));
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
          currentWord={state.currentWord}
          canGoBack={state.canGoBack}
          goBack={state.goBack}
          onManage={onManage}
          onSpeak={state.speakWord}
          speaking={state.isSpeaking}
          vocabularyLang={state.vocabularyLang}
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
