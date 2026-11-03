/**
 * Learning / Mastered chips in the dictionary header and Kindle-style capture
 * of lookups into the vocabulary builder (#789, #6613).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import DictionarySheet from '@/app/reader/components/annotator/DictionarySheet';
import { useVocabularyStore } from '@/store/vocabularyStore';
import { useCustomDictionaryStore } from '@/store/customDictionaryStore';

vi.mock('@/components/Dialog', () => ({
  default: ({ children, header }: { children: ReactNode; header?: ReactNode }) => (
    <div role='dialog'>
      <div data-testid='dialog-header'>{header}</div>
      {children}
    </div>
  ),
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/services/tts/wordPronouncer', () => ({
  pronounceWord: vi.fn().mockResolvedValue(undefined),
  warmWordAudio: vi.fn(),
  cancelWordPronounce: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@/services/dictionaries/registry', () => ({
  getEnabledProviders: () => [],
  __resetRegistryForTests: vi.fn(),
  evictProvider: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));

const capture = {
  lang: 'en',
  occurrence: { sentence: 'It was pure serendipity.', at: 100, bookHash: 'b1', cfi: 'c1' },
};

const sheet = (props: Partial<Parameters<typeof DictionarySheet>[0]> = {}) =>
  render(<DictionarySheet word='Serendipity' onDismiss={() => {}} {...props} />);

const entries = () => Object.values(useVocabularyStore.getState().entries);

beforeEach(() => {
  useVocabularyStore.setState({ entries: {}, loaded: false, version: 0 });
  useCustomDictionaryStore.setState({
    settings: { ...useCustomDictionaryStore.getState().settings, saveLookupsToVocabulary: true },
  });
});
afterEach(() => cleanup());

describe('dictionary vocabulary chips', () => {
  it('records the lookup with its sentence when opened', () => {
    sheet({ capture });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ id: 'en:serendipity', state: 'none' });
    expect(entries()[0]!.occurrences[0]!.sentence).toBe('It was pure serendipity.');
  });

  it('toggles Learning on and off', () => {
    sheet({ capture });
    const learning = screen.getByRole('button', { name: 'Learning' });
    expect(learning.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(learning);
    expect(entries()[0]!.state).toBe('learning');
    expect(learning.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(learning);
    expect(entries()[0]!.state).toBe('none');
  });

  it('switches from Learning to Mastered', () => {
    sheet({ capture });
    fireEvent.click(screen.getByRole('button', { name: 'Learning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mastered' }));
    expect(entries()[0]!.state).toBe('mastered');
    expect(screen.getByRole('button', { name: 'Learning' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('records nothing with capture turned off until a chip is tapped', () => {
    useCustomDictionaryStore.setState({
      settings: { ...useCustomDictionaryStore.getState().settings, saveLookupsToVocabulary: false },
    });
    sheet({ capture });
    expect(entries()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mastered' }));
    expect(entries()[0]).toMatchObject({ state: 'mastered', occurrences: [] });
  });

  it('shows chips without recording when the capture has no sentence', () => {
    sheet({ capture: { lang: 'en' } });
    expect(screen.getByRole('button', { name: 'Learning' })).toBeTruthy();
    expect(entries()).toHaveLength(0);
  });

  it('shows no chips without a capture context', () => {
    sheet();
    expect(screen.queryByRole('button', { name: 'Learning' })).toBeNull();
    expect(entries()).toHaveLength(0);
  });
});
