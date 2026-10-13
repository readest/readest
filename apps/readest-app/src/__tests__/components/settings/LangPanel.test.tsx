/**
 * LangPanel — "Enable Translation" availability gate (issue #5600).
 *
 * Translation is not available for PDFs, and the reader's toolbar toggler has
 * always refused to turn it on for them. Settings → Language offered the same
 * switch with no gate, so turning it on there translated the PDF text layer
 * paragraph by paragraph and burned the daily AI translation quota — after
 * which every selection popped a "Daily translation quota reached" toast.
 *
 * The switch must follow the toolbar's rule: off + unavailable => locked, but
 * an already-on book stays toggleable so the user can turn it back off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

import LangPanel from '@/components/settings/LangPanel';
import { saveViewSettings } from '@/helpers/settings';
import type { Book, BookFormat, ViewSettings } from '@/types/book';

const state = vi.hoisted(() => ({
  format: 'EPUB' as BookFormat,
  primaryLanguage: 'fr',
  translationEnabled: false,
  token: null as string | null,
  user: null as { id: string } | null,
  push: vi.fn(),
  setViewSettings: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: state.token, user: state.user }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push }),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

vi.mock('@/helpers/settings', () => ({
  saveViewSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/hooks/useResetSettings', () => ({
  useResetViewSettings: () => vi.fn(),
}));

vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: () => {},
}));

const viewSettings = () =>
  ({
    uiLanguage: '',
    translationEnabled: state.translationEnabled,
    translationProvider: 'deepl',
    translateTargetLang: 'en',
    showTranslateSource: true,
    ttsReadAloudText: 'both',
    replaceQuotationMarks: false,
    convertChineseVariant: 'none',
  }) as unknown as ViewSettings;

vi.mock('@/store/settingsStore', () => {
  const store = () => ({
    settings: { globalViewSettings: viewSettings() },
    applyUILanguage: vi.fn(),
    activeSettingsItemId: null,
    setActiveSettingsItemId: vi.fn(),
  });
  return { useSettingsStore: Object.assign(store, { getState: store }) };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => null,
    getViewSettings: () => viewSettings(),
    setViewSettings: state.setViewSettings,
    recreateViewer: vi.fn(),
  }),
}));

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => ({
      book: { format: state.format, primaryLanguage: state.primaryLanguage } as Book,
    }),
  }),
}));

const getEnableTranslationToggle = () => {
  const row = screen.getByText('Enable Translation').closest('label')!;
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

describe('LangPanel — Enable Translation availability', () => {
  beforeEach(() => {
    state.format = 'EPUB';
    state.primaryLanguage = 'fr';
    state.translationEnabled = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('allows enabling translation for a translatable book', () => {
    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(getEnableTranslationToggle().disabled).toBe(false);
    expect(screen.queryByText('Not available for this book.')).toBeNull();
  });

  // The reader's translation hook reacts to a new viewSettings object; an
  // in-place save left it untranslated until the book was reopened.
  it('publishes a new viewSettings object when translation is switched on', () => {
    state.setViewSettings.mockClear();
    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    fireEvent.click(getEnableTranslationToggle());

    expect(state.setViewSettings).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ translationEnabled: true }),
    );
  });

  it('locks the switch for a PDF, where translation is not available', () => {
    state.format = 'PDF';

    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(getEnableTranslationToggle().disabled).toBe(true);
    expect(screen.getByText('Not available for this book.')).toBeTruthy();
  });

  it('locks the switch when the book is already in the target language', () => {
    state.primaryLanguage = 'en';

    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(getEnableTranslationToggle().disabled).toBe(true);
  });

  it('keeps the switch usable on a PDF that already has translation on', () => {
    state.format = 'PDF';
    state.translationEnabled = true;

    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(getEnableTranslationToggle().disabled).toBe(false);
  });
});

const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
const sessionToken = (claims: object) => `${encode({ alg: 'none' })}.${encode(claims)}.sig`;

const getCustomTranslatorsRow = () =>
  screen.getByText('Custom Translators').closest('button') as HTMLButtonElement;

// Custom translators are a premium feature: free and signed-out readers see the
// row with a Premium badge that routes to the upgrade page or sign-in.
describe('LangPanel — Custom Translators premium gate', () => {
  beforeEach(() => {
    state.token = null;
    state.user = null;
    state.push.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('sends a signed-out reader to sign in', () => {
    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(getCustomTranslatorsRow().textContent).toContain('Premium');
    fireEvent.click(getCustomTranslatorsRow());
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\?redirect=/));
  });

  it('sends a free user to the plans page', () => {
    state.token = sessionToken({ plan: 'free' });
    state.user = { id: 'u' };

    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    fireEvent.click(getCustomTranslatorsRow());
    expect(state.push).toHaveBeenCalledWith(expect.stringMatching(/^\/user\?redirect=/));
    expect(screen.queryByText('Add Translator')).toBeNull();
  });

  it('opens the sub-page for a subscriber', () => {
    state.token = sessionToken({ plan: 'plus' });
    state.user = { id: 'u' };

    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);

    expect(getCustomTranslatorsRow().textContent).not.toContain('Premium');
    fireEvent.click(getCustomTranslatorsRow());
    expect(state.push).not.toHaveBeenCalled();
    expect(screen.getByText('Add Translator')).toBeTruthy();
  });
});

describe('LangPanel — Translated Text style', () => {
  beforeEach(() => {
    vi.mocked(saveViewSettings).mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('saves the chosen font, style and size for translated text', () => {
    render(<LangPanel bookKey='book-1' onRegisterReset={vi.fn()} />);
    // Settings saved before these keys existed must not be rewritten on open.
    expect(vi.mocked(saveViewSettings)).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Font'), { target: { value: 'serif' } });
    fireEvent.change(screen.getByLabelText('Font Style'), { target: { value: 'italic' } });
    fireEvent.change(screen.getByLabelText('Font Size'), { target: { value: '1.15' } });

    const saved = vi.mocked(saveViewSettings).mock.calls.map(([, , key, value]) => [key, value]);
    expect(saved).toContainEqual(['translationFont', 'serif']);
    expect(saved).toContainEqual(['translationFontStyle', 'italic']);
    expect(saved).toContainEqual(['translationFontSize', 1.15]);
  });
});
