import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

// The keydown hook pulls in EnvContext + device store; the measurement path we
// exercise here is independent of it, so stub it to a no-op ref.
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => ({ current: null }),
}));

import SelectModeActions from '@/app/library/components/SelectModeActions';

// jsdom has no layout engine, so drive the ResizeObserver callback manually and
// fake the measured height via getBoundingClientRect.
let resizeCallback: ResizeObserverCallback | null = null;
beforeEach(() => {
  resizeCallback = null;
  global.ResizeObserver = class {
    constructor(cb: ResizeObserverCallback) {
      resizeCallback = cb;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = () => {};
const baseProps = {
  selectedBooks: ['0123456789abcdef0123456789abcdef'],
  safeAreaBottom: 24,
  onOpen: noop,
  onGroup: noop,
  onDetails: noop,
  onStatus: noop,
  onDownload: noop,
  onSend: noop,
  onDelete: noop,
  onCancel: noop,
};

const getAction = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement;

describe('SelectModeActions height reporting', () => {
  // Regression for #5175: the fixed bottom popup overlaps the last book in list
  // mode. The list reserves trailing space equal to the popup height, so the
  // popup must report how tall it actually is.
  it('reports its measured height so the shelf can reserve matching bottom space', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 118,
    } as DOMRect);

    const onHeightChange = vi.fn();
    render(<SelectModeActions {...baseProps} onHeightChange={onHeightChange} />);

    expect(onHeightChange).toHaveBeenCalledWith(118);
  });

  it('resets the reserved space to 0 when the popup unmounts', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      height: 118,
    } as DOMRect);

    const onHeightChange = vi.fn();
    const { unmount } = render(
      <SelectModeActions {...baseProps} onHeightChange={onHeightChange} />,
    );
    onHeightChange.mockClear();

    unmount();

    expect(onHeightChange).toHaveBeenCalledWith(0);
  });

  it('re-reports when the popup is resized (e.g. wraps to two rows)', () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ height: 118 } as DOMRect);

    const onHeightChange = vi.fn();
    render(<SelectModeActions {...baseProps} onHeightChange={onHeightChange} />);
    onHeightChange.mockClear();

    rectSpy.mockReturnValue({ height: 176 } as DOMRect);
    resizeCallback?.([], {} as ResizeObserver);

    expect(onHeightChange).toHaveBeenCalledWith(176);
  });
});

// Bulk download (#5244): selecting a group is the only practical way to pull a
// few hundred books onto a new device.
describe('SelectModeActions download', () => {
  it('queues the selection when the download action is tapped', () => {
    const onDownload = vi.fn();
    render(<SelectModeActions {...baseProps} canDownload onDownload={onDownload} />);

    fireEvent.click(getAction('Download'));

    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('disables the download action when nothing in the selection is uploaded', () => {
    render(<SelectModeActions {...baseProps} canDownload={false} />);

    expect(getAction('Download').className).toContain('btn-disabled');
  });

  it('places download right after details so it heads the wrapped row', () => {
    render(<SelectModeActions {...baseProps} canDownload />);

    const labels = Array.from(document.querySelectorAll('button')).map((button) =>
      button.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Open',
      'Group',
      'Status',
      'Details',
      'Download',
      'Send',
      'Delete',
      'Cancel',
    ]);
    expect(getAction('Download').className).toContain('max-[500px]:col-start-1');
  });
});
