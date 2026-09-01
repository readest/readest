import clsx from 'clsx';
import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  caption?: string;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2;
const WHEEL_SENSITIVITY = 0.001;
const FALLBACK_DOUBLE_CLICK_SCALE = 2;
const COMMIT_ZOOM_DELAY_MS = 100;
const MAX_COMMIT_RASTER_DIM = 4096;

const ImageViewer: React.FC<ImageViewerProps> = ({
  src,
  caption,
  onClose,
  onPrevious,
  onNext,
  gridInsets,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const saveToGallery = appService?.isAndroidApp ?? false;
  const canShare = !saveToGallery && canShareText(appService);
  const [scale, setScale] = useState(1);
  const [pixelPerfectScale, setPixelPerfectScale] = useState<number | null>(null);
  const [fitSize, setFitSize] = useState<{ width: number; height: number } | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const positionRef = useRef(position);
  const [isDragging, setIsDragging] = useState(false);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  const [showZoomLabel, setShowZoomLabel] = useState(true);
  const [showCaption, setShowCaption] = useState(true);
  const lastTouchDistance = useRef<number>(0);
  const dragStart = useRef({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  const wasDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const zoomLabelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelZoomEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitJustApplied = useRef(false);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const updatePosition = useCallback((next: { x: number; y: number }) => {
    positionRef.current = next;
    setPosition(next);
  }, []);

  useKeyDownActions({ onCancel: onClose });

  const measureFit = useCallback(() => {
    const img = imageRef.current;
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!img?.naturalWidth || !img.naturalHeight) return;
    if (!containerRect?.width || !containerRect.height) return;
    const fitRatio = Math.min(
      1,
      containerRect.width / img.naturalWidth,
      containerRect.height / img.naturalHeight,
    );
    const fitWidth = img.naturalWidth * fitRatio;
    const dpr = window.devicePixelRatio || 1;
    setFitSize({ width: fitWidth, height: img.naturalHeight * fitRatio });
    setPixelPerfectScale(img.naturalWidth / (fitWidth * dpr));
  }, []);

  useEffect(() => {
    setPixelPerfectScale(null);
    setFitSize(null);
    setRenderScale(1);
    updatePosition({ x: 0, y: 0 });
    measureFit();
    window.addEventListener('resize', measureFit);
    return () => window.removeEventListener('resize', measureFit);
  }, [src, measureFit, updatePosition]);

  useEffect(() => {
    if (isDragging || isWheelZooming || !fitSize || !pixelPerfectScale) return;
    const dpr = window.devicePixelRatio || 1;
    const budgetScale = MAX_COMMIT_RASTER_DIM / (Math.max(fitSize.width, fitSize.height) * dpr);
    const target = Math.min(
      Math.max(scale, 1),
      Math.max(1, Math.min(pixelPerfectScale, budgetScale)),
    );
    if (target === renderScale) return;
    const timer = setTimeout(() => {
      commitJustApplied.current = true;
      setRenderScale(target);
    }, COMMIT_ZOOM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [scale, isDragging, isWheelZooming, fitSize, pixelPerfectScale, renderScale]);

  useEffect(() => {
    commitJustApplied.current = false;
  }, [renderScale]);

  const zoomPercent = Math.round((scale / (pixelPerfectScale ?? 1)) * 100);
  const maxScale = pixelPerfectScale ? Math.max(MAX_SCALE, pixelPerfectScale * 2) : MAX_SCALE;
  const doubleClickScale =
    pixelPerfectScale && pixelPerfectScale > 1 ? pixelPerfectScale : FALLBACK_DOUBLE_CLICK_SCALE;

  const markWheelZooming = () => {
    setIsWheelZooming(true);
    if (wheelZoomEndTimeoutRef.current) clearTimeout(wheelZoomEndTimeoutRef.current);
    wheelZoomEndTimeoutRef.current = setTimeout(() => setIsWheelZooming(false), 200);
  };

  const hideZoomLabelAfterDelay = () => {
    if (zoomLabelTimeoutRef.current) clearTimeout(zoomLabelTimeoutRef.current);
    setShowZoomLabel(true);
    zoomLabelTimeoutRef.current = setTimeout(() => setShowZoomLabel(false), 2000);
  };

  const handleZoomIn = () => {
    setScale(Math.min(scale * ZOOM_STEP, maxScale));
    hideZoomLabelAfterDelay();
  };

  const handleZoomOut = () => {
    const newScale = Math.max(scale / ZOOM_STEP, MIN_SCALE);
    if (newScale <= 1) updatePosition({ x: 0, y: 0 });
    setScale(newScale);
    hideZoomLabelAfterDelay();
  };

  const handleResetZoom = () => {
    setScale(1);
    updatePosition({ x: 0, y: 0 });
    hideZoomLabelAfterDelay();
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
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
      if (e.key === '=' || e.key === '+') handleZoomIn();
      else if (e.key === '-' || e.key === '_') handleZoomOut();
      else if (e.key === '0') handleResetZoom();
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

  useEffect(() => {
    containerRef.current?.focus();
    setTimeout(() => hideZoomLabelAfterDelay(), 0);
    return () => {
      if (zoomLabelTimeoutRef.current) clearTimeout(zoomLabelTimeoutRef.current);
      if (wheelZoomEndTimeoutRef.current) clearTimeout(wheelZoomEndTimeoutRef.current);
    };
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    markWheelZooming();
    const newScale = Math.min(
      Math.max(scale * Math.exp(-e.deltaY * WHEEL_SENSITIVITY), MIN_SCALE),
      maxScale,
    );
    if (newScale <= 1) {
      updatePosition({ x: 0, y: 0 });
      setScale(newScale);
      hideZoomLabelAfterDelay();
      return;
    }
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    const next = getZoomedOffset(mouseX, mouseY, scale, newScale, positionRef.current);
    updatePosition(next);
    setScale(newScale);
    hideZoomLabelAfterDelay();
  };

  const finishPointerDrag = useCallback((pointerId?: number) => {
    const activeId = activePointerId.current;
    if (activeId === null) return;
    if (pointerId !== undefined && activeId !== pointerId) return;

    activePointerId.current = null;
    setIsDragging(false);
  }, []);

  const handlePanPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || scale <= 1) return;
    if (activePointerId.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    activePointerId.current = e.pointerId;
    setIsDragging(true);
    wasDragging.current = false;
    dragStart.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
    };
  };

  const handlePanPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') finishPointerDrag(e.pointerId);
  };

  // Do not use pointer capture for desktop image panning. WebViews can keep a
  // captured mouse logically pressed after the physical button is released
  // outside the window. Track movement on the stable window using both native
  // pointer and compatibility mouse events, require the physical left-button
  // bit on every move, and terminate at the window boundary so a missed mouseup
  // cannot leave the image stuck to the cursor.
  useEffect(() => {
    const moveDrag = (clientX: number, clientY: number, buttons: number, pointerId?: number) => {
      const activeId = activePointerId.current;
      if (activeId === null) return;
      if (pointerId !== undefined && activeId !== pointerId) return;
      if ((buttons & 1) === 0) {
        finishPointerDrag(pointerId);
        return;
      }
      wasDragging.current = true;
      updatePosition({
        x: clientX - dragStart.current.x,
        y: clientY - dragStart.current.y,
      });
    };
    const onMouseMove = (e: MouseEvent) => moveDrag(e.clientX, e.clientY, e.buttons);
    const onPointerMove = (e: PointerEvent) =>
      moveDrag(e.clientX, e.clientY, e.buttons, e.pointerId);
    const onPointerEnd = (e: PointerEvent) => finishPointerDrag(e.pointerId);
    const onMouseUp = () => finishPointerDrag();
    const onWindowExit = (e: MouseEvent) => {
      if (e.relatedTarget === null) finishPointerDrag();
    };
    const onBlur = () => finishPointerDrag();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') finishPointerDrag();
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerEnd, true);
    window.addEventListener('pointercancel', onPointerEnd, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('mouseout', onWindowExit, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerEnd, true);
      window.removeEventListener('pointercancel', onPointerEnd, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('mouseout', onWindowExit, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [finishPointerDrag, updatePosition]);

  const onTouchStart = (e: React.TouchEvent) => {
    const touches = e.touches;
    if (touches.length === 1 && scale > 1) {
      setIsDragging(true);
      wasDragging.current = false;
      const touch = touches[0];
      if (!touch) return;
      dragStart.current = {
        x: touch.clientX - positionRef.current.x,
        y: touch.clientY - positionRef.current.y,
      };
    } else if (touches.length === 2) {
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
      wasDragging.current = true;
      const touch = touches[0];
      if (!touch) return;
      requestAnimationFrame(() => {
        updatePosition({
          x: touch.clientX - dragStart.current.x,
          y: touch.clientY - dragStart.current.y,
        });
      });
    } else if (touches.length === 2) {
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
        const newScale = Math.min(Math.max(scale * distanceChange, MIN_SCALE), maxScale);
        if (newScale <= 1) {
          updatePosition({ x: 0, y: 0 });
          setScale(newScale);
          hideZoomLabelAfterDelay();
          return;
        }
        const touchX = (touch1.clientX + touch2.clientX) / 2 - rect.left - rect.width / 2;
        const touchY = (touch1.clientY + touch2.clientY) / 2 - rect.top - rect.height / 2;
        updatePosition(getZoomedOffset(touchX, touchY, scale, newScale, positionRef.current));
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
        x: touch.clientX - positionRef.current.x,
        y: touch.clientY - positionRef.current.y,
      };
    }
    if (touches.length === 0) {
      lastTouchDistance.current = 0;
      setIsDragging(false);
    }
  };

  const onTouchCancel = () => {
    lastTouchDistance.current = 0;
    setIsDragging(false);
  };

  const handleReset = () => {
    setScale(1);
    updatePosition({ x: 0, y: 0 });
    hideZoomLabelAfterDelay();
  };

  const handleSaveImage = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!src || !appService) return;
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
      if (!canShare) {
        eventDispatcher.dispatch('toast', {
          type: saved ? 'info' : 'error',
          message: saved ? _('Image saved successfully') : _('Failed to save the image'),
        });
      }
    } catch (error) {
      console.error('Failed to save image:', error);
      eventDispatcher.dispatch('toast', { type: 'error', message: _('Failed to save the image') });
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
      const newScale = doubleClickScale;
      updatePosition(getZoomedOffset(mouseX, mouseY, scale, newScale, positionRef.current));
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
    e.stopPropagation();
    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }
    setShowZoomLabel((prev) => !prev);
    setShowCaption((prev) => !prev);
  };

  const cursorStyle = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';

  if (!src) return null;

  return (
    <div
      ref={containerRef}
      data-capture-blocking-overlay='true'
      tabIndex={-1}
      role='button'
      aria-label={_('Image viewer')}
      className='no-context-menu fixed inset-0 z-50 flex items-center justify-center outline-hidden'
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div
        role='button'
        tabIndex={0}
        className='image-viewer-overlay not-eink:bg-black/50 eink:bg-base-100 not-eink:backdrop-blur-md absolute inset-0'
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onClose();
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
        className={clsx(
          'image-pan-surface relative flex h-full w-full items-center justify-center overflow-hidden',
        )}
        onClick={handleContainerClick}
        onPointerDown={handlePanPointerDown}
        onPointerUp={handlePanPointerEnd}
        onPointerCancel={handlePanPointerEnd}
        style={{ touchAction: 'none', cursor: cursorStyle }}
      >
        <img
          role='none'
          src={decodeURIComponent(src)}
          ref={imageRef}
          alt={caption || _('Zoomed')}
          className='pointer-events-auto transform-gpu select-none object-contain'
          draggable={false}
          width={0}
          height={0}
          sizes='100vw'
          onLoad={measureFit}
          onClick={handleImageClick}
          onDoubleClick={onDoubleClick}
          style={{
            ...(fitSize
              ? {
                  width: `${fitSize.width * renderScale}px`,
                  height: `${fitSize.height * renderScale}px`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }
              : { width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '100%' }),
            flexShrink: 0,
            transform: `scale(${scale / renderScale}) translate(${(position.x * renderScale) / scale}px, ${(position.y * renderScale) / scale}px)`,
            transition:
              isDragging || isWheelZooming || commitJustApplied.current
                ? 'none'
                : 'transform 0.05s ease-out',
            willChange: 'transform',
            cursor: cursorStyle,
          }}
        />
      </div>

      {caption && showCaption && (
        <div
          dir='auto'
          className='image-caption eink-bordered not-eink:text-white not-eink:bg-black/50 absolute bottom-4 left-1/2 z-10 max-h-[30%] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-y-auto rounded-lg px-4 py-2 text-center text-sm'
          style={{ marginBottom: `${gridInsets.bottom}px` }}
        >
          {caption}
        </div>
      )}

      {showZoomLabel && (
        <div
          aria-label={_('Zoom level')}
          className='zoom-level-label eink-bordered not-eink:text-white not-eink:bg-black/50 pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-full px-3 py-1 text-sm transition-opacity duration-300'
        >
          {zoomPercent}%
        </div>
      )}
    </div>
  );
};

export default ImageViewer;
