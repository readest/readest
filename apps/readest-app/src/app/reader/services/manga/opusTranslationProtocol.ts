export const OPUS_TRANSLATION_MODEL_ID = 'Xenova/opus-mt-ja-en';
export const OPUS_TRANSLATION_MODEL_REVISION = '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16';

export interface OpusTranslationRequest {
  id: number;
  type: 'translate';
  texts: string[];
}

export type OpusTranslationResponse =
  | { type: 'progress'; progress: number }
  | { type: 'result'; id: number; translations: unknown }
  | { type: 'error'; id: number; message: string };
