'use client';

import React from 'react';
import { MdErrorOutline, MdSettings, MdTranslate } from 'react-icons/md';

import type {
  ContextTranslationDetailLevel,
  ContextTranslationResult,
} from '@/services/ai/contextTranslationTypes';

export type AITranslationState =
  | { status: 'idle' }
  | { status: 'loading'; detailLevel: ContextTranslationDetailLevel }
  | { status: 'success'; result: ContextTranslationResult }
  | { status: 'error'; message: string; retryable: boolean };

type AITranslationResultViewProps = {
  state: AITranslationState;
  targetLanguage: string;
  onRetry: () => void;
  onOpenSettings: () => void;
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className='space-y-1 rounded-lg bg-base-200/40 p-3'>
    <h4 className='text-xs font-semibold uppercase tracking-wide text-base-content/60'>{title}</h4>
    <div className='text-sm leading-relaxed text-base-content'>{children}</div>
  </section>
);

const Empty = () => null;

const LoadingView = ({ targetLanguage }: { targetLanguage: string }) => (
  <div className='flex items-center gap-3 rounded-lg bg-base-200/40 p-3 text-sm text-base-content/70'>
    <span className='loading loading-spinner loading-sm' aria-hidden='true' />
    <span role='status'>Translating to {targetLanguage}...</span>
  </div>
);

const ErrorView = ({
  message,
  retryable,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  retryable: boolean;
  onRetry: () => void;
  onOpenSettings: () => void;
}) => (
  <div className='space-y-3 rounded-lg bg-error/10 p-3 text-sm text-error-content'>
    <div className='flex items-start gap-2'>
      <MdErrorOutline className='mt-0.5 shrink-0 text-lg text-error' aria-hidden='true' />
      <p className='text-base-content'>{message}</p>
    </div>
    <div className='flex flex-wrap gap-2'>
      {retryable ? (
        <button type='button' className='btn btn-sm btn-outline' onClick={onRetry}>
          Retry
        </button>
      ) : null}
      <button type='button' className='btn btn-sm btn-ghost' onClick={onOpenSettings}>
        <MdSettings aria-hidden='true' />
        Open Settings
      </button>
    </div>
  </div>
);

const NormalResultView = ({
  result,
}: {
  result: Extract<ContextTranslationResult, { mode: 'normal' }>;
}) => (
  <div className='space-y-3'>
    <Section title='Explanation'>
      <p>{result.explanation}</p>
    </Section>
  </div>
);

const DetailedResultView = ({
  result,
}: {
  result: Extract<ContextTranslationResult, { mode: 'detailed' }>;
}) => (
  <div className='space-y-3'>
    {result.grammarPattern ? (
      <Section title='Grammar pattern'>
        <p>{result.grammarPattern}</p>
      </Section>
    ) : null}
    {result.pronunciation ? (
      <Section title='Pronunciation'>
        <p>{result.pronunciation}</p>
      </Section>
    ) : null}
    <Section title='Definition'>
      <p>{result.definition}</p>
    </Section>
    <Section title='Explanation'>
      <p>{result.explanation}</p>
    </Section>
    {result.examples.length > 0 ? (
      <Section title='Examples'>
        <ul className='list-disc space-y-2 pl-5'>
          {result.examples.map((example) => (
            <li key={`${example.sentence}-${example.explanation}`}>
              <p>{example.sentence}</p>
              <p className='text-base-content/70'>{example.explanation}</p>
            </li>
          ))}
        </ul>
      </Section>
    ) : null}
    {result.synonyms.length > 0 ? (
      <Section title='Synonyms'>
        <ul className='space-y-2'>
          {result.synonyms.map((synonym) => (
            <li key={`${synonym.phrase}-${synonym.example}`}>
              <p className='font-medium'>{synonym.phrase}</p>
              <p>{synonym.example}</p>
              <p className='text-base-content/70'>{synonym.nuance}</p>
            </li>
          ))}
        </ul>
      </Section>
    ) : null}
  </div>
);

export const AITranslationResultView = ({
  state,
  targetLanguage,
  onRetry,
  onOpenSettings,
}: AITranslationResultViewProps) => {
  if (state.status === 'idle') return <Empty />;

  return (
    <div className='space-y-3' data-testid='ai-translation-result'>
      <div className='flex items-center gap-2 text-sm font-medium text-base-content'>
        <MdTranslate className='text-base-content/70' aria-hidden='true' />
        <span>Context Translate</span>
      </div>
      {state.status === 'loading' ? <LoadingView targetLanguage={targetLanguage} /> : null}
      {state.status === 'error' ? (
        <ErrorView
          message={state.message}
          retryable={state.retryable}
          onRetry={onRetry}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      {state.status === 'success' && state.result.mode === 'normal' ? (
        <NormalResultView result={state.result} />
      ) : null}
      {state.status === 'success' && state.result.mode === 'detailed' ? (
        <DetailedResultView result={state.result} />
      ) : null}
    </div>
  );
};
