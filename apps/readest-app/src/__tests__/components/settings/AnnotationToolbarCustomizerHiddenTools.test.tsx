// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

/**
 * A toolbar syncs across devices, but Share and the System Dictionary tool
 * (#6728) exist only on some. Editing the toolbar on a device that hides one
 * must keep it in the saved list, so the device that offers it still has it.
 */

const h = vi.hoisted(() => ({
  saveViewSettings: vi.fn(),
  items: ['copy', 'share', 'systemdictionary'],
}));

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
    settings: { globalViewSettings: { annotationToolbarItems: h.items } },
  }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: h.saveViewSettings,
}));

vi.mock('@/utils/share', () => ({
  canShareText: () => false,
}));

vi.mock('@/services/dictionaries/systemDictionary', () => ({
  isSystemDictionarySupported: () => false,
}));

import AnnotationToolbarCustomizer from '@/components/settings/AnnotationToolbarCustomizer';

afterEach(cleanup);

describe('AnnotationToolbarCustomizer on a device that hides some tools', () => {
  it('shows neither hidden tool and keeps both in the saved toolbar', () => {
    const { getByText, queryByRole } = render(
      <AnnotationToolbarCustomizer bookKey='test' onBack={() => {}} />,
    );
    expect(queryByRole('button', { name: 'Share' })).toBeNull();
    expect(queryByRole('button', { name: 'System Dictionary' })).toBeNull();

    fireEvent.click(getByText('Clear all'));
    expect(h.saveViewSettings.mock.lastCall?.[3]).toEqual(['share', 'systemdictionary']);
  });
});
