import { useEffect } from 'react';

import { Point } from '@/utils/sel';
import { useReaderStore } from '@/store/readerStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface MagnifierLoupeProps {
  bookKey: string;
  dragPoint: Point;
  isVertical: boolean;
  color: string;
}

const MagnifierLoupe: React.FC<MagnifierLoupeProps> = ({
  bookKey,
  dragPoint,
  isVertical,
  color,
}) => {
  const { getView } = useReaderStore();
  const gap = useResponsiveSize(22);
  const margin = useResponsiveSize(8);
  const radius = useResponsiveSize(28);

  useEffect(() => {
    return () => {
      const view = getView(bookKey);
      view?.renderer.hideLoupe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // Update loupe position on every drag move (fast path — no DOM recreation).
  useEffect(() => {
    const view = getView(bookKey);
    if (!view) return;
    view.renderer.showLoupe?.(dragPoint.x, dragPoint.y, {
      isVertical,
      color,
      gap,
      margin,
      radius,
      magnification: 1.1,
    });
  }, [bookKey, dragPoint, getView, isVertical, color, radius, gap, margin]);

  return null;
};

export default MagnifierLoupe;
