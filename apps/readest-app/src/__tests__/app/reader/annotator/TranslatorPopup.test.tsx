/**
 * TranslatorPopup error reporting (#5823): a failed lookup must say why it
 * failed, not just "try again later", and must only blame a missing login
 * when the provider actually needs one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TranslationProvider } from '@/services/translators/types';

const mockTranslate = vi.fn();
let mockToken: string | null = 'readest-token';
let mockTranslator: Partial<TranslationProvider> = { name: 'azure', label: 'Azure Translator' };
// One array per test, not per render: the popup re-derives its provider list
// in an effect keyed on `translators`, so a fresh array every render would
// loop it.
let mockTranslators: Partial<TranslationProvider>[] = [mockTranslator];

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: mockToken }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { translateTargetLang: 'zh', translationProvider: 'azure' } },
    setSettings: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTranslator', () => ({
  useTranslator: () => ({
    translate: mockTranslate,
    translator: mockTranslator,
    translators: mockTranslators,
    loading: false,
  }),
}));

vi.mock('@/services/translators', () => ({
  getTranslators: () => mockTranslators,
  isTranslatorAvailable: () => true,
  getTranslatorDisplayLabel: (t: TranslationProvider) => t.label,
}));

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const renderPopup = async () => {
  const { default: TranslatorPopup } = await import(
    '@/app/reader/components/annotator/TranslatorPopup'
  );
  return render(
    <TranslatorPopup
      text='cohort'
      position={{ point: { x: 0, y: 0 } }}
      trianglePosition={{ point: { x: 0, y: 0 }, dir: 'up' }}
      popupWidth={300}
      popupHeight={200}
    />,
  );
};

describe('TranslatorPopup error reporting', () => {
  beforeEach(() => {
    mockTranslate.mockReset();
    mockToken = 'readest-token';
    mockTranslator = { name: 'azure', label: 'Azure Translator' };
    mockTranslators = [mockTranslator];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the provider error alongside the generic message', async () => {
    mockTranslate.mockRejectedValue(new Error('bing translate failed with status 400'));
    await renderPopup();

    expect(
      await screen.findByText('Unable to fetch the translation. Try again later.'),
    ).toBeTruthy();
    expect(screen.getByText('bing translate failed with status 400')).toBeTruthy();
  });

  it('does not ask a logged-out user to log in when the provider needs no login', async () => {
    mockToken = null;
    mockTranslate.mockRejectedValue(new Error('bing translate failed with status 500'));
    await renderPopup();

    expect(
      await screen.findByText('Unable to fetch the translation. Try again later.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Please log in first/)).toBeNull();
    expect(screen.getByText('bing translate failed with status 500')).toBeTruthy();
  });

  it('asks for a login only when the provider requires one', async () => {
    mockToken = null;
    mockTranslator = { name: 'deepl', label: 'DeepL', authRequired: true };
    mockTranslators = [mockTranslator];
    mockTranslate.mockRejectedValue(new Error('Authentication token is required'));
    await renderPopup();

    expect(
      await screen.findByText(
        'Unable to fetch the translation. Please log in first and try again.',
      ),
    ).toBeTruthy();
  });
});
