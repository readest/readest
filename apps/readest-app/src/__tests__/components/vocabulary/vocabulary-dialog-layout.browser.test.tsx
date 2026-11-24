import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import VocabularyDialog, {
  setVocabularyDialogVisible,
} from '@/components/vocabulary/VocabularyDialog';
import { useVocabularyStore } from '@/store/vocabularyStore';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The Anki link reads the account; the app always renders this inside AuthProvider.
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, token: null }) }));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: undefined, customizationPurchased: false }),
}));
await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
});

const openWindow = async (width: number, bookTitle?: string) => {
  await page.viewport(width, 800);
  useVocabularyStore.setState({
    entries: {
      'en:spice': {
        id: 'en:spice',
        lang: 'en',
        key: 'spice',
        word: 'spice',
        state: 'learning',
        occurrences: bookTitle ? [{ bookTitle, sentence: 'Add some spice.', at: 2 }] : [],
        createdAt: 1,
        modifiedAt: 1,
        deletedAt: null,
      },
    },
    loaded: true,
  });
  render(<VocabularyDialog />);
  act(() => setVocabularyDialogVisible(true));
  return (await screen.findByRole('group', { name: 'Filter' })).closest('.modal-box')!;
};

const size = (el: Element) => {
  const r = el.getBoundingClientRect();
  return Math.min(r.width, r.height);
};

describe('vocabulary window layout', () => {
  // 640-760px is where the box used to keep its fixed 760px desktop width.
  for (const width of [390, 640, 666, 720, 1100]) {
    it(`keeps the window inside a ${width}px screen`, async () => {
      const rect = (await openWindow(width)).getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
    });
  }

  it('gives the phone header buttons a big enough tap target', async () => {
    await openWindow(390);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), {
      target: { value: 'sp' },
    });
    expect(size(screen.getByRole('button', { name: 'Clear' }))).toBeGreaterThanOrEqual(32);
    fireEvent.click(screen.getByRole('button', { name: 'spice' }));
    // Back navigates away and Delete isn't undoable: 44px (DESIGN.md hit targets).
    for (const name of ['Back', 'Look up', 'Delete']) {
      expect(size(screen.getByRole('button', { name })), name).toBeGreaterThanOrEqual(44);
    }
  });

  it('keeps the word list visible when a source book has a long unbroken title', async () => {
    await openWindow(800, 'Academialacabrada'.repeat(15));
    const list = screen.getByRole('list', { name: 'Words' });
    const width = list.getBoundingClientRect().width;
    fireEvent.click(screen.getByRole('button', { name: 'spice' }));
    expect(list.getBoundingClientRect().width).toBeCloseTo(width, 0);
  });

  for (const eink of [false, true]) {
    it(`shows keyboard focus on the search field and book chip, e-ink ${eink}`, async () => {
      document.documentElement.dataset['eink'] = String(eink);
      await openWindow(390);
      const search = screen.getByRole('searchbox', { name: 'Search' });
      const book = screen.getByRole('combobox', { name: 'Book' });
      const look = (el: HTMLElement) => {
        const s = getComputedStyle(el.parentElement!);
        return `${s.boxShadow}|${s.backgroundColor}|${s.outlineStyle}`;
      };
      const idle = [look(search), look(book)];
      search.focus();
      await userEvent.keyboard('{Tab}');
      // Tab from the search field reaches the book chip after the chips.
      while (document.activeElement !== book) await userEvent.keyboard('{Tab}');
      expect(look(book)).not.toBe(idle[1]);
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
      while (document.activeElement !== search) {
        await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
      }
      expect(look(search)).not.toBe(idle[0]);
    });
  }
});
