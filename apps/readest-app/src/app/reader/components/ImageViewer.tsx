import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { IoClose, IoExpand } from 'react-icons/io5';
import Image from 'next/image';

interface ImageViewerProps {
  src: string | null;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;
const ZOOM_SPEED = 0.1;
const MOBILE_ZOOM_SPEED = 0.001;
const ZOOM_BIAS = 1.05;

const ImageViewer: React.FC<ImageViewerProps> = ({ src, onClose }) => {
  const [scale, setScale] = useState(1);
  const [zoomSpeed, setZoomSpeed] = useState(0.1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastTouchDistance = useRef<number>(0);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      onClose();
    }
  };
  const imageRef = useRef<HTMLImageElement>(null);

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

  // Grab Focus of modal
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
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
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isDragging || scale <= 1) return;
    e.preventDefault();

    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    e.preventDefault();

    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;

    setPosition({ x: newX, y: newY });
  };

  const handleMouseUp = () => setIsDragging(false);

  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;

    if (touches.length === 1 && scale > 1) {
      // Pan Start
      setIsDragging(true);
      const touch = touches[0];
      if (!touch) return;
      dragStart.current = {
        x: touch.clientX - position.x,
        y: touch.clientY - position.y,
      };
    } else if (touches.length === 2) {
      // Pinch Start
      setIsDragging(true);
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
    e.preventDefault();
    const touches = e.touches;

    if (touches.length === 1 && scale > 1 && isDragging) {
      // Pan
      const touch = touches[0];
      if (!touch) return;

      requestAnimationFrame(() => {
        const newX = touch.clientX - dragStart.current.x;
        const newY = touch.clientY - dragStart.current.y;

        setPosition({ x: newX, y: newY });
      });
    } else if (touches.length === 2) {
      // Pinch
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
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();

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
    } else {
      handleReset();
    }
  };

  const cursorStyle = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';

  if (!src) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role='presentation'
      aria-label='Image viewer'
      className='fixed inset-0 z-50 flex items-center justify-center outline-none'
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={onDoubleClick}
      onTouchMove={onTouchMove}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        role='button'
        tabIndex={0}
        className='absolute inset-0 bg-black/50 backdrop-blur-md'
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClose();
          }
        }}
      />
      <div className='absolute right-4 top-4 z-10 grid grid-cols-1 gap-4 text-white'>
        <button
          onClick={onClose}
          className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
          aria-label='Close'
        >
          <IoClose className='h-6 w-6' />
        </button>

        <button
          onClick={handleReset}
          className='flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/50 transition-colors hover:bg-black/70'
          aria-label='Reset'
        >
          <IoExpand className='h-6 w-6' />
        </button>
      </div>

      <div
        className={clsx(
          'relative flex max-h-[90vh] max-w-[90vw] items-center justify-center overflow-hidden',
        )}
      >
        <Image
          src={decodeURIComponent(src)}
          ref={imageRef}
          alt='Zoomed'
          className='h-[90vh] max-h-[90vh] w-[90vw] max-w-[90vw] transform-gpu select-none object-contain'
          draggable={false}
          // Image from nextJS doesnt work with widht={null}
          width={0}
          height={0}
          sizes='100vw'
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: 'transform 0.05s ease-out',
            cursor: cursorStyle,
          }}
        />
      </div>

      <div className='absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white'>
        {Math.round((scale * 100) / 5) * 5}%
      </div>
    </div>
  );
};

export default ImageViewer;
