import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { IoChevronBack, IoChevronForward } from 'react-icons/io5';
import { useTranslation } from '@/hooks/useTranslation';
import ZoomControls from './ZoomControls';

interface ImageViewerProps {
  src: string | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_SPEED = 0.1;
const MOBILE_ZOOM_SPEED = 0.001;
const ZOOM_BIAS = 1.05;

const ImageViewer: React.FC<ImageViewerProps> = ({ src, onClose, onPrevious, onNext }) => {
  const _ = useTranslation();
  const [scale, setScale] = useState(1);
  const [zoomSpeed, setZoomSpeed] = useState(0.1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showZoomLabel, setShowZoomLabel] = useState(true);
  const lastTouchDistance = useRef<number>(0);
  const dragStart = useRef({ x: 0, y: 0 });
  const wasDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const zoomLabelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const newScale = Math.min(scale + ZOOM_SPEED, MAX_SCALE);
    setScale(newScale);
    setZoomSpeed(ZOOM_SPEED * ZOOM_BIAS * newScale);
    hideZoomLabelAfterDelay();
  };

  const handleZoomOut = () => {
    const newScale = Math.max(scale - ZOOM_SPEED, MIN_SCALE);
    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
      setScale(newScale);
      setZoomSpeed(ZOOM_SPEED);
    } else {
      setScale(newScale);
      setZoomSpeed(ZOOM_SPEED * ZOOM_BIAS * newScale);
    }
    hideZoomLabelAfterDelay();
  };

  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setZoomSpeed(ZOOM_SPEED);
    hideZoomLabelAfterDelay();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      onClose();
      return;
    }

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

    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    const newScale = Math.min(Math.max(scale + delta, MIN_SCALE), MAX_SCALE);
    const newZoom = ZOOM_SPEED * ZOOM_BIAS * newScale;

    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
      setScale(newScale);
      setZoomSpeed(ZOOM_SPEED);
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
    setZoomSpeed(newZoom);
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

  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    e.preventDefault();

    wasDragging.current = true;
    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;

    setPosition({ x: newX, y: newY });
  };

  const handleImageMouseUp = (e: React.MouseEvent) => {
    if (isDragging) {
      e.stopPropagation();
    }
    setIsDragging(false);
  };

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
        const newZoom = MOBILE_ZOOM_SPEED * ZOOM_BIAS * distanceChange;

        if (newScale <= 1) {
          setPosition({ x: 0, y: 0 });
          setScale(newScale);
          setZoomSpeed(ZOOM_SPEED);
          return;
        }

        // Touch position relative to the container element
        const touchX = (touch1.clientX + touch2.clientX) / 2 - rect.left - rect.width / 2;
        const touchY = (touch1.clientY + touch2.clientY) / 2 - rect.top - rect.height / 2;

        setPosition((prevPos) => {
          return getZoomedOffset(touchX, touchY, scale, newScale, prevPos);
        });

        setScale(newScale);
        setZoomSpeed(newZoom);

        lastTouchDistance.current = currentDistance;
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
    setZoomSpeed(ZOOM_SPEED);
    hideZoomLabelAfterDelay();
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
    <div
      ref={containerRef}
      tabIndex={-1}
      role='button'
      aria-label={_('Image viewer')}
      className='fixed inset-0 z-50 flex items-center justify-center outline-none'
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        role='button'
        tabIndex={0}
        className='not-eink:bg-black/50 eink:bg-base-100 not-eink:backdrop-blur-md absolute inset-0'
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClose();
          }
        }}
      />
      <ZoomControls
        onClose={onClose}
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
        <Image
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
          onMouseMove={handleImageMouseMove}
          onMouseUp={handleImageMouseUp}
          onMouseLeave={handleImageMouseUp}
          onDoubleClick={onDoubleClick}
          style={{
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            maxHeight: '100%',
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: 'transform 0.05s ease-out',
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
