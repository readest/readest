import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));

const store = vi.hoisted(() => ({
  updateService: vi.fn(),
  addService: vi.fn(),
  saveCustomTTSServices: vi.fn(),
}));
vi.mock('@/store/customTTSStore', () => ({
  useCustomTTSStore: { getState: () => store },
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

import CustomTTSServiceEditor from '@/components/settings/CustomTTSServiceEditor';
import type { CustomTTSService } from '@/types/customTTS';

const service: CustomTTSService = {
  id: 's1',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-old',
  model: 'tts-1',
  addedAt: 1,
  updatedAt: 1,
};

afterEach(cleanup);

describe('CustomTTSServiceEditor', () => {
  it('saves a cleared API key as empty, so other devices drop it too', () => {
    render(<CustomTTSServiceEditor service={service} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    expect(store.updateService).toHaveBeenCalledWith('s1', expect.objectContaining({ apiKey: '' }));
  });

  it('names the URL it tried when the test fails', async () => {
    fetchMock.mockImplementation(async () => new Response('Not found', { status: 404 }));
    render(<CustomTTSServiceEditor service={service} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Test'));
    expect((await screen.findByText(/HTTP 404/)).textContent).toContain(
      'https://api.openai.com/v1/audio/speech',
    );
  });

  it('names the MiMo chat completions URL when its test fails', async () => {
    fetchMock.mockImplementation(async () => new Response('Not found', { status: 404 }));
    const mimo = { ...service, baseUrl: 'https://api.xiaomimimo.com', model: 'mimo-v2.5-tts' };
    render(<CustomTTSServiceEditor service={mimo} onBack={vi.fn()} />);
    fireEvent.click(screen.getByText('Test'));
    expect((await screen.findByText(/HTTP 404/)).textContent).toContain(
      'https://api.xiaomimimo.com/v1/chat/completions',
    );
  });
});
