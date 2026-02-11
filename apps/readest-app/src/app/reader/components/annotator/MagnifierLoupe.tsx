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
  const radius = useResponsiveSize(52);

  useEffect(() => {
    const view = getView(bookKey);
    if (!view) return;
    view.renderer.showLoupe?.(dragPoint.x, dragPoint.y, { isVertical, color, radius });
    return () => view.renderer.hideLoupe?.();
  }, [bookKey, dragPoint, getView, isVertical, color, radius]);

  return null;
};

export default MagnifierLoupe;
