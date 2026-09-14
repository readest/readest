import clsx from 'clsx';
import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';
import { MdArrowBackIosNew, MdArrowForwardIos } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useDrag } from '@/hooks/useDrag';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { getDirFromUILanguage } from '@/utils/rtl';
import { eventDispatcher } from '@/utils/event';
import { Overlay } from './Overlay';

const VELOCITY_THRESHOLD = 0.5;
const SNAP_THRESHOLD = 0.2;
// How far a downward swipe that starts on the sheet body must travel before it
// takes the gesture over from the content. Below it the touch still belongs to
// the content, so taps and scrolls are unaffected.
const SWIPE_DISMISS_THRESHOLD = 8;
// How long the modal takes to fade and scale away once `isOpen` goes false.
const CLOSE_TRANSITION_MS = 300;

interface DialogProps {
  id?: string;
  isOpen: boolean;
  children: ReactNode;
  snapHeight?: number;
  dismissible?: boolean;
  header?: ReactNode;
  title?: string;
  className?: string;
  bgClassName?: string;
  boxClassName?: string;
  contentClassName?: string;
  /**
   * Replace the body's native `overflow-y-auto` with OverlayScrollbars so
   * the scrollbar is the floating, theme-aware kind instead of the host's
   * native one (which Android/iOS webviews auto-hide entirely, leaving the
   * user with no visible scrollbar). Opt-in per dialog — set true for
   * long-content dialogs like Settings; leave false for short modals where
   * native scrolling is fine.
   */
  useOverlayScroll?: boolean;
  onClose: () => void;
}

