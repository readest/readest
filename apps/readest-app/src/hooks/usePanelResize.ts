import { DragKey, useDrag } from '@/hooks/useDrag';

interface PanelResizeOptions {
  side: 'start' | 'end';
  minWidth: number;
  maxWidth: number;
  getWidth: () => string;
  onResize: (width: string) => void;
}

export const usePanelResize = ({
  side,
  minWidth,
  maxWidth,
  getWidth,
  onResize,
}: PanelResizeOptions) => {
  const toPercent = (fraction: number) => `${Math.round(fraction * 10000) / 100}%`;

  const isPhysicallyLeft = () => {
    const isRtl = getComputedStyle(document.documentElement).direction === 'rtl';
    return side === 'start' ? !isRtl : isRtl;
  };

  const handleDragMove = (data: { clientX: number }) => {
    const fraction = isPhysicallyLeft()
      ? data.clientX / window.innerWidth
      : 1 - data.clientX / window.innerWidth;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, fraction));
    onResize(toPercent(newWidth));
  };

  const handleDragKeyDown = (data: { key: DragKey; step: number }) => {
    const currentWidth = parseFloat(getWidth()) / 100;
    let newWidth = currentWidth;

    const left = isPhysicallyLeft();
    const growKey: DragKey = left ? 'ArrowRight' : 'ArrowLeft';
    const shrinkKey: DragKey = left ? 'ArrowLeft' : 'ArrowRight';

    if (data.key === growKey) {
      newWidth = Math.min(maxWidth, currentWidth + data.step);
    } else if (data.key === shrinkKey) {
      newWidth = Math.max(minWidth, currentWidth - data.step);
    }
    onResize(toPercent(newWidth));
  };

  const { handleDragStart: handleResizeStart, handleDragKeyDown: handleResizeKeyDown } = useDrag(
    handleDragMove,
    handleDragKeyDown,
  );

  return { handleResizeStart, handleResizeKeyDown };
};
