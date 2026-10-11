import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HandwritingOverlay from '@/app/reader/components/handwriting/HandwritingOverlay';

const h = vi.hoisted(() => ({ enabled: false, setHoveredBookKey: vi.fn(), setErasing: vi.fn() }));

vi.mock('@/app/reader/hooks/useHandwriting', () => ({
  useHandwriting: () => ({
    visible: true,
    editable: true,
    enabled: h.enabled,
    setEnabled: vi.fn(),
    hitTest: () => false,
    layers: [],
    cellRect: { left: 0, top: 0, width: 400, height: 800 },
    containerRef: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    erasing: false,
    setErasing: h.setErasing,
    undo: vi.fn(),
    redo: vi.fn(),
    turnPage: vi.fn(),
    penColor: '#1a1a1a',
    penWidth: 0.004,
    selectPenColor: vi.fn(),
    selectPenWidth: vi.fn(),
    tool: 'pen',
    selectTool: vi.fn(),
    saveDrawing: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ setHoveredBookKey: h.setHoveredBookKey }),
}));

vi.mock('@/app/reader/components/handwriting/HandwritingBars', () => ({
  HandwritingDock: () => <div data-testid='handwriting-dock' />,
}));

afterEach(() => {
  cleanup();
  h.setHoveredBookKey.mockClear();
  h.setErasing.mockClear();
});

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('HandwritingOverlay', () => {
  it('hides the header and footer when drawing starts, so they cannot cover the toolbar', () => {
    h.enabled = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(h.setHoveredBookKey).toHaveBeenCalledWith(null);
  });

  it('shows its dock in place of the reader footer, with no bar over the page top', () => {
    h.enabled = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(screen.getByTestId('handwriting-dock')).toBeTruthy();
    expect(screen.queryByTestId('handwriting-top-bar')).toBeNull();
  });

  it('starts each drawing session with the pen, not the eraser left on last time', () => {
    h.enabled = true;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(h.setErasing).toHaveBeenCalledWith(false);
  });

  it('leaves the bars alone while not drawing', () => {
    h.enabled = false;
    render(<HandwritingOverlay bookKey='book-1' gridInsets={insets} />);
    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
  });
});
