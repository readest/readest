import clsx from 'clsx';
import { Position } from '@/utils/sel';
import { useEffect, useRef, useState } from 'react';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useKeyDownActions } from '@/hooks/useKeyDownActions';

const getTriangleStyles = (
  trianglePosition: Position | undefined,
  size: number,
  offset: number,
): React.CSSProperties => {
  if (!trianglePosition) {
    return { left: '-999px', top: '-999px' };
  }

  const { dir, point } = trianglePosition;

  let topOffset = 0;
  let leftOffset = 0;
  switch (dir) {
    case 'up':
      topOffset = offset;
      break;
    case 'down':
      topOffset = -offset;
      break;
    case 'left':
      leftOffset = offset;
      break;
    case 'right':
      leftOffset = -offset;
      break;
  }

  return {
    left: `${point.x + leftOffset}px`,
    top: `${point.y + topOffset}px`,
    borderLeft:
      dir === 'right' ? 'none' : dir === 'left' ? `${size}px solid` : `${size}px solid transparent`,
    borderRight:
      dir === 'left' ? 'none' : dir === 'right' ? `${size}px solid` : `${size}px solid transparent`,
    borderTop:
      dir === 'down' ? 'none' : dir === 'up' ? `${size}px solid` : `${size}px solid transparent`,
    borderBottom:
      dir === 'up' ? 'none' : dir === 'down' ? `${size}px solid` : `${size}px solid transparent`,
    transform: dir === 'left' || dir === 'right' ? 'translateY(-50%)' : 'translateX(-50%)',
  };
};

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
  isOpen = true,
  onDismiss,
}: {
  isOpen?: boolean;
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
  onDismiss?: () => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [childrenHeight, setChildrenHeight] = useState(height || minHeight || 0);

  useKeyDownActions({ onCancel: onDismiss, elementRef: containerRef, enabled: isOpen });

  const popupPadding = useResponsiveSize(10);
  let availableHeight = window.innerHeight - 2 * popupPadding;
  if (trianglePosition?.dir === 'up') {
    availableHeight = trianglePosition.point.y - popupPadding;
  } else if (trianglePosition?.dir === 'down') {
    availableHeight = window.innerHeight - trianglePosition.point.y - popupPadding;
  }
  maxHeight = Math.min(maxHeight || availableHeight, availableHeight);

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
        y: Math.max(popupPadding, trianglePosition.point.y - containerHeight),
      },
    };
    setAdjustedPosition(newPosition);
  }, [position, trianglePosition, popupPadding, childrenHeight]);

  const outerTriangleStyles = getTriangleStyles(trianglePosition, 7, 0);
  const innerTriangleStyles = getTriangleStyles(trianglePosition, 7, -1);

  return (
    <div>
      <div
        className={clsx('popup-triangle-outer text-base-300 absolute z-50', triangleClassName)}
        style={outerTriangleStyles}
      />
      <div
        id='popup-container'
        ref={containerRef}
        className={clsx(
          'popup-container bg-base-300 absolute z-50 rounded-lg font-sans',
          'eink:border eink:border-base-content',
          trianglePosition?.dir !== 'up' && 'not-eink:shadow-xl',
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
        className={clsx('popup-triangle-inner text-base-300 absolute z-50', triangleClassName)}
        style={innerTriangleStyles}
      />
    </div>
  );
};

export default Popup;
