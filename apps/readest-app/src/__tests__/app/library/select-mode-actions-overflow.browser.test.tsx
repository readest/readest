import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { page } from 'vitest/browser';
import SelectModeActions from '@/app/library/components/SelectModeActions';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));
await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.dir = 'ltr';
});

const noop = () => {};

const renderActions = () =>
  render(
    <SelectModeActions
      selectedBooks={['0123456789abcdef0123456789abcdef']}
      safeAreaBottom={0}
      sendEnabled
      sendNearbyEnabled
      canDownload
      onOpen={noop}
      onGroup={noop}
      onTag={noop}
      onDetails={noop}
      onStatus={noop}
      onDownload={noop}
      onSend={noop}
      onSendNearby={noop}
      onDelete={noop}
      onCancel={noop}
    />,
  );

// The bar holds ten actions. Between the 4-column grid breakpoint (500px) and
// the width a single row needs, a centered row overflowed both edges, hiding
// Open on the left and Cancel on the right (#6969).
describe('library select-mode actions', () => {
  for (const width of [320, 384, 501, 540, 600, 700, 1024]) {
    for (const dir of ['ltr', 'rtl']) {
      it(`keeps every action on screen at ${width}px in ${dir}`, async () => {
        await page.viewport(width, 900);
        document.documentElement.dir = dir;
        const { getAllByRole } = renderActions();
        const buttons = getAllByRole('button');
        expect(buttons).toHaveLength(10);
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          expect(rect.left, button.textContent ?? '').toBeGreaterThanOrEqual(0);
          expect(rect.right, button.textContent ?? '').toBeLessThanOrEqual(window.innerWidth);
        }
      });
    }
  }
});
