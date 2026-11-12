import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import { BookshelfDragDrop, BookshelfDragItem } from '@/app/library/components/BookshelfDragDrop';
import BookshelfItem from '@/app/library/components/BookshelfItem';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { useSettingsStore } from '@/store/settingsStore';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import type { Book } from '@/types/book';

const mocks = vi.hoisted(() => ({ open: vi.fn(), select: vi.fn(), drop: vi.fn() }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasContextMenu: false }, envConfig: {} }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/app/library/hooks/useOpenBook', () => ({
  useOpenBook: () => ({ openBook: mocks.open }),
}));
vi.mock('@/hooks/useDefaultBookshelfCovers', () => ({
  useDefaultBookshelfCovers: () => ({ hideCovers: false }),
}));
await import('@/styles/globals.css');

const books: Book[] = ['Alpha', 'Beta', 'Gamma'].map((title, index) => ({
  hash: `${index}`,
  title,
  author: 'Writer',
  format: 'EPUB',
  updatedAt: index,
  createdAt: index,
}));
const shelf = { ...createBookshelf('', 'default'), layout: 'grid' as const };
const noop = () => {};
const card = (name: string) => screen.getByRole('button', { name });
const touch = (element: Element | Document, type: string, x: number, y: number) => {
  const event = new TouchEvent(type, { bubbles: true, cancelable: true });
  const point = { identifier: 1, target: element, clientX: x, clientY: y };
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] },
    changedTouches: { value: [point] },
  });
  fireEvent(element, event);
};
const mount = (layout: 'grid' | 'list' = 'grid', disabled = false, parentGroupName = '') =>
  render(
    <div style={{ width: 360, position: 'relative' }}>
      <BookshelfDragDrop
        sections={[{ definition: { ...shelf, layout }, items: books }]}
        groupBy='group'
        disabled={disabled}
        onDrop={mocks.drop}
        parentGroupName={parentGroupName}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: layout === 'grid' ? 'repeat(3, 1fr)' : '1fr',
          }}
        >
          {books.map((item) => (
            <BookshelfDragItem
              key={item.hash}
              shelf={{ ...shelf, layout }}
              item={item}
              disabled={disabled}
            >
              <BookshelfItem
                item={item}
                dragEnabled={!disabled}
                mode={layout}
                coverFit='crop'
                isSelectMode={false}
                itemSelected={false}
                transferProgress={null}
                setLoading={noop}
                toggleSelection={mocks.select}
                handleGroupBooks={noop}
                handleBookDownload={async () => true}
                handleBookUpload={async () => true}
                handleBookDelete={async () => true}
                handleSetSelectMode={noop}
                handleShowDetailsBook={noop}
                handleLibraryNavigation={noop}
                handleUpdateReadingStatus={noop}
                showTimeRemaining={false}
              />
            </BookshelfDragItem>
          ))}
        </div>
      </BookshelfDragDrop>
    </div>,
  );
const drag = async (
  name: string,
  targetName: string,
  center = false,
  layout: 'grid' | 'list' = 'grid',
) => {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const source = card(name);
  const start = source.getBoundingClientRect();
  fireEvent.pointerDown(source, {
    pointerType: 'mouse',
    pointerId: 1,
    clientX: start.x + 20,
    clientY: start.y + 30,
    button: 0,
  });
  fireEvent.mouseDown(source, { clientX: start.x + 20, clientY: start.y + 30, button: 0 });
  fireEvent.mouseMove(document, { clientX: start.x + 30, clientY: start.y + 30 });
  await waitFor(() =>
    expect(document.querySelector('[data-bookshelf-drag-id].opacity-30')).toBeTruthy(),
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
  const rect = card(targetName).getBoundingClientRect();
  const point = {
    clientX: rect.x + rect.width * (center || layout === 'list' ? 0.5 : 0.9),
    clientY: rect.y + rect.height * (layout === 'list' && !center ? 0.9 : 0.5),
  };
  fireEvent.mouseMove(document, point);
  await waitFor(() => expect(document.querySelector('[data-drop-intent]')).toBeTruthy());
  return point;
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, ...DEFAULT_SYSTEM_SETTINGS },
  });
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

