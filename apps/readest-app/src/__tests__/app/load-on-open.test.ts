import { beforeEach, describe, expect, test, vi } from 'vitest';

// The library and the reader render these only while they are open or in use, so they load
// them then. Settings brings the AI providers, highlight.js, the Notion export and ~180 modules
// with it, the AI assistant the AI SDKs and assistant-ui, the annotation export nunjucks, code
// highlighting highlight.js, the vocabulary window the dictionary providers (fflate, marked, KaTeX):
// on an e-ink reader their modules cost the launch and every book open otherwise.
const loaded = vi.hoisted(() => new Set<string>());
vi.mock('@/components/settings/SettingsDialog', () => {
  loaded.add('settings');
  return { default: () => null };
});
vi.mock('@/app/reader/components/notebook/AIAssistant', () => {
  loaded.add('ai assistant');
  return { default: () => null };
});
vi.mock('@/app/reader/components/annotator/ExportMarkdownDialog', () => {
  loaded.add('annotation export');
  return { default: () => null };
});
vi.mock('@/components/vocabulary/VocabularyView', () => {
  loaded.add('vocabulary');
  return { default: () => null };
});
vi.mock('@/utils/highlightjs', () => {
  loaded.add('code highlighting');
  return { manageSyntaxHighlighting: () => {}, CODE_LANGUAGES: [] };
});

describe('what loads when it is used', () => {
  beforeEach(() => {
    vi.resetModules();
    loaded.clear();
  });

  test('none of it with the library page', async () => {
    await import('@/app/library/page');
    expect([...loaded]).toEqual([]);
  }, 60000);

  test('none of it with the reader', async () => {
    await import('@/app/reader/components/ReaderContent');
    expect([...loaded]).toEqual([]);
  }, 60000);
});
