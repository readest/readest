import { type as osType } from '@tauri-apps/plugin-os';
import { isTauriAppPlatform } from '@/services/environment';
import { cancelOnDeviceLLM, getOnDeviceLLMStatus, onDeviceLLMGenerate } from '@/utils/bridge';
import { getLanguageName } from '@/utils/lang';
import { uniqueId } from '@/utils/misc';
import type { CustomTranslator } from '@/types/translation';

/** Apple's Foundation Models are only bridged in the iOS/iPadOS app (#7429). */
export const isOnDeviceLLMSupported = () => isTauriAppPlatform() && osType() === 'ios';

interface OnDeviceModelInfo {
  /** Tokens for instructions, prompt and reply together. */
  contextSize: number;
  /** Base language codes the model can write, e.g. `zh`; empty when unknown. */
  languages: string[];
}

let modelInfo: OnDeviceModelInfo | undefined;

export const __clearOnDeviceInfoForTests = () => (modelInfo = undefined);

/** Kept once the model is available; asked again until then. */
const getOnDeviceModelInfo = async (): Promise<OnDeviceModelInfo> => {
  if (modelInfo) return modelInfo;
  const status = await getOnDeviceLLMStatus();
  const info = { contextSize: status.contextSize ?? 4096, languages: status.languages ?? [] };
  if (status.available) modelInfo = info;
  return info;
};

/**
 * Characters of book text that fit a request: a quarter of the window, since
 * CJK runs about one token per character and the reply needs room too.
 */
export const onDeviceInputChars = (contextSize: number) => Math.floor(contextSize / 4);

/** Rejects a target language the model can't write; resolves to the model's limits. */
export const prepareOnDevice = async (targetLang: string): Promise<OnDeviceModelInfo> => {
  const info = await getOnDeviceModelInfo();
  const base = targetLang.split(/[-_]/)[0]!.toLowerCase();
  if (info.languages.length > 0 && !info.languages.includes(base)) {
    throw new Error(`Apple Intelligence can't write ${getLanguageName(base)}.`);
  }
  return info;
};

/**
 * One answer from Apple's on-device model. Each request gets its own native
 * session: a session takes one request at a time, and lookups are unrelated.
 */
export const generateOnDeviceText = async (
  config: CustomTranslator,
  options: {
    system: string;
    prompt: string;
    maxOutputTokens?: number;
    abortSignal: AbortSignal;
    onText?: (text: string) => void | Promise<void>;
  },
): Promise<string> => {
  const { abortSignal } = options;
  abortSignal.throwIfAborted();
  const requestId = uniqueId();
  const cancel = () => void cancelOnDeviceLLM(requestId).catch(() => {});
  abortSignal.addEventListener('abort', cancel, { once: true });
  try {
    const { text } = await onDeviceLLMGenerate({
      requestId,
      instructions: options.system,
      prompt: options.prompt,
      temperature: config.temperature,
      maxTokens: options.maxOutputTokens,
    });
    abortSignal.throwIfAborted();
    await options.onText?.(text);
    return text;
  } catch (err) {
    abortSignal.throwIfAborted();
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    abortSignal.removeEventListener('abort', cancel);
  }
};
