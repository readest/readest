/**
 * A user-configured OpenAI-compatible speech service (`POST {baseUrl}/audio/speech`).
 * Its voices join the Read Aloud voice picker as one group; synced as the
 * `custom_tts` replica kind with `apiKey` encrypted.
 */
export interface CustomTTSService {
  id: string;
  name: string;
  /** e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /** Style instructions for models that take them (e.g. gpt-4o-mini-tts). */
  instructions?: string;
  disabled?: boolean;
  addedAt: number;
  updatedAt: number;
  deletedAt?: number;
  reincarnation?: string;
  lastSeenCipher?: Record<string, string>;
}
