import clsx from 'clsx';
import { Position, isPointInRect } from '@/utils/sel';
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
        // Measure the border box: contentRect is the content box, which
        // under-reports by 2px when e-ink mode adds the 1px container border.
        // The height positions the popup against the triangle attachment
        // point, so a short measurement drops the popup onto the triangle and
        // flips triangleHidden, hiding the white inner triangle behind the
        // black outer one (solid black triangle on e-ink).
        const newHeight = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
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

  const triangleSize = 7;
  const outerTriangleStyles = getTriangleStyles(trianglePosition, triangleSize, 0);
  const innerTriangleStyles = getTriangleStyles(trianglePosition, triangleSize, -1);

  const popupHeight = height ?? childrenHeight;
  const triangleHidden = !!(
    adjustedPosition &&
    trianglePosition &&
    isPointInRect(trianglePosition.point, {
      left: adjustedPosition.point.x,
      top: adjustedPosition.point.y,
      right: adjustedPosition.point.x + width,
      bottom: adjustedPosition.point.y + popupHeight,
    })
  );

  return (
    // No `filter` (drop-shadow) on this wrapper: it would become the containing
    // block and stacking context for the absolutely positioned popup below,
    // re-anchoring it off the viewport and demoting its z-50 under later reader
    // chrome. The triangle shadow lives on the triangle itself.
    <div>
      <div
        className={clsx(
          'popup-triangle-outer text-base-content/20 not-eink:drop-shadow-xl absolute z-50',
          triangleHidden ? 'invisible' : 'visible',
        )}
        style={outerTriangleStyles}
      />
      <div
        id='popup-container'
        ref={containerRef}
        aria-hidden={!isOpen}
        data-capture-blocking-overlay={isOpen ? 'true' : undefined}
        // `[data-eink] .popup-container` in globals.css already forces the 1px
        // base-content border and base-100 background, so no eink-bordered here.
        className={clsx(
          'popup-container text-base-content absolute z-50 rounded-lg border font-sans',
          'not-eink:border-base-content/20 not-eink:shadow-2xl',
          'bg-base-300 theme-dark:bg-base-100',
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
        className={clsx(
          'popup-triangle-inner text-base-300 theme-dark:text-base-100 absolute z-50',
          triangleHidden ? 'invisible' : 'visible',
        )}
        style={innerTriangleStyles}
      />
    </div>
  );
};

export default Popup;
