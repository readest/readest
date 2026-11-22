// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateTextMock, nativeGenerate, nativeCancel, nativeStatus, supported } = vi.hoisted(
  () => ({
    generateTextMock: vi.fn(),
    nativeGenerate: vi.fn(),
    nativeCancel: vi.fn(),
    nativeStatus: vi.fn(),
    supported: { value: true },
  }),
);

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: generateTextMock };
});
vi.mock('@/utils/bridge', () => ({
  onDeviceLLMGenerate: nativeGenerate,
  cancelOnDeviceLLM: nativeCancel,
  getOnDeviceLLMStatus: nativeStatus,
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => supported.value,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'ios' }));
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

import { lookupInContext } from '@/services/dictionaries/contextDictionary';
import { buildCustomTranslator } from '@/services/translators/custom';
import { __clearOnDeviceInfoForTests } from '@/services/translators/custom/onDevice';
import { generateChatText } from '@/services/translators/custom/openaiCompatible';
import { getLLMTranslators, useCustomTranslatorStore } from '@/store/customTranslatorStore';
import type { CustomTranslator } from '@/types/translation';

const onDevice: CustomTranslator = {
  id: 'apple',
  type: 'apple-intelligence',
  name: 'Apple Intelligence',
  temperature: 0.3,
  addedAt: 1,
  updatedAt: 1,
};

describe('Apple Intelligence custom translator', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    nativeGenerate.mockReset();
    nativeCancel.mockReset().mockResolvedValue(undefined);
    nativeStatus
      .mockReset()
      .mockResolvedValue({ available: true, contextSize: 4096, languages: ['en', 'fr', 'zh'] });
    __clearOnDeviceInfoForTests();
    supported.value = true;
    useCustomTranslatorStore.setState({ translators: [], prompts: [], loaded: true });
  });

  it('translates through the on-device model, not an HTTP chat API', async () => {
    nativeGenerate.mockResolvedValue({ text: 'Bonjour' });
    const provider = buildCustomTranslator(onDevice);
    const out = await provider.translate(['Hello'], 'en', 'fr');
    expect(out).toEqual(['Bonjour']);
    expect(generateTextMock).not.toHaveBeenCalled();
    const request = nativeGenerate.mock.calls[0]![0];
    expect(request.instructions).toContain('French');
    expect(request.prompt).toBe('Hello');
    expect(request.temperature).toBe(0.3);
    expect(provider.disabled).toBe(false);
  });

  it('keeps batches small enough for the 4096-token on-device context', async () => {
    nativeGenerate.mockImplementation(async ({ prompt }: { prompt: string }) => ({ text: prompt }));
    const provider = buildCustomTranslator(onDevice);
    const paragraph = '这是一段很长的中文段落。'.repeat(50); // 600 characters
    await provider.translate([paragraph, paragraph], 'zh', 'en');
    expect(nativeGenerate).toHaveBeenCalledTimes(2);
  });

  it('fills bigger batches when the model has a bigger context', async () => {
    nativeStatus.mockResolvedValue({ available: true, contextSize: 8192, languages: ['en', 'zh'] });
    nativeGenerate.mockImplementation(async ({ prompt }: { prompt: string }) => ({ text: prompt }));
    const provider = buildCustomTranslator(onDevice);
    const paragraph = '这是一段很长的中文段落。'.repeat(50); // 600 characters
    await provider.translate([paragraph, paragraph], 'zh', 'en');
    expect(nativeGenerate).toHaveBeenCalledTimes(1);
  });

  it('refuses a target language the model cannot write before asking it', async () => {
    const provider = buildCustomTranslator(onDevice);
    await expect(provider.translate(['Hello'], 'en', 'ru')).rejects.toThrow(
      "Apple Intelligence can't write Russian.",
    );
    await expect(
      lookupInContext(
        onDevice,
        { text: 'word', before: '', after: '', targetLang: 'ru' },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Apple Intelligence can't write Russian.");
    expect(nativeGenerate).not.toHaveBeenCalled();
  });

  it('accepts a regional variant of a supported language', async () => {
    nativeGenerate.mockResolvedValue({ text: '你好' });
    const provider = buildCustomTranslator(onDevice);
    await expect(provider.translate(['Hello'], 'en', 'zh-TW')).resolves.toEqual(['你好']);
  });

  it('cuts the context dictionary passage to fit the on-device window', async () => {
    nativeGenerate.mockResolvedValue({ text: '{"definition":"meaning"}' });
    const long = '字'.repeat(3000);
    await lookupInContext(
      onDevice,
      { text: 'word', before: long, after: long, targetLang: 'en' },
      new AbortController().signal,
    );
    // A quarter of the 4096-token window for book text, split between the sides.
    const { before, after } = JSON.parse(nativeGenerate.mock.calls[0]![0].prompt);
    expect(before.length).toBe(512);
    expect(after.length).toBe(512);
  });

  it('publishes the whole answer to a streaming caller', async () => {
    nativeGenerate.mockResolvedValue({ text: '{"definition":"x"}' });
    const onText = vi.fn();
    const text = await generateChatText(onDevice, {
      system: 'sys',
      prompt: 'p',
      maxOutputTokens: 400,
      maxRetries: 1,
      abortSignal: new AbortController().signal,
      onText,
    });
    expect(text).toBe('{"definition":"x"}');
    expect(onText).toHaveBeenCalledWith('{"definition":"x"}');
    expect(nativeGenerate.mock.calls[0]![0].maxTokens).toBe(400);
  });

  it('cancels the native request when the caller aborts', async () => {
    let rejectNative: (err: unknown) => void = () => {};
    nativeGenerate.mockReturnValue(new Promise((_, reject) => (rejectNative = reject)));
    const controller = new AbortController();
    const pending = generateChatText(onDevice, {
      system: 'sys',
      prompt: 'p',
      maxRetries: 1,
      abortSignal: controller.signal,
    });
    controller.abort();
    rejectNative('Aborted');
    await expect(pending).rejects.toThrow();
    const { requestId } = nativeGenerate.mock.calls[0]![0];
    expect(nativeCancel).toHaveBeenCalledWith(requestId);
  });

  it('turns a native rejection string into an Error', async () => {
    nativeGenerate.mockRejectedValue('Apple Intelligence is not enabled');
    await expect(
      generateChatText(onDevice, {
        system: 's',
        prompt: 'p',
        maxRetries: 1,
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow('Apple Intelligence is not enabled');
  });

  it('is offered to the context dictionary only where the model can run', () => {
    useCustomTranslatorStore.setState({ translators: [onDevice] });
    expect(getLLMTranslators().map((t) => t.id)).toEqual(['apple']);
    supported.value = false;
    expect(getLLMTranslators()).toEqual([]);
    expect(buildCustomTranslator(onDevice).disabled).toBe(true);
  });
});
