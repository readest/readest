import clsx from 'clsx';
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import ZoomControls from './ZoomControls';

interface TableViewerProps {
  html: string | null;
  isDarkMode: boolean;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const ZOOM_SPEED = 0.1;

const TableViewer: React.FC<TableViewerProps> = ({ html, isDarkMode, onClose }) => {
  const _ = useTranslation();
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showZoomLabel, setShowZoomLabel] = useState(true);
  const dragStart = useRef({ x: 0, y: 0 });
  const wasDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
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
    hideZoomLabelAfterDelay();
  };

  const handleZoomOut = () => {
    const newScale = Math.max(scale - ZOOM_SPEED, MIN_SCALE);
    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
      setScale(newScale);
    } else {
      setScale(newScale);
    }
    hideZoomLabelAfterDelay();
  };

  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    hideZoomLabelAfterDelay();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();

    if (e.key === 'Escape') {
      onClose();
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
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd) {
      return;
    }

    e.preventDefault();

    const delta = e.deltaY > 0 ? -ZOOM_SPEED : ZOOM_SPEED;
    const newScale = Math.min(Math.max(scale + delta, MIN_SCALE), MAX_SCALE);

    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
      setScale(newScale);
      hideZoomLabelAfterDelay();
      return;
    }

    setScale(newScale);
    hideZoomLabelAfterDelay();
  };

  const handleContentMouseDown = (e: React.MouseEvent) => {
    if (isDragging || scale <= 1) return;
    e.stopPropagation();
    e.preventDefault();

    setIsDragging(true);
    wasDragging.current = false;
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleContentMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    e.preventDefault();

    wasDragging.current = true;
    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;

    setPosition({ x: newX, y: newY });
  };

  const handleContentMouseUp = (e: React.MouseEvent) => {
    if (isDragging) {
      e.stopPropagation();
    }
    setIsDragging(false);
  };

  const handleContainerClick = () => {
    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }
    onClose();
  };

  const handleContentClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }

    setShowZoomLabel((prev) => !prev);
  };

  const cursorStyle = scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default';

  if (!html) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role='button'
      aria-label={_('Table viewer')}
      className='fixed inset-0 z-50 flex items-center justify-center outline-none'
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <div
        role='button'
        tabIndex={0}
        className='absolute inset-0 bg-black/50 backdrop-blur-md'
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
        onReset={handleResetZoom}
      />

      <div
        role='presentation'
        className={clsx('relative flex h-full w-full items-center justify-center overflow-hidden')}
        onClick={handleContainerClick}
      >
        <div
          role='presentation'
          ref={contentRef}
          className='table-viewer-content max-h-full max-w-full transform-gpu select-none overflow-auto rounded-lg shadow-2xl'
          onClick={handleContentClick}
          onMouseDown={handleContentMouseDown}
          onMouseMove={handleContentMouseMove}
          onMouseUp={handleContentMouseUp}
          onMouseLeave={handleContentMouseUp}
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transition: 'transform 0.05s ease-out',
            cursor: cursorStyle,
            backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
            color: isDarkMode ? '#ffffff' : '#000000',
            padding: '24px',
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {showZoomLabel && (
        <div
          aria-label={_('Zoom level')}
          className='zoom-level-label eink-bordered not-eink:bg-black/50 not-eink:text-white pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-full px-3 py-1 text-sm transition-opacity duration-300'
        >
          {Math.round((scale * 100) / 5) * 5}%
        </div>
      )}

      <style jsx>{`
        .table-viewer-content :global(table) {
          border-collapse: collapse;
          border: 1px solid ${isDarkMode ? '#444444' : '#cccccc'};
        }
        .table-viewer-content :global(td),
        .table-viewer-content :global(th) {
          border: 1px solid ${isDarkMode ? '#444444' : '#cccccc'};
          padding: 8px 12px;
        }
        .table-viewer-content :global(th) {
          background-color: ${isDarkMode ? '#2a2a2a' : '#f5f5f5'};
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

export default TableViewer;
