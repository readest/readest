/**
 * The alert surface must not resize with its own content.
 *
 * Every call site mounts the alert as the lone child of a
 * `fixed inset-x-0 flex justify-center` bar. A flex item sizes to its content
 * unless it is given a definite width, so the alert box measured itself off its
 * longest line and jumped whenever that text changed — most visibly in
 * DeleteConfirmAlert, where flipping the purge toggle swaps in a longer
 * description and relabels the confirm button (issue: the popup grows/shrinks
 * mid-interaction).
 *
 * Needs real layout and real Tailwind, so it runs as a browser test.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: null }),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireBackKeyInterception: vi.fn(),
    releaseBackKeyInterception: vi.fn(),
  }),
}));

const { default: Alert } = await import('@/components/Alert');
const { default: DeleteConfirmAlert } = await import('@/components/DeleteConfirmAlert');
await import('@/styles/globals.css');

beforeAll(async () => {
  await page.viewport(1024, 768);
});
afterEach(() => cleanup());

// The container both DeleteConfirmAlert call sites (Bookshelf, BookDetailModal)
// and the plain-Alert ones (StorageManager, ClipSignInAlert) render into.
const AlertBar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className='fixed bottom-0 left-0 right-0 z-50 flex justify-center'>{children}</div>
);

const alertWidth = () => screen.getByRole('alert').getBoundingClientRect().width;

describe('Alert width stability', () => {
  it('keeps the delete popup at one width across the purge toggle', () => {
    render(
      <AlertBar>
        <DeleteConfirmAlert
          title='Confirm Deletion'
          message='Are you sure to delete 1 selected book(s)?'
          showPurgeToggle
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </AlertBar>,
    );

    const before = alertWidth();
    fireEvent.click(screen.getByRole('checkbox'));
    // The toggle swapped in the longer warning copy and the longer button label.
    expect(screen.getByText('Purge & Delete')).toBeTruthy();
    expect(alertWidth()).toBe(before);
  });

  it('sizes the delete popup like every other alert', () => {
    const { unmount } = render(
      <AlertBar>
        <Alert title='Confirm Deletion' message='Short.' onCancel={vi.fn()} onConfirm={vi.fn()} />
      </AlertBar>,
    );
    const plain = alertWidth();
    unmount();

    render(
      <AlertBar>
        <DeleteConfirmAlert
          title='Confirm Deletion'
          message='Are you sure to delete 1 selected book(s)?'
          showPurgeToggle
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </AlertBar>,
    );
    expect(alertWidth()).toBe(plain);
  });

  it('does not size a plain alert off its message', () => {
    const { unmount } = render(
      <AlertBar>
        <Alert title='Title' message='Short.' onCancel={vi.fn()} onConfirm={vi.fn()} />
      </AlertBar>,
    );
    const short = alertWidth();
    unmount();

    render(
      <AlertBar>
        <Alert
          title='Title'
          message={'A considerably longer message that would otherwise stretch the alert surface.'}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </AlertBar>,
    );
    expect(alertWidth()).toBe(short);
  });
});