describe('bookshelf dragging', () => {
  it('offers a parent drop region during a group drag and a keyboard equivalent', async () => {
    mount('grid', false, 'Fiction/Nested');
    expect(screen.queryByRole('group', { name: 'Move to parent group' })).toBeNull();
    const point = await drag('Alpha', 'Gamma');
    const parent = screen.getByRole('group', { name: 'Move to parent group' });
    expect(parent.textContent).toContain('Fiction');
    const bounds = parent.getBoundingClientRect();
    fireEvent.mouseMove(document, {
      clientX: bounds.x + bounds.width / 2,
      clientY: bounds.y + bounds.height / 2,
    });
    await waitFor(() => expect(parent.getAttribute('data-over')).toBe('true'));
    fireEvent.mouseUp(document, point);
    expect(mocks.drop).toHaveBeenLastCalledWith({ source: books[0], shelf, mode: 'parent' });
    fireEvent.keyDown(card('Beta'), { key: 'ArrowUp', altKey: true, shiftKey: true });
    expect(mocks.drop).toHaveBeenLastCalledWith({ source: books[1], shelf, mode: 'parent' });
  });

  it.skipIf(typeof TouchEvent === 'undefined')(
    'does not move up merely because a long press starts under the parent region',
    async () => {
      mount('grid', false, 'Fiction');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const source = card('Alpha');
      const rect = source.getBoundingClientRect();
      touch(source, 'touchstart', rect.x + 30, rect.y + 30);
      await waitFor(() => expect(document.querySelector('[data-dragging=true]')).toBeTruthy());
      touch(source, 'touchend', rect.x + 30, rect.y + 30);
      expect(mocks.drop).not.toHaveBeenCalled();
    },
  );

  it('previews insertion with animated sibling movement and distinguishes center grouping', async () => {
    mount();
    await drag('Alpha', 'Gamma');
    const sibling = card('Gamma').closest<HTMLElement>('[data-bookshelf-drag-id]')!;
    expect(getComputedStyle(sibling).transform).not.toBe('none');
    expect(getComputedStyle(sibling).transitionDuration).not.toBe('0s');
    const target = card('Beta').getBoundingClientRect();
    fireEvent.mouseMove(document, {
      clientX: target.x + target.width / 2,
      clientY: target.y + target.height / 2,
    });
    await waitFor(() =>
      expect(document.querySelector('[data-drop-intent="group-pending"]')).toBeTruthy(),
    );
    fireEvent.mouseUp(document);
    expect(mocks.drop).not.toHaveBeenCalled();
  });

  it.skipIf(typeof TouchEvent === 'undefined')(
    'starts a touch drag only after holding, and preserves immediate vertical swipes',
    async () => {
      mount();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const source = card('Alpha');
      const rect = source.getBoundingClientRect();
      touch(source, 'touchstart', rect.x + 20, rect.y + 30);
      touch(source, 'touchmove', rect.x + 20, rect.y + 80);
      touch(source, 'touchend', rect.x + 20, rect.y + 80);
      expect(document.querySelector('[data-dragging=true]')).toBeNull();
      expect(mocks.drop).not.toHaveBeenCalled();
      touch(source, 'touchstart', rect.x + 20, rect.y + 30);
      await waitFor(() => expect(document.querySelector('[data-dragging=true]')).toBeTruthy());
      const target = card('Gamma').getBoundingClientRect();
      touch(source, 'touchmove', target.x + target.width * 0.9, target.y + target.height / 2);
      await waitFor(() => expect(document.querySelector('[data-drop-intent=after]')).toBeTruthy());
      touch(source, 'touchend', target.x + target.width * 0.9, target.y + target.height / 2);
      expect(mocks.drop).toHaveBeenCalledWith(expect.objectContaining({ mode: 'after' }));
      expect(mocks.open).not.toHaveBeenCalled();
    },
  );

  it.skipIf(typeof TouchEvent === 'undefined')(
    'cancels a held touch without dropping and keeps e-ink grouping feedback crisp',
    async () => {
      document.documentElement.setAttribute('data-eink', 'true');
      document.documentElement.setAttribute('data-theme', 'default-dark');
      mount();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const source = card('Alpha');
      const rect = source.getBoundingClientRect();
      touch(source, 'touchstart', rect.x + 20, rect.y + 30);
      await waitFor(() => expect(document.querySelector('[data-dragging=true]')).toBeTruthy());
      const target = card('Beta').getBoundingClientRect();
      touch(source, 'touchmove', target.x + target.width / 2, target.y + target.height / 2);
      await waitFor(() => expect(document.querySelector('[data-drop-intent=group]')).toBeTruthy());
      const indicator = document.querySelector<HTMLElement>('[data-drop-intent=group]')!;
      expect(
        getComputedStyle(indicator.querySelector('.bookshelf-group-target')!).borderStyle,
      ).toBe('solid');
      expect(getComputedStyle(indicator).opacity).toBe('1');
      touch(source, 'touchcancel', target.x, target.y);
      expect(mocks.drop).not.toHaveBeenCalled();
      expect(document.querySelector('[data-dragging=true]')).toBeNull();
    },
  );

  it('keeps the drag label on screen when dragging from the column at the screen edge', async () => {
    const { innerWidth, innerHeight } = window;
    await page.viewport(360, 800);
    try {
      mount();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      for (const name of ['Alpha', 'Gamma']) {
        const source = card(name);
        const rect = source.getBoundingClientRect();
        const point = { clientX: rect.x + rect.width / 2, clientY: rect.y + 30, button: 0 };
        fireEvent.pointerDown(source, { ...point, pointerType: 'mouse', pointerId: 1 });
        fireEvent.mouseDown(source, point);
        fireEvent.mouseMove(document, { ...point, clientX: point.clientX + 8 });
        await waitFor(() => expect(document.querySelector('.bookshelf-drag-action')).toBeTruthy());
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        const label = document.querySelector('.bookshelf-drag-action')!.getBoundingClientRect();
        expect(label.left).toBeGreaterThanOrEqual(0);
        expect(label.right).toBeLessThanOrEqual(360);
        fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
        fireEvent.mouseUp(document, point);
        await waitFor(() => expect(document.querySelector('[data-dragging=true]')).toBeNull());
      }
    } finally {
      await page.viewport(innerWidth, innerHeight);
    }
  });

  it('does not open a book on release after a small drag is cancelled with Escape', async () => {
    mount();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const source = card('Alpha');
    const rect = source.getBoundingClientRect();
    const point = { clientX: rect.x + 20, clientY: rect.y + 30 };
    fireEvent.pointerDown(source, { ...point, pointerType: 'mouse', pointerId: 1, button: 0 });
    fireEvent.mouseDown(source, { ...point, button: 0 });
    fireEvent.mouseMove(document, { ...point, clientX: point.clientX + 8 });
    await waitFor(() => expect(document.querySelector('[data-dragging=true]')).toBeTruthy());
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    fireEvent.pointerUp(source, {
      ...point,
      clientX: point.clientX + 8,
      pointerType: 'mouse',
      pointerId: 1,
    });
    fireEvent.mouseUp(document, point);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.drop).not.toHaveBeenCalled();
  });

  it.each([
    'grid',
    'list',
  ] as const)('reorders %s items without opening or selecting the dragged book', async (layout) => {
    await page.viewport(390, 900);
    mount(layout);
    const point = await drag('Alpha', 'Gamma', false, layout);
    fireEvent.pointerUp(card('Alpha'), { ...point, pointerId: 1, pointerType: 'mouse' });
    fireEvent.mouseUp(document, point);
    expect(mocks.drop).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'after', source: books[0], target: books[2] }),
    );
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
  it('groups only after dwelling over the center, then cancels safely with Escape', async () => {
    mount();
    const point = await drag('Alpha', 'Beta', true);
    expect(document.querySelector('[data-drop-intent="group"]')).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-drop-intent="group"]')).toBeTruthy());
    fireEvent.mouseUp(document, point);
    expect(mocks.drop).toHaveBeenCalledWith(expect.objectContaining({ mode: 'group' }));
    mocks.drop.mockClear();
    await drag('Alpha', 'Gamma');
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    fireEvent.mouseUp(document, point);
    expect(mocks.drop).not.toHaveBeenCalled();
    expect(document.querySelector('[data-drop-intent]')).toBeNull();
  });

  it('keeps the viewport still when a grouped source moves out of view during saving', async () => {
    mount();
    const source = card('Alpha').closest<HTMLElement>('[data-bookshelf-drag-id]')!;
    const scroll = vi.spyOn(source, 'scrollIntoView');
    mocks.drop.mockImplementationOnce(() => {
      // Membership and persisted order settle separately: the old source can
      // briefly move below the viewport before it disappears into its group.
      source.style.position = 'absolute';
      source.style.top = '2000px';
    });
    const point = await drag('Alpha', 'Beta', true);
    await waitFor(() => expect(document.querySelector('[data-drop-intent=group]')).toBeTruthy());
    fireEvent.mouseUp(document, point);
    await waitFor(() => expect(document.querySelector('.bookshelf-drag-preview')).toBeNull());
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });
  it('supports Alt+arrow reordering, including RTL, while normal activation still opens the book', async () => {
    mount();
    fireEvent.keyDown(card('Beta'), { key: 'ArrowLeft', altKey: true });
    expect(mocks.drop).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'before', target: books[0] }),
    );
    document.documentElement.dir = 'rtl';
    fireEvent.keyDown(card('Beta'), { key: 'ArrowLeft', altKey: true });
    expect(mocks.drop).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'after', target: books[2] }),
    );
    fireEvent.keyDown(card('Beta'), { key: 'Enter' });
    expect(mocks.open).toHaveBeenCalledWith(books[1]);
  });
});
