// @vitest-environment happy-dom
/**
 * Learning / Mastered chips in the dictionary header and automatic capture
 * of lookups into the vocabulary builder (#789, #6613).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
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

  it('records a new sentence for the same word while the popup stays open', () => {
    const { rerender } = sheet({ capture });
    const next = {
      lang: 'en',
      occurrence: { sentence: 'Serendipity again.', at: 200, bookHash: 'b1', cfi: 'c2' },
    };
    rerender(<DictionarySheet word='Serendipity' onDismiss={() => {}} capture={next} />);
    expect(entries()[0]!.occurrences.map((o) => o.sentence)).toEqual([
      'Serendipity again.',
      'It was pure serendipity.',
    ]);
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

  it.each([
    ['Learning', 'learning'],
    ['Mastered', 'mastered'],
  ])('saves the source on an explicit %s mark with auto-save off', (label, state) => {
    useCustomDictionaryStore.setState({
      settings: { ...useCustomDictionaryStore.getState().settings, saveLookupsToVocabulary: false },
    });
    sheet({ capture });
    expect(entries()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(entries()[0]).toMatchObject({ state, occurrences: [capture.occurrence] });
  });

  it('shows chips without recording when the capture has no sentence', () => {
    sheet({ capture: { lang: 'en' } });
    expect(screen.getByRole('button', { name: 'Learning' })).toBeTruthy();
    expect(entries()).toHaveLength(0);
  });

  it('shows no chips for a selection with no letters', () => {
    render(<DictionarySheet word='—' onDismiss={() => {}} capture={{ lang: 'en' }} />);
    expect(screen.queryByRole('button', { name: 'Learning' })).toBeNull();
  });

  it('shows no chips without a capture context', () => {
    sheet();
    expect(screen.queryByRole('button', { name: 'Learning' })).toBeNull();
    expect(entries()).toHaveLength(0);
  });
});

describe('dictionary hint field (#7325)', () => {
  const hintField = () => screen.queryByRole('textbox', { name: 'Hint' }) as HTMLInputElement;
  const learn = () => fireEvent.click(screen.getByRole('button', { name: 'Learning' }));

  it('shows the hint field only while the word is Learning', () => {
    sheet({ capture });
    expect(hintField()).toBeNull();
    learn();
    expect(hintField()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mastered' }));
    expect(hintField()).toBeNull();
  });

  it('prefills the saved hint', () => {
    sheet({ capture });
    learn();
    useVocabularyStore.getState().setHint('en:serendipity', 'happy accident');
    cleanup();
    sheet({ capture });
    expect(hintField().value).toBe('happy accident');
  });

  it('saves the hint on Enter', () => {
    sheet({ capture });
    learn();
    fireEvent.change(hintField(), { target: { value: ' lucky find ' } });
    expect(entries()[0]!.hint).toBeUndefined();
    fireEvent.keyDown(hintField(), { key: 'Enter' });
    expect(entries()[0]!.hint).toBe('lucky find');
  });

  it('saves the hint on blur', () => {
    sheet({ capture });
    learn();
    fireEvent.change(hintField(), { target: { value: 'lucky find' } });
    fireEvent.blur(hintField());
    expect(entries()[0]!.hint).toBe('lucky find');
  });

  it('saves the hint when the popup closes while typing', () => {
    sheet({ capture });
    learn();
    fireEvent.change(hintField(), { target: { value: 'lucky find' } });
    cleanup();
    expect(entries()[0]!.hint).toBe('lucky find');
  });

  it('leaves the entry untouched when the hint did not change', () => {
    sheet({ capture });
    learn();
    const before = entries()[0]!.modifiedAt;
    fireEvent.blur(hintField());
    cleanup();
    expect(entries()[0]!.modifiedAt).toBe(before);
  });

  it('keeps a hint saved elsewhere while the popup is open and untouched', () => {
    sheet({ capture });
    learn();
    useVocabularyStore.getState().setHint('en:serendipity', 'from another device');
    fireEvent.blur(hintField());
    cleanup();
    expect(entries()[0]!.hint).toBe('from another device');
  });

  it('shows a hint saved elsewhere in the untouched field, but not over typing', () => {
    sheet({ capture });
    learn();
    act(() => useVocabularyStore.getState().setHint('en:serendipity', 'synced'));
    expect(hintField().value).toBe('synced');
    fireEvent.change(hintField(), { target: { value: 'mine' } });
    act(() => useVocabularyStore.getState().setHint('en:serendipity', 'synced again'));
    expect(hintField().value).toBe('mine');
  });

  it('does not save on the Enter that confirms an IME composition', () => {
    sheet({ capture });
    learn();
    fireEvent.change(hintField(), { target: { value: '幸运' } });
    fireEvent.keyDown(hintField(), { key: 'Enter', keyCode: 229 });
    expect(entries()[0]!.hint).toBeUndefined();
  });
});
