import { type as osType } from '@tauri-apps/plugin-os';
import { isTauriAppPlatform } from '@/services/environment';
import { cancelOnDeviceLLM, getOnDeviceLLMStatus, onDeviceLLMGenerate } from '@/utils/bridge';
import { stubTranslation as _, uniqueId } from '@/utils/misc';
import type { CustomTranslator } from '@/types/translation';

/** Apple's Foundation Models are only bridged in the iOS/iPadOS app (#7429). */
export const isOnDeviceLLMSupported = () => isTauriAppPlatform() && osType() === 'ios';

/**
 * Every message an on-device request can fail with, registered for extraction
 * and translated with `_()` where the error is shown. The last four come from
 * OnDeviceLLM.swift and must match it exactly.
 */
export const ON_DEVICE_ERRORS = [
  _("Apple Intelligence can't write in the target language."),
  _('Apple Intelligence is not available on this device.'),
  _('Apple Intelligence is turned off. Turn it on in Settings > Apple Intelligence & Siri.'),
  _('The Apple Intelligence model is still downloading. Try again later.'),
  _('The text is too long for Apple Intelligence on this device.'),
];

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
    throw new Error(ON_DEVICE_ERRORS[0]);
  }
  return info;
};

/**
 * Cuts text longer than `max` characters at sentence ends, cutting a sentence
 * that is itself too long. Joining the pieces gives back the text.
 */
export const splitForOnDevice = (text: string, max: number): string[] => {
  const sentences = text.match(/[^。！？!?.]*[。！？!?.]+\s*|[^。！？!?.]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = '';
  for (let sentence of sentences) {
    if (current && current.length + sentence.length > max) {
      pieces.push(current);
      current = '';
    }
    while (sentence.length > max) {
      // Never between the two halves of an emoji: a lone half fails the native IPC.
      const code = sentence.charCodeAt(max - 1);
      const cut = max > 1 && code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
      pieces.push(sentence.slice(0, cut));
      sentence = sentence.slice(cut);
    }
    current += sentence;
  }
  if (current) pieces.push(current);
  return pieces;
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
