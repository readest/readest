import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { DEFAULT_BOOK_LAYOUT, DEFAULT_VIEW_CONFIG } from '@/services/constants';
import type { ViewSettings } from '@/types/book';

/**
 * Layout's Reset must hand every stateful control to resetToDefaults; a setter
 * that is missing leaves its control (and the saved value it drives) unchanged,
 * as happened to Column Gap.
 */

const resetToDefaults = vi.hoisted(() => vi.fn());
const viewSettings = { ...DEFAULT_BOOK_LAYOUT, ...DEFAULT_VIEW_CONFIG } as ViewSettings;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isMobileApp: false } }),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResetSettings', () => ({ useResetViewSettings: () => resetToDefaults }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getViewSettings: () => viewSettings,
    getGridInsets: () => null,
    setViewSettings: vi.fn(),
    recreateViewer: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({ useBookDataStore: () => ({ getBookData: () => null }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalViewSettings: viewSettings } }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/utils/bridge', () => ({ lockScreenOrientation: vi.fn() }));

import LayoutPanel from '@/components/settings/LayoutPanel';

afterEach(() => {
  cleanup();
  resetToDefaults.mockClear();
});

describe('LayoutPanel reset', () => {
  it('resets Column Gap along with the other layout controls', () => {
    let reset: () => void = () => {};
    render(
      <LayoutPanel
        bookKey='book-1'
        onRegisterReset={(fn: () => void) => {
          reset = fn;
        }}
      />,
    );
    reset();
    expect(resetToDefaults).toHaveBeenCalledTimes(1);
    const setters = resetToDefaults.mock.calls[0]![0] as Record<string, unknown>;
    expect(setters['columnGapPx']).toBeTypeOf('function');
  });
});
