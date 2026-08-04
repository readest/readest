import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

/**
 * Regression guard for issue #4839 (display error under e-ink mode).
 *
 * The Customize Toolbar sub-page renders a content-width *preview* of the live
 * selection popup. The preview surface uses `bg-gray-600 text-white` to mirror
 * the real popup — but unlike the real popup (which earns its e-ink treatment
 * from `.popup-container` in globals.css), the preview Zone is a plain div. With
 * no e-ink override, the dark fill survives under `[data-eink='true']` and the
 * whole row paints as an unreadable solid black bar.
 *
 * Invariant: the toolbar preview must carry `eink-bordered`, so e-ink swaps the
 * dark fill for a `base-100` surface with a 1px `base-content` border — matching
 * how the annotation toolbar renders in the reader.
 */

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => undefined }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalViewSettings: { annotationToolbarItems: undefined } },
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn(),
}));

vi.mock('@/utils/share', () => ({
  canShareText: () => true,
}));

import AnnotationToolbarCustomizer from '@/components/settings/AnnotationToolbarCustomizer';

afterEach(() => {
  cleanup();
});

describe('AnnotationToolbarCustomizer e-ink toolbar preview', () => {
  it('marks the toolbar preview eink-bordered so e-ink swaps the dark fill for a bordered base-100 surface', () => {
    const { container } = render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);
    const toolbarPreview = container.querySelector('.selection-popup') as HTMLElement;
    expect(toolbarPreview).not.toBeNull();
    expect(toolbarPreview.classList.contains('eink-bordered')).toBe(true);
  });

  /**
   * The preview surface mirrors the real popup's theme-aware fill
   * (`bg-base-300`, `base-100` under dark themes), so it is *light* on light
   * themes. A hardcoded white empty-state hint only worked against the old
   * fixed dark `bg-gray-600` fill and would be unreadable now.
   */
  it('keeps the empty-toolbar hint readable against the theme-aware preview surface', () => {
    const { getByText } = render(<AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />);
    fireEvent.click(getByText('Clear all'));
    const hint = getByText('No tools, drag one here');
    expect(hint.className).not.toMatch(/text-white/);
  });
});
