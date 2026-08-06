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

    expect(screen.getByText('Context Translate')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Translating to English...');
  });

  it('renders an error and wires action buttons', () => {
    const { onRetry, onOpenSettings } = renderView({
      status: 'error',
      message: 'AI translation is not configured.',
      retryable: true,
    });

    expect(screen.getByText('AI translation is not configured.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Settings/ }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('renders normal translation results', () => {
    renderView({
      status: 'success',
      result: {
        mode: 'normal',
        headword: 'bonjour',
        translation: 'hello',
        explanation: 'A greeting used during the day.',
      },
    });

    expect(screen.getByText('Translation')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('Explanation')).toBeInTheDocument();
    expect(screen.getByText('A greeting used during the day.')).toBeInTheDocument();
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
        translation: 'take care of',
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

    expect(screen.getByText('Grammar pattern')).toBeInTheDocument();
    expect(screen.getByText('prendre soin de + noun')).toBeInTheDocument();
    expect(screen.getByText('Pronunciation')).toBeInTheDocument();
    expect(screen.getByText('pʁɑ̃dʁ swɛ̃ də')).toBeInTheDocument();
    expect(screen.getByText('Definition')).toBeInTheDocument();
    expect(screen.getByText('To take care of someone or something.')).toBeInTheDocument();
    expect(screen.getByText('Examples')).toBeInTheDocument();
    expect(screen.getByText('Elle prend soin de son frère.')).toBeInTheDocument();
    expect(screen.getByText('Synonyms')).toBeInTheDocument();
    expect(screen.getByText("s'occuper de")).toBeInTheDocument();
  });
});
