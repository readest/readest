'use client';

import clsx from 'clsx';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ViewSettings } from '@/types/book';
import { Insets } from '@/types/misc';
import { useEnv } from '@/context/EnvContext';
import { eventDispatcher } from '@/utils/event';
import {
  getParagraphActionForKey,
  getParagraphActionForZone,
  getParagraphLayoutContext,
  ParagraphPresentation,
} from '@/utils/paragraphPresentation';

interface ParagraphOverlayProps {
  bookKey: string;
  dimOpacity: number;
  viewSettings?: ViewSettings;
  gridInsets?: Insets;
  onClose?: () => void;
}

interface ParagraphContent {
  id: number;
  html: string;
  presentation: ParagraphPresentation;
}

const getParagraphTextAlign = (presentation: ParagraphPresentation) =>
  presentation.textAlign || (presentation.vertical ? 'center' : undefined);

const AnimatedParagraph: React.FC<{
  html: string;
  presentation: ParagraphPresentation;
  style: React.CSSProperties;
}> = ({ html, presentation, style }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(false);
    const frame = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(frame);
  }, [html]);

  return (
    <div
      lang={presentation.lang}
      dir={presentation.dir}
      className={clsx(
        'paragraph-content text-base-content transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        presentation.vertical ? 'mx-auto w-auto max-w-none' : 'w-full',
        isReady ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
      style={{
        ...style,
        direction: presentation.dir,
        writingMode: presentation.writingMode as React.CSSProperties['writingMode'],
        textOrientation: presentation.textOrientation as React.CSSProperties['textOrientation'],
        unicodeBidi: presentation.unicodeBidi as React.CSSProperties['unicodeBidi'],
        textAlign: getParagraphTextAlign(presentation) as React.CSSProperties['textAlign'],
        transformOrigin: 'center top',
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

const SectionTransitionIndicator: React.FC<{
  isVisible: boolean;
  direction: 'next' | 'prev';
}> = ({ isVisible, direction }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isVisible) return undefined;
    const timer = requestAnimationFrame(() => {
      setTimeout(() => setIsReady(true), 30);
    });
    return () => {
      cancelAnimationFrame(timer);
      setIsReady(false);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      className={clsx(
        'flex w-full items-center justify-center',
        'duration-400 transition-all ease-out',
        isReady ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      )}
    >
      <div className='flex items-center gap-3'>
        <div className='flex items-center gap-1.5'>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className='bg-base-content/30 h-1.5 w-1.5 rounded-full'
              style={{
                animation: 'pulse 800ms ease-in-out infinite',
                animationDelay: `${i * 150}ms`,
              }}
            />
          ))}
        </div>
        <span className='text-base-content/40 text-base font-medium'>
          {direction === 'next' ? 'Next chapter' : 'Previous chapter'}
        </span>
      </div>
    </div>
  );
};

const ParagraphOverlay: React.FC<ParagraphOverlayProps> = ({
  bookKey,
  dimOpacity,
  viewSettings,
  gridInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  onClose,
}) => {
  const { appService } = useEnv();
  const [paragraphs, setParagraphs] = useState<ParagraphContent[]>([]);
  const [isVisible, setIsVisible] = useState(false);
  const [isOverlayMounted, setIsOverlayMounted] = useState(false);
  const [isChangingSection, setIsChangingSection] = useState(false);
  const [sectionDirection, setSectionDirection] = useState<'next' | 'prev'>('next');
  const paragraphIdCounter = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const lastScrollTime = useRef(0);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const contentStyle = useMemo(() => {
    if (!viewSettings) return {};
    const defaultFontFamily =
      viewSettings.defaultFont?.toLowerCase() === 'serif'
        ? `"${viewSettings.serifFont}", serif`
        : `"${viewSettings.sansSerifFont}", sans-serif`;
    return {
      fontFamily: defaultFontFamily,
      fontSize: `${viewSettings.defaultFontSize || 16}px`,
      lineHeight: viewSettings.lineHeight || 1.6,
      letterSpacing: viewSettings.letterSpacing ? `${viewSettings.letterSpacing}px` : undefined,
      wordSpacing: viewSettings.wordSpacing ? `${viewSettings.wordSpacing}px` : undefined,
      fontWeight: viewSettings.fontWeight || 400,
      WebkitFontSmoothing: 'antialiased',
      fontKerning: 'normal',
      textRendering: 'optimizeLegibility',
    } as React.CSSProperties;
  }, [viewSettings]);

  const activePresentation = paragraphs[0]?.presentation ?? undefined;
  const activeParagraph = paragraphs[0];
  const layoutContext = useMemo(
    () => getParagraphLayoutContext(activePresentation ?? viewSettings),
    [activePresentation, viewSettings],
  );
  const frameStyle = useMemo(() => {
    const topInset = appService?.hasSafeAreaInset ? gridInsets.top : 0;
    const bottomInset = appService?.hasSafeAreaInset ? gridInsets.bottom * 0.33 : 0;
    const viewportPadding = `clamp(1rem, 4vw, 2.5rem)`;

    return {
      boxSizing: 'border-box',
      paddingBlock: layoutContext.vertical
        ? 'clamp(0.9rem, 2.4vh, 1.35rem)'
        : 'clamp(1rem, 3vh, 1.75rem)',
      paddingInline: layoutContext.vertical
        ? 'clamp(0.85rem, 2.8vw, 1.2rem)'
        : 'clamp(1rem, 4vw, 2rem)',
      inlineSize: layoutContext.vertical
        ? 'fit-content'
        : `min(calc(100vw - (${viewportPadding} * 2)), 66ch)`,
      blockSize: layoutContext.vertical ? 'fit-content' : undefined,
      minInlineSize: layoutContext.vertical ? '5.25rem' : undefined,
      maxInlineSize: layoutContext.vertical
        ? `min(calc(100dvh - ${topInset + bottomInset + 80}px), 24rem)`
        : undefined,
      maxBlockSize: layoutContext.vertical
        ? 'min(calc(100vw - 1.5rem), 28rem)'
        : `min(calc(100dvh - ${topInset + bottomInset + 132}px), 38rem)`,
      marginInline: 'auto',
    } as React.CSSProperties;
  }, [appService?.hasSafeAreaInset, gridInsets.bottom, gridInsets.top, layoutContext.vertical]);
  const surfaceStyle = useMemo(
    () =>
      ({
        backgroundColor: 'oklch(var(--b1) / 0.14)',
      }) as React.CSSProperties,
    [],
  );
  const fallbackPresentation = useMemo(
    (): ParagraphPresentation => ({
      dir: layoutContext.rtl ? 'rtl' : 'ltr',
      writingMode: layoutContext.writingMode,
      vertical: layoutContext.vertical,
      rtl: layoutContext.rtl,
    }),
    [layoutContext.rtl, layoutContext.vertical, layoutContext.writingMode],
  );

  const extractContent = useCallback((range: Range): string => {
    try {
      const fragment = range.cloneContents();
      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment);
      return tempDiv.innerHTML;
    } catch {
      return '';
    }
  }, []);

  const addParagraph = useCallback(
    (range: Range, presentation?: ParagraphPresentation) => {
      const html = extractContent(range);
      if (!html) return;

      const newId = ++paragraphIdCounter.current;
      const nextPresentation = presentation ?? fallbackPresentation;

      setParagraphs([{ id: newId, html, presentation: nextPresentation }]);
    },
    [extractContent, fallbackPresentation],
  );

  useEffect(() => {
    let sectionChangeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleFocus = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      const range = event.detail?.range;
      const presentation = event.detail?.presentation;
      if (range) {
        if (sectionChangeTimeoutId) {
          clearTimeout(sectionChangeTimeoutId);
          sectionChangeTimeoutId = null;
        }
        setIsChangingSection(false);
        setIsVisible(true);
        setIsOverlayMounted(true);
        addParagraph(range, presentation);
      }
    };

    const handleDisabled = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      if (sectionChangeTimeoutId) {
        clearTimeout(sectionChangeTimeoutId);
        sectionChangeTimeoutId = null;
      }
      setIsOverlayMounted(false);
      setIsChangingSection(false);
      setTimeout(() => {
        setIsVisible(false);
        setParagraphs([]);
      }, 300);
    };

    const handleSectionChanging = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      setSectionDirection(event.detail?.direction || 'next');
      setParagraphs([]);
      setIsChangingSection(true);
    };

    eventDispatcher.on('paragraph-focus', handleFocus);
    eventDispatcher.on('paragraph-mode-disabled', handleDisabled);
    eventDispatcher.on('paragraph-section-changing', handleSectionChanging);

    return () => {
      if (sectionChangeTimeoutId) clearTimeout(sectionChangeTimeoutId);
      eventDispatcher.off('paragraph-focus', handleFocus);
      eventDispatcher.off('paragraph-mode-disabled', handleDisabled);
      eventDispatcher.off('paragraph-section-changing', handleSectionChanging);
    };
  }, [bookKey, addParagraph]);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        onCloseRef.current?.();
        return;
      }

      const action = getParagraphActionForKey(e.key, activePresentation ?? viewSettings);
      if (action === 'next') {
        e.preventDefault();
        eventDispatcher.dispatch('paragraph-next', { bookKey });
        return;
      }

      if (action === 'prev') {
        e.preventDefault();
        eventDispatcher.dispatch('paragraph-prev', { bookKey });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activePresentation, bookKey, isVisible, viewSettings]);

  useEffect(() => {
    if (!isVisible) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (now - lastScrollTime.current < 150) return;
      lastScrollTime.current = now;

      if (e.deltaY > 0) {
        eventDispatcher.dispatch('paragraph-next', { bookKey });
      } else if (e.deltaY < 0) {
        eventDispatcher.dispatch('paragraph-prev', { bookKey });
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', handleWheel, true);
  }, [isVisible, bookKey]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touchStartY = e.touches[0]?.clientY ?? 0;
      const touchStartX = e.touches[0]?.clientX ?? 0;

      const handleTouchMove = (moveEvent: TouchEvent) => {
        const touchEndY = moveEvent.touches[0]?.clientY ?? 0;
        const touchEndX = moveEvent.touches[0]?.clientX ?? 0;
        const diffY = touchStartY - touchEndY;
        const diffX = touchStartX - touchEndX;
        const horizontalAction =
          diffX > 0
            ? getParagraphActionForZone('right', activePresentation ?? viewSettings)
            : getParagraphActionForZone('left', activePresentation ?? viewSettings);

        if (layoutContext.vertical && Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 50) {
          eventDispatcher.dispatch(diffY > 0 ? 'paragraph-next' : 'paragraph-prev', { bookKey });
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
        } else if (
          !layoutContext.vertical &&
          Math.abs(diffX) > Math.abs(diffY) &&
          Math.abs(diffX) > 50 &&
          horizontalAction
        ) {
          eventDispatcher.dispatch(
            horizontalAction === 'next' ? 'paragraph-next' : 'paragraph-prev',
            { bookKey },
          );
          document.removeEventListener('touchmove', handleTouchMove);
          document.removeEventListener('touchend', handleTouchEnd);
        }
      };

      const handleTouchEnd = () => {
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove);
      document.addEventListener('touchend', handleTouchEnd);
    },
    [activePresentation, bookKey, layoutContext.vertical, viewSettings],
  );

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === containerRef.current) {
      onCloseRef.current?.();
    }
  }, []);

  const lastTapTimeRef = useRef(0);
  const handleContentClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        onCloseRef.current?.();
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      const rect = contentRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const zone = layoutContext.vertical
        ? clickY < rect.height / 3
          ? 'top'
          : clickY > (rect.height * 2) / 3
            ? 'bottom'
            : null
        : clickX < rect.width / 3
          ? 'left'
          : clickX > (rect.width * 2) / 3
            ? 'right'
            : null;

      const action = zone
        ? getParagraphActionForZone(zone, activePresentation ?? viewSettings)
        : null;
      if (action === 'prev') {
        eventDispatcher.dispatch('paragraph-prev', { bookKey });
      } else if (action === 'next') {
        eventDispatcher.dispatch('paragraph-next', { bookKey });
      }
    },
    [activePresentation, bookKey, layoutContext.vertical, viewSettings],
  );

  if (!isVisible) return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={containerRef}
      role='dialog'
      aria-modal='true'
      aria-label='Paragraph reading mode'
      tabIndex={-1}
      className={clsx(
        'fixed inset-0 z-40',
        'flex flex-col items-center justify-center',
        'transition-opacity duration-300 ease-out',
        isOverlayMounted ? 'opacity-100' : 'opacity-0',
      )}
      style={{
        backgroundColor: `oklch(var(--b1) / ${Math.min(dimOpacity + 0.4, 0.92)})`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        paddingTop: appService?.hasSafeAreaInset ? `${gridInsets.top}px` : undefined,
        paddingBottom: appService?.hasSafeAreaInset ? `${gridInsets.bottom * 0.33}px` : undefined,
      }}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={contentRef}
        className={clsx(
          'relative flex w-full cursor-default flex-col items-center px-4 sm:px-6',
          layoutContext.vertical ? 'justify-center py-2' : '',
        )}
        onClick={handleContentClick}
      >
        <style>{`
          .paragraph-content {
            text-wrap: pretty;
          }

          .paragraph-content :is(h1, h2, h3, h4, h5, h6) {
            line-height: 1.2;
            text-wrap: balance;
            margin-block-end: 0.45em;
          }

          .paragraph-content > :first-child {
            margin-block-start: 0;
          }

          .paragraph-content > :last-child {
            margin-block-end: 0;
          }
        `}</style>
        {activeParagraph ? (
          <div
            className={clsx(
              'relative rounded-[2rem]',
              layoutContext.vertical
                ? 'inline-flex items-center justify-center self-center overflow-visible'
                : 'w-full overflow-auto',
            )}
            style={{ ...frameStyle, ...surfaceStyle }}
          >
            <AnimatedParagraph
              key={activeParagraph.id}
              html={activeParagraph.html}
              presentation={activeParagraph.presentation}
              style={contentStyle}
            />
          </div>
        ) : isChangingSection ? (
          <SectionTransitionIndicator isVisible={isChangingSection} direction={sectionDirection} />
        ) : null}
      </div>
    </div>
  );
};

export default ParagraphOverlay;
