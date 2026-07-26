import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ImportMenuPopup, { getMenuPosition } from '@/app/library/components/ImportMenuPopup';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const useEnvMock = vi.fn();
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => useEnvMock(),
}));

const renderPopup = (props: Partial<React.ComponentProps<typeof ImportMenuPopup>> = {}) => {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const utils = render(
    <ImportMenuPopup
      anchor={anchor}
      onClose={onClose}
      onImportBooksFromFiles={vi.fn()}
      onOpenCatalogManager={vi.fn()}
      onOpenFeeds={vi.fn()}
      {...props}
    />,
  );
  return { ...utils, anchor, onClose };
};

beforeEach(() => {
  useEnvMock.mockReturnValue({ appService: { isOnlineCatalogsAccessible: true } });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  useEnvMock.mockReset();
});

describe('ImportMenuPopup', () => {
  it('shows the same always-available options as the library header menu', () => {
    renderPopup();

    expect(screen.getByRole('menuitem', { name: 'From Local File' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'From Feed URL' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Online Library' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'From Directory' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'From Web URL' })).toBeNull();
  });

  it('adds the platform-dependent options when their callbacks are available', () => {
    const onImportBooksFromDirectory = vi.fn();
    const onImportBookFromUrl = vi.fn();
    const { onClose } = renderPopup({ onImportBooksFromDirectory, onImportBookFromUrl });

    fireEvent.click(screen.getByRole('menuitem', { name: 'From Directory' }));
    expect(onImportBooksFromDirectory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('menuitem', { name: 'From Web URL' }));
    expect(onImportBookFromUrl).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('uses the OPDS label when curated online catalogs are unavailable', () => {
    useEnvMock.mockReturnValue({ appService: { isOnlineCatalogsAccessible: false } });
    renderPopup();

    expect(screen.getByRole('menuitem', { name: 'OPDS Catalogs' })).toBeTruthy();
  });

  it('runs the selected action and dismisses the popup', () => {
    const onImportBooksFromFiles = vi.fn();
    const { onClose } = renderPopup({ onImportBooksFromFiles });

    fireEvent.click(screen.getByRole('menuitem', { name: 'From Local File' }));

    expect(onImportBooksFromFiles).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses the popup when the backdrop is clicked', () => {
    const { container, onClose } = renderPopup();

    fireEvent.click(container.querySelector('.overlay')!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('getMenuPosition', () => {
  const bounds = { left: 8, top: 8, right: 992, bottom: 792 };
  const menu = { width: 200, height: 240 };
  const anchorRect = (left: number, top: number, width = 100, height = 140) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    }) as DOMRect;

  it('centers the menu under the anchor', () => {
    expect(getMenuPosition(anchorRect(400, 200), menu, bounds)).toEqual({
      left: 400 + 50 - 100,
      top: 340 + 8,
    });
  });

  it('flips above the anchor when there is no room below', () => {
    expect(getMenuPosition(anchorRect(400, 600), menu, bounds)).toEqual({
      left: 350,
      top: 600 - 8 - 240,
    });
  });

  it('keeps the menu inside the bounds near the edges', () => {
    expect(getMenuPosition(anchorRect(0, 200), menu, bounds).left).toBe(8);
    expect(getMenuPosition(anchorRect(960, 200, 40), menu, bounds).left).toBe(792);
    // Menu taller than the room on either side of a short viewport.
    expect(
      getMenuPosition(anchorRect(400, 40), menu, { left: 8, top: 8, right: 992, bottom: 292 }).top,
    ).toBe(8);
  });

  it('respects safe area insets when clamping', () => {
    const insetBounds = { left: 52, top: 8, right: 992, bottom: 792 };

    expect(getMenuPosition(anchorRect(0, 200), menu, insetBounds).left).toBe(52);
  });
});
