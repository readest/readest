import { BufferedTTSClient } from './BufferedTTSClient';
import { OpenAICompatibleSpeechProvider } from './providers/openaiCompatible';
import type { TTSController } from './TTSController';
import type { AppService } from '@/types/system';
import type { TTSVoicesGroup } from './types';

export class OpenAICompatibleTTSClient extends BufferedTTSClient {
  constructor(controller?: TTSController, appService?: AppService | null) {
    super(new OpenAICompatibleSpeechProvider(), controller, appService);
  }

  // Compatible voice APIs often omit language metadata. Keep their advertised
  // voices visible in the normal picker rather than filtering them away.
  override async getVoices(_lang: string): Promise<TTSVoicesGroup[]> {
    const voices = await this.getAllVoices();
    return [
      {
        id: this.name,
        name: this.provider.label,
        voices,
        disabled: !this.initialized || voices.length === 0,
      },
    ];
  }
}
