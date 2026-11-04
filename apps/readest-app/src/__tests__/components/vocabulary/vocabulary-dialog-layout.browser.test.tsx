import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { page } from 'vitest/browser';
import VocabularyDialog, {
  setVocabularyDialogVisible,
} from '@/components/vocabulary/VocabularyDialog';
import { useVocabularyStore } from '@/store/vocabularyStore';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {}, appService: null }) }));
await import('@/styles/globals.css');

afterEach(() => cleanup());

describe('vocabulary window layout', () => {
  // 640-760px is where the box used to keep its fixed 760px desktop width.
  for (const width of [390, 640, 666, 720, 1100]) {
    it(`keeps the window inside a ${width}px screen`, async () => {
      await page.viewport(width, 800);
      useVocabularyStore.setState({
        entries: {
          'en:spice': {
            id: 'en:spice',
            lang: 'en',
            key: 'spice',
            word: 'spice',
            state: 'learning',
            occurrences: [],
            createdAt: 1,
            modifiedAt: 1,
            deletedAt: null,
          },
        },
        loaded: true,
      });
      render(<VocabularyDialog />);
      act(() => setVocabularyDialogVisible(true));
      const box = (await screen.findByRole('group', { name: 'Filter' })).closest('.modal-box')!;
      const rect = box.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(width);
    });
  }
});
