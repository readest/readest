import React, { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  open: boolean;
  src?: string;
  alt?: string;
  onClose: () => void;
};

const clamp = (v: number, min = 0.1, max = 10) => Math.max(min, Math.min(max, v));

export default function ImageViewerModal({ open, src, alt, onClose }: Props) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const lastTouchDistance = useRef<number | null>(null);
  const lastOffset = useRef({ x: 0, y: 0 });
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Move these functions to the top so they're declared before use
  const handleZoomIn = useCallback(() => {
    setZoom(prev => clamp(prev + 0.25));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => clamp(prev - 0.25));
  }, []);

  const handleReset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    lastOffset.current = { x: 0, y: 0 };
  }, []);

  // Keyboard controls
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') onClose();
    if (e.key === '+' || e.key === '=') handleZoomIn();
    if (e.key === '-') handleZoomOut();
    if (e.key === '0') handleReset();
  }, [open, onClose, handleZoomIn, handleZoomOut, handleReset]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);


  // Mouse wheel zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = clamp(zoom * zoomFactor);

    // Zoom towards mouse position
    const scaleChange = newZoom / zoom;
    const newOffsetX = mouseX - (mouseX - offset.x) * scaleChange;
    const newOffsetY = mouseY - (mouseY - offset.y) * scaleChange;

    setZoom(newZoom);
    setOffset({ x: newOffsetX, y: newOffsetY });
  };

  // Mouse drag
  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || zoom <= 1) return;
    e.preventDefault();
    
    const newX = e.clientX - dragStart.current.x;
    const newY = e.clientY - dragStart.current.y;
    
    // Calculate bounds to prevent dragging beyond image edges
    const container = containerRef.current;
    const image = imageRef.current;
    if (container && image) {
      const containerRect = container.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      
      const maxX = Math.max(0, (imageRect.width * zoom - containerRect.width) / 2);
      const maxY = Math.max(0, (imageRect.height * zoom - containerRect.height) / 2);
      
      const boundedX = zoom > 1 ? clamp(newX, -maxX, maxX) : 0;
      const boundedY = zoom > 1 ? clamp(newY, -maxY, maxY) : 0;
      
      setOffset({ x: boundedX, y: boundedY });
    } else {
      setOffset({ x: newX, y: newY });
    }
  };

  const onMouseUp = () => {
    setIsDragging(false);
    lastOffset.current = { ...offset };
  };

  // Touch events for pinch-to-zoom and pan
  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    
    if (touches.length === 2) {
      // Pinch start
      const touch1 = touches[0];
      const touch2 = touches[1];
      if (!touch1 || !touch2) return;
      lastTouchDistance.current = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      lastOffset.current = { ...offset };
    } else if (touches.length === 1 && zoom > 1) {
      // Pan start
      setIsDragging(true);
      const touch = touches[0];
      if (!touch) return;
      dragStart.current = { 
        x: touch.clientX - offset.x, 
        y: touch.clientY - offset.y
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touches = e.touches;
    
    if (touches.length === 2 && lastTouchDistance.current !== null) {
      // Pinch zoom
      const touch1 = touches[0];
      const touch2 = touches[1];
      if (!touch1 || !touch2) return;
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      const zoomChange = currentDistance / lastTouchDistance.current;
      const newZoom = clamp(zoom * zoomChange);
      
      // Calculate center point for zoom
      const centerX = (touch1.clientX + touch2.clientX) / 2;
      const centerY = (touch1.clientY + touch2.clientY) / 2;
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const relativeX = centerX - rect.left;
        const relativeY = centerY - rect.top;
        
        const scaleChange = newZoom / zoom;
        const newOffsetX = relativeX - (relativeX - offset.x) * scaleChange;
        const newOffsetY = relativeY - (relativeY - offset.y) * scaleChange;
        
        setZoom(newZoom);
        setOffset({ x: newOffsetX, y: newOffsetY });
      }
      
      lastTouchDistance.current = currentDistance;
    } else if (touches.length === 1 && isDragging && zoom > 1) {
      // Pan
      const touch = touches[0];
      if (!touch) return;
      const newX = touch.clientX - dragStart.current.x;
      const newY = touch.clientY - dragStart.current.y;
      
      // Calculate bounds
      const container = containerRef.current;
      const image = imageRef.current;
      if (container && image) {
        const containerRect = container.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        
        const maxX = Math.max(0, (imageRect.width * zoom - containerRect.width) / 2);
        const maxY = Math.max(0, (imageRect.height * zoom - containerRect.height) / 2);
        
        const boundedX = clamp(newX, -maxX, maxX);
        const boundedY = clamp(newY, -maxY, maxY);
        
        setOffset({ x: boundedX, y: boundedY });
      }
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      setIsDragging(false);
      lastTouchDistance.current = null;
      lastOffset.current = { ...offset };
    }
  };

  // Double click to zoom in/out
  const onDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (zoom === 1) {
      // Zoom to 2x at click position
      const newZoom = 2;
      const scaleChange = newZoom / zoom;
      const newOffsetX = mouseX - (mouseX - offset.x) * scaleChange;
      const newOffsetY = mouseY - (mouseY - offset.y) * scaleChange;
      
      setZoom(newZoom);
      setOffset({ x: newOffsetX, y: newOffsetY });
    } else {
      // Reset zoom
      handleReset();
    }
  };

  // Handle backdrop click with proper keyboard support
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleBackdropKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      onClose();
    }
  };

  if (!open || !src) return null;

  const cursorStyle = zoom > 1 
    ? (isDragging ? 'grabbing' : 'grab') 
    : 'default';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      role="button"
      tabIndex={0}
      aria-label="Close image viewer"
    >
      <div
        ref={containerRef}
        className="relative w-full h-full flex items-center justify-center overflow-hidden"
        onWheel={onWheel}
      >
        {/* Controls */}
        <div className="absolute top-4 right-4 z-50 flex gap-2 bg-black/50 rounded-lg p-2 backdrop-blur-sm">
          <button 
            onClick={handleZoomOut} 
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded transition-colors"
            disabled={zoom <= 0.1}
            aria-label="Zoom out"
          >
            <span className="text-lg font-bold">−</span>
          </button>
          <div className="flex items-center px-3 text-white text-sm min-w-[60px] justify-center">
            {Math.round(zoom * 100)}%
          </div>
          <button 
            onClick={handleZoomIn} 
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded transition-colors"
            disabled={zoom >= 10}
            aria-label="Zoom in"
          >
            <span className="text-lg font-bold">+</span>
          </button>
          <button 
            onClick={handleReset} 
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded transition-colors"
            aria-label="Reset zoom"
          >
            <span className="text-lg">⟲</span>
          </button>
          <button 
            onClick={onClose} 
            className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/20 rounded transition-colors"
            aria-label="Close image viewer"
          >
            <span className="text-lg">×</span>
          </button>
        </div>

        {/* Image container - using div with proper role for accessibility */}
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            cursor: cursorStyle,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onDoubleClick={onDoubleClick}
          className="flex items-center justify-center"
          role="button"
          tabIndex={0}
          aria-label="Image zoom and pan area"
        >
          {/* Using img instead of Next.js Image since this is for Tauri */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img 
            ref={imageRef}
            src={src} 
            alt={alt} 
            className="select-none max-w-none"
            style={{ 
              maxWidth: '90vw', 
              maxHeight: '90vh',
              pointerEvents: 'none'
            }}
          />
        </div>

        {/* Instructions */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 text-white/70 text-sm bg-black/50 rounded-lg px-3 py-2 backdrop-blur-sm">
          {zoom > 1 ? 'Drag to pan • Double-click to reset' : 'Double-click to zoom • Scroll to zoom'}
        </div>
      </div>
    </div>
  );
}