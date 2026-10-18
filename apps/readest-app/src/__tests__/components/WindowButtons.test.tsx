import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WindowButtons from '@/components/WindowButtons';

const startDragging = vi.fn().mockResolvedValue(undefined);
const startPointerWindowMove = vi.fn().mockResolvedValue(undefined);
let hasWindowBar = false;
let pointerWindowControls = false;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasWindowBar } }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  needsPointerWindowControls: () => pointerWindowControls,
}));

vi.mock('@/utils/windowPointerDrag', () => ({
  startPointerWindowMove: (e: MouseEvent) => startPointerWindowMove(e),
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

const SearchFieldHarness = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={headerRef} data-testid='header'>
        <div className='exclude-title-bar-mousedown'>
          <input type='text' aria-label='Search' className='window-drag-input' />
        </div>
      </div>
      <WindowButtons headerRef={headerRef} />
    </>
  );
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WindowButtons', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    hasWindowBar = false;
    pointerWindowControls = false;
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

  it('drives the drag from pointer events where the runtime cannot (Linux CEF)', async () => {
    hasWindowBar = true;
    pointerWindowControls = true;
    startDragging.mockClear();
    render(<WindowButtonsHarness />);

    await act(async () => {
      fireEvent.mouseDown(screen.getByTestId('header'), { buttons: 1, detail: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(startPointerWindowMove).toHaveBeenCalledOnce();
    expect(startDragging).not.toHaveBeenCalled();
  });

  describe('search field in the title bar', () => {
    it('marks the header as draggable only while its drag listener is installed', () => {
      render(<SearchFieldHarness />);
      expect(screen.getByTestId('header').hasAttribute('data-window-drag')).toBe(false);
      cleanup();

      hasWindowBar = true;
      const Toggle = ({ mounted }: { mounted: boolean }) => {
        const headerRef = useRef<HTMLDivElement>(null);
        return (
          <>
            <div ref={headerRef} data-testid='header' />
            {mounted && <WindowButtons headerRef={headerRef} />}
          </>
        );
      };
      const { rerender } = render(<Toggle mounted />);
      expect(screen.getByTestId('header').hasAttribute('data-window-drag')).toBe(true);

      // Library select mode unmounts WindowButtons while the search field stays.
      rerender(<Toggle mounted={false} />);
      expect(screen.getByTestId('header').hasAttribute('data-window-drag')).toBe(false);
    });

    it('drops a press on the search field whose release was missed', async () => {
      hasWindowBar = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });

      await act(async () => {
        fireEvent.mouseDown(input, { buttons: 1, detail: 1, screenX: 100, screenY: 10 });
        // The mouseup happened outside the window; the next move has no button down.
        fireEvent.mouseMove(window, { buttons: 0, screenX: 140, screenY: 10 });
        fireEvent.mouseMove(window, { buttons: 1, screenX: 180, screenY: 10 });
        await flush();
      });

      expect(startDragging).not.toHaveBeenCalled();
    });

    it('drops a pending search-field press when the window loses focus', async () => {
      hasWindowBar = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });

      await act(async () => {
        fireEvent.mouseDown(input, { buttons: 1, detail: 1, screenX: 100, screenY: 10 });
        // e.g. Alt+Tab mid-press; a later press elsewhere comes back with the button down.
        fireEvent.blur(window);
        fireEvent.mouseMove(window, { buttons: 1, screenX: 180, screenY: 10 });
        await flush();
      });

      expect(startDragging).not.toHaveBeenCalled();
    });

    it('drags the window from an unfocused search field once the pointer moves', async () => {
      hasWindowBar = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });

      let notCancelled = true;
      await act(async () => {
        notCancelled = fireEvent.mouseDown(input, {
          buttons: 1,
          detail: 1,
          screenX: 100,
          screenY: 10,
        });
        fireEvent.mouseMove(window, { buttons: 1, screenX: 112, screenY: 10 });
        await flush();
      });

      expect(notCancelled).toBe(false);
      expect(startDragging).toHaveBeenCalledOnce();
      expect(document.activeElement).not.toBe(input);
    });

    it('does not drag for a press that barely moves', async () => {
      hasWindowBar = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });

      await act(async () => {
        fireEvent.mouseDown(input, { buttons: 1, detail: 1, screenX: 100, screenY: 10 });
        fireEvent.mouseMove(window, { buttons: 1, screenX: 102, screenY: 11 });
        await flush();
      });

      expect(startDragging).not.toHaveBeenCalled();
    });

    it('focuses an unfocused search field on a click without dragging', async () => {
      hasWindowBar = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });

      await act(async () => {
        fireEvent.mouseDown(input, { buttons: 1, detail: 1, screenX: 100, screenY: 10 });
        fireEvent.mouseUp(window, { screenX: 100, screenY: 10 });
        await flush();
      });

      expect(document.activeElement).toBe(input);
      expect(startDragging).not.toHaveBeenCalled();
    });

    it('leaves a focused search field to select text', async () => {
      hasWindowBar = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });
      input.focus();

      let notCancelled = false;
      await act(async () => {
        notCancelled = fireEvent.mouseDown(input, {
          buttons: 1,
          detail: 1,
          screenX: 100,
          screenY: 10,
        });
        fireEvent.mouseMove(window, { buttons: 1, screenX: 140, screenY: 10 });
        await flush();
      });

      expect(notCancelled).toBe(true);
      expect(startDragging).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
    });

    it('moves the window by pointer from the search field on Linux CEF', async () => {
      hasWindowBar = true;
      pointerWindowControls = true;
      render(<SearchFieldHarness />);
      const input = screen.getByRole('textbox', { name: 'Search' });

      await act(async () => {
        fireEvent.mouseDown(input, { buttons: 1, detail: 1, screenX: 100, screenY: 10 });
        fireEvent.mouseMove(window, { buttons: 1, screenX: 100, screenY: 22 });
        await flush();
      });

      expect(startPointerWindowMove).toHaveBeenCalledOnce();
      expect(startPointerWindowMove.mock.calls[0]![0]).toMatchObject({ screenX: 100, screenY: 10 });
      expect(startDragging).not.toHaveBeenCalled();
    });
  });
});
