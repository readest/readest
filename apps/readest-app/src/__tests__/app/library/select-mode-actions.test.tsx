import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

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
  onSend: noop,
  onDelete: noop,
  onCancel: noop,
};

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
