import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AITranslationResultView,
  type AITranslationState,
} from '@/app/reader/components/annotator/AITranslationResultView';

afterEach(() => {
  cleanup();
});

const renderView = (state: AITranslationState) => {
  const onRetry = vi.fn();
  const onOpenSettings = vi.fn();

  render(
    <AITranslationResultView
      state={state}
      targetLanguage='English'
      onRetry={onRetry}
      onOpenSettings={onOpenSettings}
    />,
  );

  return { onRetry, onOpenSettings };
};

describe('AITranslationResultView', () => {
  it('renders the loading state', () => {
    renderView({ status: 'loading', detailLevel: 'normal' });

    expect(screen.getByText('Context Translate')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Translating to English...');
  });

  it('renders an error and wires action buttons', () => {
    const { onRetry, onOpenSettings } = renderView({
      status: 'error',
      message: 'AI translation is not configured.',
      retryable: true,
    });

    expect(screen.getByText('AI translation is not configured.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Settings/ }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('renders normal explanation results without translation or synonyms', () => {
    renderView({
      status: 'success',
      result: {
        mode: 'normal',
        headword: 'bonjour',
        explanation: 'A greeting used during the day.',
      },
    });

    expect(screen.queryByText('Translation')).toBeNull();
    expect(screen.queryByText('Synonyms')).toBeNull();
    expect(screen.getByText('Explanation')).toBeTruthy();
    expect(screen.getByText('A greeting used during the day.')).toBeTruthy();
  });

  it('renders detailed translation results', () => {
    renderView({
      status: 'success',
      result: {
        mode: 'detailed',
        headword: 'prendre soin de',
        grammarPattern: 'prendre soin de + noun',
        pronunciation: 'pʁɑ̃dʁ swɛ̃ də',
        definition: 'To take care of someone or something.',
        explanation: 'The phrase expresses care or responsibility.',
        examples: [
          {
            sentence: 'Elle prend soin de son frère.',
            explanation: 'She takes care of her brother.',
          },
        ],
        synonyms: [
          {
            phrase: "s'occuper de",
            example: "Il s'occupe du jardin.",
            nuance: 'More general and practical.',
          },
        ],
      },
    });

    expect(screen.getByText('Grammar pattern')).toBeTruthy();
    expect(screen.getByText('prendre soin de + noun')).toBeTruthy();
    expect(screen.getByText('Pronunciation')).toBeTruthy();
    expect(screen.getByText('pʁɑ̃dʁ swɛ̃ də')).toBeTruthy();
    expect(screen.getByText('Definition')).toBeTruthy();
    expect(screen.getByText('To take care of someone or something.')).toBeTruthy();
    expect(screen.getByText('Examples')).toBeTruthy();
    expect(screen.getByText('Elle prend soin de son frère.')).toBeTruthy();
    expect(screen.getByText('Synonyms')).toBeTruthy();
    expect(screen.getByText("s'occuper de")).toBeTruthy();
  });
});
