import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Unlike ImageViewer.test.tsx, the real useKeyDownActions runs here: Escape
// has to get from the focused viewer to the hook's close handler.
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/deviceStore', () => ({ useDeviceControlStore: () => ({}) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/app/reader/components/ZoomControls', () => ({
  __esModule: true,
  default: () => <div data-testid='zoom-controls' />,
}));
// jsdom has no canvas for the ink probe.
vi.mock('@/app/reader/utils/imageRenderStyle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/reader/utils/imageRenderStyle')>();
  return { ...actual, probeImageInk: vi.fn().mockResolvedValue(null) };
});

import ImageViewer from '@/app/reader/components/ImageViewer';

afterEach(cleanup);

const gridInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('ImageViewer Escape', () => {
  // The viewer focuses itself when it opens, so a key the user presses
  // starts at the viewer, not at the window.
  it('closes the viewer when Escape is pressed after it opens', () => {
    const onClose = vi.fn();
    render(<ImageViewer src='blob:test-image' onClose={onClose} gridInsets={gridInsets} />);
    const viewer = screen.getByRole('button', { name: 'Image viewer' });
    expect(document.activeElement).toBe(viewer);

    fireEvent.keyDown(viewer, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The book cover viewer opens over the book details dialog, which also
  // closes on Escape: one press must close only the viewer.
  it('keeps Escape from reaching what is underneath', () => {
    const underneath = vi.fn();
    window.addEventListener('keydown', underneath);
    try {
      render(<ImageViewer src='blob:test-image' onClose={vi.fn()} gridInsets={gridInsets} />);
      fireEvent.keyDown(screen.getByRole('button', { name: 'Image viewer' }), { key: 'Escape' });
      expect(underneath).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', underneath);
    }
  });
});
