import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';
import { useEnv } from '@/context/EnvContext';
import { Insets } from '@/types/misc';
import { eventDispatcher } from '@/utils/event';
import { canShareText } from '@/utils/share';
import { dataUrlToBytes, imageExtensionFromMime } from '@/utils/image';
import ZoomControls from './ZoomControls';

interface ImageViewerProps {
  gridInsets: Insets;
  src: string | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2;
const WHEEL_SENSITIVITY = 0.001;

const ImageViewer: React.FC<ImageViewerProps> = ({
  src,
  onClose,
  onPrevious,
  onNext,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  // On Android the button saves straight to the photo gallery (the share sheet
  // can't save to a file there); elsewhere it shares where supported, else
  // exports. The affordance reflects the actual action.
  const saveToGallery = appService?.isAndroidApp ?? false;
  const canShare = !saveToGallery && canShareText(appService);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  const [showZoomLabel, setShowZoomLabel] = useState(true);
  const lastTouchDistance = useRef<number>(0);
  const dragStart = useRef({ x: 0, y: 0 });
  const wasDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const zoomLabelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelZoomEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Escape (desktop) and Android Back key → close the viewer.
  useKeyDownActions({ onCancel: onClose });

  // A macOS trackpad pinch arrives as a rapid stream of ctrl+wheel events.
  // Flag the gesture as active so the transform transition is suppressed while
  // it streams (see the transition note below), then clear it shortly after the
  // last event since wheel has no explicit gesture-end.
  const markWheelZooming = () => {
    setIsWheelZooming(true);
    if (wheelZoomEndTimeoutRef.current) {
      clearTimeout(wheelZoomEndTimeoutRef.current);
    }
    wheelZoomEndTimeoutRef.current = setTimeout(() => {
      setIsWheelZooming(false);
    }, 200);
  };

  const hideZoomLabelAfterDelay = () => {
    if (zoomLabelTimeoutRef.current) {
      clearTimeout(zoomLabelTimeoutRef.current);
    }
    setShowZoomLabel(true);
    zoomLabelTimeoutRef.current = setTimeout(() => {
      setShowZoomLabel(false);
    }, 2000);
  };

  const handleZoomIn = () => {
    const newScale = Math.min(scale * ZOOM_STEP, MAX_SCALE);
    setScale(newScale);
    hideZoomLabelAfterDelay();
  };

  const handleZoomOut = () => {
    const newScale = Math.max(scale / ZOOM_STEP, MIN_SCALE);
    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
    }
    setScale(newScale);
    hideZoomLabelAfterDelay();
  };

  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    hideZoomLabelAfterDelay();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();

    // Escape is handled by useKeyDownActions (also covers Android Back key).

    // Arrow key navigation
    if (e.key === 'ArrowLeft' && onPrevious) {
      e.preventDefault();
      handlePreviousImage();
      return;
    }

    if (e.key === 'ArrowRight' && onNext) {
      e.preventDefault();
      handleNextImage();
      return;
    }

    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (isCtrlOrCmd) {
      e.preventDefault();

      if (e.key === '=' || e.key === '+') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoom();
      }
    }
  };

  const handlePreviousImage = () => {
    if (onPrevious) {
      onPrevious();
      hideZoomLabelAfterDelay();
    }
  };

  const handleNextImage = () => {
    if (onNext) {
      onNext();
      hideZoomLabelAfterDelay();
    }
  };

  const getZoomedOffset = (
    anchorX: number,
    anchorY: number,
    currentScale: number,
    nextScale: number,
    currentPos: { x: number; y: number },
  ) => {
    const scaleChange = nextScale / currentScale;
    return {
      x: anchorX - (anchorX - currentPos.x) * scaleChange,
      y: anchorY - (anchorY - currentPos.y) * scaleChange,
    };
  };

  // Grab Focus of modal and set up initial zoom label timeout
  useEffect(() => {
    containerRef.current?.focus();
    setTimeout(() => {
      hideZoomLabelAfterDelay();
    }, 0);

    return () => {
      if (zoomLabelTimeoutRef.current) {
        clearTimeout(zoomLabelTimeoutRef.current);
      }
      if (wheelZoomEndTimeoutRef.current) {
        clearTimeout(wheelZoomEndTimeoutRef.current);
      }
    };
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    // Only zoom when Ctrl/Cmd is pressed for consistency with browser behavior
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;

    if (!isCtrlOrCmd) {
      // Allow default behavior (no zoom without modifier)
      return;
    }

    e.preventDefault();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    markWheelZooming();

    const delta = e.deltaY;
    const newScale = Math.min(
      Math.max(scale * Math.exp(-delta * WHEEL_SENSITIVITY), MIN_SCALE),
      MAX_SCALE,
    );

    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
      setScale(newScale);
      hideZoomLabelAfterDelay();
      return;
    }

    // Mouse position relative to the container element
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;

    setPosition((prevPos) => {
      return getZoomedOffset(mouseX, mouseY, scale, newScale, prevPos);
    });

    setScale(newScale);
    hideZoomLabelAfterDelay();
  };

  const handleImageMouseDown = (e: React.MouseEvent) => {
    if (isDragging || scale <= 1) return;
    e.stopPropagation();
    e.preventDefault();

    setIsDragging(true);
    wasDragging.current = false;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  // Track the drag on `window` (not the moving <img>) so the pan keeps
  // following the pointer even when it crosses the image boundary. Binding the
  // move/up handlers to the image meant the cursor leaving the lagging image
  // aborted and restarted the drag, which flickered on desktop (#4451). This
  // mirrors the touch path, which tracks on the full-screen container.
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      wasDragging.current = true;
      setPosition({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const onTouchStart = (e: React.TouchEvent) => {
    const touches = e.touches;

    if (touches.length === 1 && scale > 1) {
      // Pan Start
      setIsDragging(true);
      wasDragging.current = false;
      const touch = touches[0];
      if (!touch) return;
      dragStart.current = {
        x: touch.clientX - position.x,
        y: touch.clientY - position.y,
      };
    } else if (touches.length === 2) {
      // Pinch Start
      setIsDragging(true);
      wasDragging.current = false;
      const touch1 = touches[0];
      const touch2 = touches[1];
      if (!touch1 || !touch2) return;
      lastTouchDistance.current = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );
      hideZoomLabelAfterDelay();
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const touches = e.touches;

    if (touches.length === 1 && scale > 1 && isDragging) {
      // Pan
      wasDragging.current = true;
      const touch = touches[0];
      if (!touch) return;

      requestAnimationFrame(() => {
        const newX = touch.clientX - dragStart.current.x;
        const newY = touch.clientY - dragStart.current.y;

        setPosition({ x: newX, y: newY });
      });
    } else if (touches.length === 2) {
      // Pinch
      wasDragging.current = true;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const touch1 = touches[0];
      const touch2 = touches[1];
      if (!touch1 || !touch2) return;
      const currentDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );
      const distanceChange = currentDistance / lastTouchDistance.current;

      requestAnimationFrame(() => {
        const newScale = Math.min(Math.max(scale * distanceChange, MIN_SCALE), MAX_SCALE);

        if (newScale <= 1) {
          setPosition({ x: 0, y: 0 });
          setScale(newScale);
          hideZoomLabelAfterDelay();
          return;
        }

        // Touch position relative to the container element
        const touchX = (touch1.clientX + touch2.clientX) / 2 - rect.left - rect.width / 2;
        const touchY = (touch1.clientY + touch2.clientY) / 2 - rect.top - rect.height / 2;

        setPosition((prevPos) => {
          return getZoomedOffset(touchX, touchY, scale, newScale, prevPos);
        });

        setScale(newScale);

        lastTouchDistance.current = currentDistance;
        hideZoomLabelAfterDelay();
      });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const touches = e.touches;
    if (touches.length === 1) {
      const touch = touches[0];
      if (!touch) return;
      dragStart.current = {
        x: touch.clientX - position.x,
        y: touch.clientY - position.y,
      };
    }
    if (touches.length === 0) {
      setIsDragging(false);
    }
  };

  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    hideZoomLabelAfterDelay();
  };

  // Save the currently viewed image to the device. `appService.saveFile`
  // routes to the native/web Share sheet where available and falls back to a
  // save dialog / browser download otherwise.
  const handleSaveImage = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!src || !appService) return;
    // Anchor the macOS / iPad share popover to the button rect (mirrors the
    // annotation export flow); ignored on platforms that don't use it.
    const rect = e.currentTarget.getBoundingClientRect();
    const sharePosition = {
      x: rect.left + rect.width / 2,
      y: rect.top,
      preferredEdge: 'bottom' as const,
    };
    try {
      const { bytes, mimeType } = dataUrlToBytes(decodeURIComponent(src));
      const filename = `image.${imageExtensionFromMime(mimeType)}`;
      if (saveToGallery) {
        const saved = await appService.saveImageToGallery(
          filename,
          bytes.buffer as ArrayBuffer,
          mimeType,
        );
        eventDispatcher.dispatch('toast', {
          type: saved ? 'info' : 'error',
          message: saved ? _('Image saved to gallery') : _('Failed to save the image'),
        });
        return;
      }
      const saved = await appService.saveFile(filename, bytes.buffer as ArrayBuffer, {
        share: true,
        mimeType,
        sharePosition,
      });
      // The Share sheet provides its own feedback; only confirm the export path.
      if (!canShare) {
        eventDispatcher.dispatch('toast', {
          type: saved ? 'info' : 'error',
          message: saved ? _('Image saved successfully') : _('Failed to save the image'),
        });
      }
    } catch (error) {
      console.error('Failed to save image:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to save the image'),
      });
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    if (scale === 1) {
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const newScale = 2;

      setPosition((prevPos) => {
        return getZoomedOffset(mouseX, mouseY, scale, newScale, prevPos);
      });
      setScale(newScale);
      hideZoomLabelAfterDelay();
    } else {
      handleReset();
    }
  };

  const handleContainerClick = () => {
    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }
    onClose();
  };

  const handleImageClick = (e: React.MouseEvent) => {
    // Stop propagation to prevent closing when clicking on the image
    e.stopPropagation();

    // Don't toggle label if user was dragging
    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }

    setShowZoomLabel((prev) => !prev);
  };

  const cursorStyle = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';

  if (!src) return null;

  return (
    // `no-context-menu` suppresses the WebView's native long-press image
    // callout (via the `.no-context-menu img` rule). On Android it otherwise
    // collides with the pinch/pan handlers below and freezes the app.
    <div
      ref={containerRef}
      data-capture-blocking-overlay='true'
      tabIndex={-1}
      role='button'
      aria-label={_('Image viewer')}
      className='no-context-menu fixed inset-0 z-50 flex items-center justify-center outline-none'
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        role='button'
        tabIndex={0}
        className='image-viewer-overlay not-eink:bg-black/50 eink:bg-base-100 not-eink:backdrop-blur-md absolute inset-0'
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClose();
          }
        }}
      />
      <ZoomControls
        gridInsets={gridInsets}
        canShare={canShare}
        onClose={onClose}
        onSave={handleSaveImage}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
      />

      {onPrevious && showZoomLabel && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePreviousImage();
          }}
          className='eink-bordered absolute left-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-all duration-300 hover:bg-black/70'
          aria-label={_('Previous Image')}
          title={_('Previous Image')}
        >
          <IoChevronBack className='h-8 w-8' />
        </button>
      )}

      {onNext && showZoomLabel && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleNextImage();
          }}
          className='eink-bordered absolute right-4 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-all duration-300 hover:bg-black/70'
          aria-label={_('Next Image')}
          title={_('Next Image')}
        >
          <IoChevronForward className='h-8 w-8' />
        </button>
      )}

      <div
        role='none'
        className={clsx('relative flex h-full w-full items-center justify-center overflow-hidden')}
        onClick={handleContainerClick}
      >
        <img
          role='none'
          src={decodeURIComponent(src)}
          ref={imageRef}
          alt={_('Zoomed')}
          className='transform-gpu select-none object-contain'
          draggable={false}
          width={0}
          height={0}
          sizes='100vw'
          onClick={handleImageClick}
          onMouseDown={handleImageMouseDown}
          onDoubleClick={onDoubleClick}
          style={{
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            maxHeight: '100%',
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            // No transition during continuous gestures: the 0.05s ease made the
            // image lag behind a moving pointer, which flickered on desktop
            // (#4451). The same lag flickered a trackpad pinch (a rapid
            // ctrl+wheel stream) on macOS (#4742). Keep the smoothing only for
            // discrete zoom (buttons, double-click, keyboard).
            transition: isDragging || isWheelZooming ? 'none' : 'transform 0.05s ease-out',
            // Promote to a GPU layer so transform changes don't repaint the
            // page (the `transform-gpu` class is overridden by this inline
            // transform, so its hint is lost).
            willChange: 'transform',
            cursor: cursorStyle,
          }}
        />
      </div>

      {showZoomLabel && (
        <div
          aria-label={_('Zoom level')}
          className='zoom-level-label eink-bordered not-eink:text-white not-eink:bg-black/50 pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-full px-3 py-1 text-sm transition-opacity duration-300'
        >
          {Math.round((scale * 100) / 5) * 5}%
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
