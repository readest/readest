import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const { mockSaveSettings } = vi.hoisted(() => ({
  mockSaveSettings: vi.fn().mockResolvedValue(undefined),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/services/environment', () => ({
  default: {
    getAppService: vi.fn().mockResolvedValue({
      saveSettings: mockSaveSettings,
    }),
  },
}));

import { EnvProvider } from '@/context/EnvContext';
import AIPanel from '@/components/settings/AIPanel';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { useSettingsStore } from '@/store/settingsStore';
import type { SystemSettings } from '@/types/settings';

function renderWithProviders() {
  return render(
    <EnvProvider>
      <AIPanel />
    </EnvProvider>,
  );
}

describe('AIPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'mistral:latest' }] }),
    });

    useSettingsStore.setState({
      settings: {
        aiSettings: {
          ...DEFAULT_AI_SETTINGS,
          enabled: true,
          provider: 'ollama',
          ollamaModel: 'missing-chat-model',
          ollamaEmbeddingModel: 'missing-embedding-model',
        },
      } as SystemSettings,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('persists fetched fallback models for ollama chat and embeddings', async () => {
    renderWithProviders();

    await waitFor(() => {
      const aiSettings = useSettingsStore.getState().settings.aiSettings;
      expect(aiSettings.ollamaModel).toBe('mistral:latest');
      expect(aiSettings.ollamaEmbeddingModel).toBe('mistral:latest');
    });

    const [modelSelect, embeddingSelect] = await screen.findAllByRole('combobox');
    expect((modelSelect as HTMLSelectElement).value).toBe('mistral:latest');
    expect((embeddingSelect as HTMLSelectElement).value).toBe('mistral:latest');

    expect(mockSaveSettings).toHaveBeenCalled();

    const lastSavedSettings = mockSaveSettings.mock.calls.at(-1)?.[0] as SystemSettings;
    expect(lastSavedSettings.aiSettings.ollamaModel).toBe('mistral:latest');
    expect(lastSavedSettings.aiSettings.ollamaEmbeddingModel).toBe('mistral:latest');
  });
});
