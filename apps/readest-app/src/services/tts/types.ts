export type TTSGranularity = 'sentence' | 'word';

export type TTSMediaMetadataMode = 'sentence' | 'paragraph' | 'chapter';

export type TTSHighlightOptions = {
  style: 'highlight' | 'underline' | 'strikethrough' | 'squiggly' | 'outline';
  color: string;
};

export type TTSVoice = {
  id: string;
  name: string;
  lang: string;
  disabled?: boolean;
};

export type TTSVoicesGroup = {
  id: string;
  name: string;
  voices: TTSVoice[];
  disabled?: boolean;
};

export type TTSMark = {
  offset: number;
  name: string;
  text: string;
  language: string;
};

// 自定义 TTS 配置
export interface CustomTTSConfig {
  enabled: boolean;
  provider: 'edge-tts' | 'openai' | 'elevenlabs' | 'custom';
  // OpenAI TTS 配置
  openai?: {
    apiKey: string;
    model: string;
    voice: string;
  };
  // ElevenLabs 配置
  elevenlabs?: {
    apiKey: string;
    voiceId: string;
    modelId: string;
  };
  // 自定义 API 配置
  custom?: {
    apiUrl: string;
    apiKey: string;
    voiceId?: string;
  };
}

// 自定义 AI 配置
export interface CustomAIConfig {
  enabled: boolean;
  provider: 'openai' | 'anthropic' | 'openrouter' | 'ollama' | 'custom';
  // OpenAI 配置
  openai?: {
    apiKey: string;
    baseUrl?: string;
    model: string;
  };
  // Anthropic 配置
  anthropic?: {
    apiKey: string;
    model: string;
  };
  // OpenRouter 配置
  openrouter?: {
    apiKey: string;
    model: string;
  };
  // Ollama 配置
  ollama?: {
    baseUrl: string;
    model: string;
  };
  // 自定义 API 配置
  custom?: {
    apiUrl: string;
    apiKey?: string;
    model?: string;
  };
}
