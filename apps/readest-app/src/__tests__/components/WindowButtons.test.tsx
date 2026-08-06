import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WindowButtons from '@/components/WindowButtons';

const startDragging = vi.fn().mockResolvedValue(undefined);
let hasWindowBar = false;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindowBar } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging,
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
  }),
}));

const WindowButtonsHarness = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={headerRef} data-testid='header' />
      <WindowButtons headerRef={headerRef} />
    </>
  );
};

describe('WindowButtons', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    hasWindowBar = false;
  });

  it('does not register desktop title-bar gestures when the platform has no window bar', async () => {
    render(<WindowButtonsHarness />);

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('header'), { buttons: 1, detail: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(startDragging).not.toHaveBeenCalled();
  });

  it('keeps a caller-provided close action available when the platform has no window bar', () => {
    const onClose = vi.fn();
    render(<WindowButtons onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps title-bar dragging enabled on desktop platforms', async () => {
    hasWindowBar = true;
    render(<WindowButtonsHarness />);

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('header'), { buttons: 1, detail: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(startDragging).toHaveBeenCalledOnce();
  });
});