// A swipe that starts on a scroller which is not at its top belongs to that
// scroller: the user is scrolling back up, not dismissing the sheet.
const hasScrolledAncestor = (target: HTMLElement, root: HTMLElement) => {
  for (let el: HTMLElement | null = target; el && el !== root; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
};

// Dragging inside a text field moves the caret; it must never close the sheet
// the field lives in (the Annotate note editor is one).
const isEditable = (target: HTMLElement) =>
  !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

const Dialog: React.FC<DialogProps> = ({
  id,
  isOpen,
  children,
  snapHeight,
  dismissible = true,
  header,
  title,
  className,
  bgClassName,
  boxClassName,
  contentClassName,
  useOverlayScroll = false,
  onClose,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { systemUIVisible, statusBarHeight, safeAreaInsets } = useThemeStore();
  const { acquireBackKeyInterception, releaseBackKeyInterception } = useDeviceControlStore();
  const [isFullHeightInMobile, setIsFullHeightInMobile] = useState(!snapHeight);
  const [isRtl] = useState(() => getDirFromUILanguage() === 'rtl');
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Where the finger sits relative to the sheet's top edge, so the sheet slides
  // with it instead of snapping its top edge under it — the drag handle sits at
  // that edge, the body does not.
  const dragOffsetRef = useRef(0);
  const pendingSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const iconSize22 = useResponsiveSize(22);
  const isMobile = window.innerWidth < 640 || window.innerHeight < 640;

  // Callers gate the body on the same flag they pass as `isOpen`
  // (`<Dialog isOpen={open}>{open && <Body />}</Dialog>`), so the body would
  // vanish on the frame the close starts and the box would collapse onto its
  // title bar for the length of the fade. Keep the last body until the fade is
  // over. The closing render picks it up itself rather than an effect handing
  // it back: an effect only runs once React has already committed the tree
  // without it, and a passive one only once the browser may have painted that.
  // The state below just ends the hold.
  const lastBodyRef = useRef<ReactNode>(null);
  const [isBodyHoldOver, setIsBodyHoldOver] = useState(false);
  if (isOpen) lastBodyRef.current = children;
  const body = isOpen ? children : isBodyHoldOver ? null : lastBodyRef.current;

  useEffect(() => {
    if (isOpen) {
      setIsBodyHoldOver(false);
      return;
    }
    const timer = setTimeout(() => setIsBodyHoldOver(true), CLOSE_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent | CustomEvent) => {
    if (event instanceof CustomEvent) {
      if (event.detail.keyName === 'Back') {
        onClose();
        return true;
      }
    } else {
      if (event.key === 'Escape') {
        onClose();
      }
      event.stopPropagation();
    }
    return false;
  };

  useEffect(() => {
    if (!isOpen) {
      if (previousActiveElementRef.current) {
        previousActiveElementRef.current.focus();
        previousActiveElementRef.current = null;
      }
      return;
    }

    previousActiveElementRef.current = document.activeElement as HTMLElement;

    setIsFullHeightInMobile(!snapHeight && isMobile);
    window.addEventListener('keydown', handleKeyDown);
    if (dialogRef.current) {
      dialogRef.current.addEventListener('keydown', handleKeyDown);
    }
    if (appService?.isAndroidApp) {
      acquireBackKeyInterception();
      eventDispatcher.onSync('native-key-down', handleKeyDown);
    }

    const timer = setTimeout(() => {
      if (dialogRef.current) {
        dialogRef.current.focus();
      }
    }, 100);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      if (appService?.isAndroidApp) {
        releaseBackKeyInterception();
        eventDispatcher.offSync('native-key-down', handleKeyDown);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleDragMove = (data: { clientY: number; deltaY: number }) => {
    if (!dismissible || !isMobile || !dialogRef.current) return;

    const modal = dialogRef.current.querySelector('.modal-box') as HTMLElement;
    const overlay = dialogRef.current.querySelector('.overlay') as HTMLElement;

    const top = data.clientY - dragOffsetRef.current;
    const heightFraction = top / window.innerHeight;
    const newTop = Math.max(0.0, Math.min(1, heightFraction));

    if (modal && overlay) {
      modal.style.height = '100%';
      modal.style.transform = `translateY(${newTop * 100}%)`;
      overlay.style.opacity = `${1 - heightFraction}`;

      setIsFullHeightInMobile(top < 44);
      modal.style.transition = `padding-top 0.3s ease-out`;
    }
  };

  const handleDragEnd = (data: { velocity: number; clientY: number; canceled: boolean }) => {
    if (!dismissible || !isMobile || !dialogRef.current) return;
    const modal = dialogRef.current.querySelector('.modal-box') as HTMLElement;
    const overlay = dialogRef.current.querySelector('.overlay') as HTMLElement;
    if (!modal || !overlay) return;

    const top = data.clientY - dragOffsetRef.current;
    const snapUpper = snapHeight ? 1 - snapHeight - SNAP_THRESHOLD : 0.5;
    const snapLower = snapHeight ? 1 - snapHeight + SNAP_THRESHOLD : 0.5;
    // A cancelled drag is the system taking the touch away, not the user letting
    // go: put the sheet back where it was rather than reading a decision into it.
    if (
      !data.canceled &&
      (data.velocity > VELOCITY_THRESHOLD ||
        (data.velocity >= 0 && top >= window.innerHeight * snapLower))
    ) {
      // dialog is dismissed
      const transitionDuration = 0.15 / Math.max(data.velocity, 0.5);
      modal.style.height = '100%';
      modal.style.transition = `transform ${transitionDuration}s ease-out`;
      modal.style.transform = 'translateY(100%)';
      overlay.style.transition = `opacity ${transitionDuration}s ease-out`;
      overlay.style.opacity = '0';
      onClose();
      setTimeout(() => {
        modal.style.transform = 'translateY(0%)';
      }, 300);
    } else if (
      snapHeight &&
      (data.canceled ||
        (top > window.innerHeight * snapUpper && top < window.innerHeight * snapLower))
    ) {
      // dialog is snapped
      overlay.style.transition = `opacity 0.3s ease-out`;
      overlay.style.opacity = `${1 - snapHeight}`;
      modal.style.height = `${snapHeight * 100}%`;
      modal.style.bottom = '0';
      modal.style.transition = `transform 0.3s ease-out`;
      modal.style.transform = '';
    } else {
      // dialog is opened without snap
      setIsFullHeightInMobile(true);
      modal.style.height = '100%';
      modal.style.transition = `transform 0.3s ease-out`;
      modal.style.transform = `translateY(0%)`;
      overlay.style.opacity = '0';
    }
    if (appService?.hasHaptics && !data.canceled) {
      impactFeedback('medium');
    }
  };

  const handleDragKeyDown = () => {};

  const { handleDragStart } = useDrag(handleDragMove, handleDragKeyDown, handleDragEnd);

  const beginDrag = (e: React.MouseEvent | React.TouchEvent) => {
    const modal = dialogRef.current?.querySelector('.modal-box') as HTMLElement | null;
    const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY;
    dragOffsetRef.current = modal ? clientY - modal.getBoundingClientRect().top : 0;
    handleDragStart(e);
  };

  // The drag handle is a 24px strip at the top of the sheet, out of reach of the
  // thumb that just finished reading (#6089), so a downward swipe anywhere on the
  // sheet dismisses it too. It only takes over once the finger has clearly gone
  // down rather than sideways, and only when the content under it has nothing
  // left to scroll — so the sheet never steals a tap, a scroll or a page swipe.
  const handleSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    pendingSwipeRef.current = null;
    if (!dismissible || !isMobile || e.touches.length !== 1) return;
    const target = e.target as HTMLElement;
    // The handle starts its own drag on touchstart; don't arm a second one.
    if (target.closest('.drag-handle')) return;
    if (isEditable(target) || hasScrolledAncestor(target, e.currentTarget)) return;
    const touch = e.touches[0]!;
    pendingSwipeRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    const pending = pendingSwipeRef.current;
    if (!pending || e.touches.length !== 1) return;
    const touch = e.touches[0]!;
    const deltaX = touch.clientX - pending.x;
    const deltaY = touch.clientY - pending.y;
    if (Math.abs(deltaX) > Math.abs(deltaY) || deltaY < -SWIPE_DISMISS_THRESHOLD) {
      // Sideways, or upwards: the gesture belongs to the content.
      pendingSwipeRef.current = null;
      return;
    }
    if (deltaY < SWIPE_DISMISS_THRESHOLD) return;
    pendingSwipeRef.current = null;
    beginDrag(e);
  };

  // Android hands the touch to its own selection handles once a long press turns
  // into a selection drag, and cancels the page's sequence; disarm with it.
  const handleSheetTouchCancel = () => {
    pendingSwipeRef.current = null;
  };

  return (
    <dialog
      ref={dialogRef}
      id={id ?? 'dialog'}
      tabIndex={-1}
      open={isOpen}
      aria-label={title}
      aria-hidden={!isOpen}
      className={clsx(
        'modal sm:min-w-90 z-50 h-full w-full items-start! bg-transparent! sm:w-full sm:items-center!',
        className,
      )}
      dir={isRtl ? 'rtl' : undefined}
    >
      <Overlay
        captureBlocking={isOpen}
        className={clsx(
          'dialog-overlay z-10 bg-black/50 sm:bg-black/50',
          appService?.hasRoundedWindow && 'rounded-window',
          bgClassName,
        )}
        onDismiss={onClose}
      />
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchCancel={handleSheetTouchCancel}
        className={clsx(
          'modal-box settings-content absolute z-20 flex flex-col rounded-none rounded-tl-2xl rounded-tr-2xl p-0 sm:rounded-2xl',
          'h-full max-h-full w-full max-w-full',
          window.innerWidth < window.innerHeight
            ? 'sm:h-[50%] sm:w-3/4'
            : 'sm:h-[65%] sm:w-1/2 sm:max-w-[600px]',
          boxClassName,
        )}
        style={{
          paddingTop:
            appService?.hasSafeAreaInset && isFullHeightInMobile
              ? `${Math.max(safeAreaInsets?.top || 0, systemUIVisible ? statusBarHeight : 0)}px`
              : '0px',
          ...(isMobile
            ? snapHeight
              ? { height: `${snapHeight * 100}%`, top: 'auto', bottom: 0 }
              : { height: '100%', bottom: 0 }
            : {}),
        }}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className={clsx(
            'drag-handle mb-2 h-6 max-h-6 min-h-6 w-full cursor-row-resize items-center justify-center',
            'transition-padding-top flex duration-300 ease-out sm:hidden',
          )}
          onMouseDown={beginDrag}
          onTouchStart={beginDrag}
        >
          <div className='bg-base-content/50 h-1 w-10 rounded-full'></div>
        </div>
        <div className='dialog-header sticky top-1 z-10 flex items-center justify-between px-2 sm:pe-3 sm:ps-2'>
          {header ? (
            header
          ) : (
            <div className='flex h-11 w-full items-center justify-between'>
              <button
                aria-label={_('Close')}
                aria-hidden={!isOpen}
                onClick={onClose}
                disabled={!dismissible}
                className={
                  'btn btn-ghost btn-circle flex h-8 min-h-8 w-8 hover:bg-transparent focus:outline-hidden disabled:bg-transparent sm:hidden'
                }
              >
                {isRtl ? (
                  <MdArrowForwardIos size={iconSize22} />
                ) : (
                  <MdArrowBackIosNew size={iconSize22} />
                )}
              </button>
              <div className='z-15 pointer-events-none absolute inset-0 flex h-11 items-center justify-center'>
                <span className='line-clamp-1 text-center font-bold'>{title ?? ''}</span>
              </div>
              <button
                aria-label={_('Close')}
                aria-hidden={!isOpen}
                onClick={onClose}
                disabled={!dismissible}
                className={
                  'bg-base-300/65 btn btn-ghost btn-circle ml-auto hidden h-6 min-h-6 w-6 focus:outline-hidden sm:flex'
                }
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  width='1em'
                  height='1em'
                  viewBox='0 0 24 24'
                >
                  <path
                    fill='currentColor'
                    d='M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12z'
                  />
                </svg>
              </button>
            </div>
          )}
        </div>

        {useOverlayScroll ? (
          // OverlayScrollbarsComponent owns the scroller; the inner viewport
          // gets `overflow-y-auto` automatically. Keep the same flex /
          // padding chassis so the body still occupies remaining height
          // and the children's horizontal rhythm is unchanged.
          <OverlayScrollbarsComponent
            className={clsx('text-base-content my-2 grow px-6 sm:px-[10%]', contentClassName)}
            options={{
              scrollbars: { autoHide: 'scroll', clickScroll: true },
              showNativeOverlaidScrollbars: false,
            }}
            defer
          >
            {body}
          </OverlayScrollbarsComponent>
        ) : (
          <div
            className={clsx(
              'text-base-content my-2 grow overflow-y-auto px-6 sm:px-[10%]',
              contentClassName,
            )}
          >
            {body}
          </div>
        )}
      </div>
    </dialog>
  );
};

export default Dialog;
