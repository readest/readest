'use client';

import clsx from 'clsx';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ViewSettings } from '@/types/book';
import { eventDispatcher } from '@/utils/event';

interface ParagraphOverlayProps {
  bookKey: string;
  dimOpacity: number;
  viewSettings?: ViewSettings;
  onClose?: () => void;
}

interface ParagraphContent {
  id: number;
  html: string;
  state: 'entering' | 'active' | 'exiting';
}

const AnimatedParagraph: React.FC<{
  html: string;
  state: 'entering' | 'active' | 'exiting';
  style: React.CSSProperties;
}> = ({ html, state, style }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timer = requestAnimationFrame(() => setIsReady(true));
    return () => cancelAnimationFrame(timer);
  }, [html]);

  const showContent = state === 'active' && isReady;

  return (
    <div
      ref={contentRef}
      className={clsx(
        'paragraph-content text-base-content w-full',
        'duration-400 transition-all ease-out',
        state === 'entering' && 'translate-y-4 opacity-0',
        state === 'active' &&
          (showContent ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'),
        state === 'exiting' && '-translate-y-8 opacity-0',
      )}
      style={{ ...style, transformOrigin: 'center top' }}
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
  onClose,
}) => {
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
    } as React.CSSProperties;
  }, [viewSettings]);

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
    (range: Range) => {
      const html = extractContent(range);
      if (!html) return;

      const newId = ++paragraphIdCounter.current;

      setParagraphs((prev) => {
        const updated = prev
          .filter((p) => p.state !== 'exiting')
          .map((p) => ({ ...p, state: p.state === 'active' ? ('exiting' as const) : p.state }));
        return [...updated, { id: newId, html, state: 'entering' as const }];
      });

      requestAnimationFrame(() => {
        setTimeout(() => {
          setParagraphs((prev) =>
            prev.map((p) => (p.id === newId ? { ...p, state: 'active' as const } : p)),
          );
        }, 30);
      });

      setTimeout(() => {
        setParagraphs((prev) => prev.filter((p) => p.state !== 'exiting'));
      }, 450);
    },
    [extractContent],
  );

  useEffect(() => {
    let sectionChangeTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleFocus = (event: CustomEvent) => {
      if (event.detail?.bookKey !== bookKey) return;
      const range = event.detail?.range;
      if (range) {
        if (sectionChangeTimeoutId) {
          clearTimeout(sectionChangeTimeoutId);
          sectionChangeTimeoutId = null;
        }
        setIsChangingSection(false);
        setIsVisible(true);
        requestAnimationFrame(() => {
          setIsOverlayMounted(true);
          requestAnimationFrame(() => addParagraph(range));
        });
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
      setParagraphs((prev) => prev.map((p) => ({ ...p, state: 'exiting' as const })));
      setIsChangingSection(true);
      sectionChangeTimeoutId = setTimeout(() => {
        setParagraphs((prev) => prev.filter((p) => p.state !== 'exiting'));
        sectionChangeTimeoutId = null;
      }, 400);
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

      switch (e.key) {
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          onCloseRef.current?.();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
        case ' ':
        case 'j':
          e.preventDefault();
          eventDispatcher.dispatch('paragraph-next', { bookKey });
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'k':
          e.preventDefault();
          eventDispatcher.dispatch('paragraph-prev', { bookKey });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isVisible, bookKey]);

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

        if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 50) {
          if (diffY > 0) {
            eventDispatcher.dispatch('paragraph-next', { bookKey });
          } else {
            eventDispatcher.dispatch('paragraph-prev', { bookKey });
          }
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
    [bookKey],
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

      const containerWidth = contentRef.current?.offsetWidth ?? window.innerWidth;
      const rect = contentRef.current?.getBoundingClientRect();
      const clickX = e.clientX - (rect?.left ?? 0);

      if (clickX < containerWidth / 3) {
        eventDispatcher.dispatch('paragraph-prev', { bookKey });
      } else if (clickX > (containerWidth * 2) / 3) {
        eventDispatcher.dispatch('paragraph-next', { bookKey });
      }
    },
    [bookKey],
  );

  if (!isVisible) return null;

  const activeParagraph = paragraphs.find((p) => p.state === 'active' || p.state === 'entering');
  const exitingParagraph = paragraphs.find((p) => p.state === 'exiting');

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
      }}
      onClick={handleBackdropClick}
      onTouchStart={handleTouchStart}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={contentRef}
        className='relative flex w-full max-w-3xl cursor-default flex-col items-center px-8'
        onClick={handleContentClick}
      >
        {exitingParagraph && !isChangingSection && (
          <div
            key={exitingParagraph.id}
            className={clsx(
              'paragraph-content text-base-content/20 absolute w-full',
              'duration-400 transition-all ease-out',
              '-translate-y-12 scale-95 opacity-0',
            )}
            style={contentStyle}
            dangerouslySetInnerHTML={{ __html: exitingParagraph.html }}
          />
        )}

        {activeParagraph ? (
          <AnimatedParagraph
            key={activeParagraph.id}
            html={activeParagraph.html}
            state={activeParagraph.state}
            style={contentStyle}
          />
        ) : isChangingSection ? (
          <SectionTransitionIndicator isVisible={isChangingSection} direction={sectionDirection} />
        ) : null}
      </div>
    </div>
  );
};

export default ParagraphOverlay;
