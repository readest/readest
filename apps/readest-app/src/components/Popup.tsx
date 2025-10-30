import clsx from 'clsx';
import { Position } from '@/utils/sel';
import { useEffect, useRef, useState } from 'react';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

const Popup = ({
  width,
  height,
  minHeight,
  maxHeight,
  position,
  trianglePosition,
  children,
  className = '',
  triangleClassName = '',
  additionalStyle = {},
}: {
  width: number;
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  position?: Position;
  trianglePosition?: Position;
  children: React.ReactNode;
  className?: string;
  triangleClassName?: string;
  additionalStyle?: React.CSSProperties;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [childrenHeight, setChildrenHeight] = useState(height || minHeight || 0);

  const popupPadding = useResponsiveSize(10);
  let availableHeight = window.innerHeight - 2 * popupPadding;
  if (trianglePosition?.dir === 'up') {
    availableHeight = trianglePosition.point.y - popupPadding;
  } else if (trianglePosition?.dir === 'down') {
    availableHeight = window.innerHeight - trianglePosition.point.y - popupPadding;
  }
  maxHeight = Math.min(maxHeight || availableHeight, availableHeight);
  if (minHeight) {
    minHeight = Math.min(minHeight, availableHeight);
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight !== childrenHeight) {
          setChildrenHeight(newHeight);
          return;
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!position || !trianglePosition || position.dir !== 'up') {
      setAdjustedPosition(position);
      return;
    }
    const containerHeight = childrenHeight || containerRef.current.offsetHeight;
    const newPosition = {
      ...position,
      point: {
        ...position.point,
        y: trianglePosition.point.y - containerHeight,
      },
    };
    setAdjustedPosition(newPosition);
  }, [position, trianglePosition, childrenHeight]);

  return (
    <div>
      <div
        id='popup-container'
        ref={containerRef}
        className={clsx(
          'bg-base-300 absolute rounded-lg font-sans',
          trianglePosition?.dir !== 'up' && 'shadow-xl',
          className,
        )}
        style={{
          width: `${width}px`,
          height: height ? `${height}px` : 'auto',
          minHeight: minHeight ? `${minHeight}px` : 'none',
          maxHeight: maxHeight ? `${maxHeight}px` : 'none',
          left: `${adjustedPosition ? adjustedPosition.point.x : -999}px`,
          top: `${adjustedPosition ? adjustedPosition.point.y : -999}px`,
          ...additionalStyle,
        }}
      >
        {children}
      </div>
      <div
        className={`triangle text-base-300 absolute ${triangleClassName}`}
        style={{
          left:
            trianglePosition?.dir === 'left'
              ? `${trianglePosition.point.x}px`
              : trianglePosition?.dir === 'right'
                ? `${trianglePosition.point.x}px`
                : `${trianglePosition ? trianglePosition.point.x : -999}px`,
          top:
            trianglePosition?.dir === 'up'
              ? `${trianglePosition.point.y}px`
              : trianglePosition?.dir === 'down'
                ? `${trianglePosition.point.y}px`
                : `${trianglePosition ? trianglePosition.point.y : -999}px`,
          borderLeft:
            trianglePosition?.dir === 'right'
              ? 'none'
              : trianglePosition?.dir === 'left'
                ? `7px solid`
                : '7px solid transparent',
          borderRight:
            trianglePosition?.dir === 'left'
              ? 'none'
              : trianglePosition?.dir === 'right'
                ? `7px solid`
                : '7px solid transparent',
          borderTop:
            trianglePosition?.dir === 'down'
              ? 'none'
              : trianglePosition?.dir === 'up'
                ? `7px solid`
                : '7px solid transparent',
          borderBottom:
            trianglePosition?.dir === 'up'
              ? 'none'
              : trianglePosition?.dir === 'down'
                ? `7px solid`
                : '7px solid transparent',
          transform:
            trianglePosition?.dir === 'left' || trianglePosition?.dir === 'right'
              ? 'translateY(-50%)'
              : 'translateX(-50%)',
        }}
      />
    </div>
  );
};

export default Popup;
