import { describe, expect, it } from 'vitest';

// Enter the BufferedTTSClient <-> constants import cycle where the app does.
import '@/services/environment';
import { BufferedTTSClient } from '@/services/tts/BufferedTTSClient';
import { TTSUtils } from '@/services/tts/TTSUtils';
import type { SpeechProvider } from '@/services/tts/providers/types';

const provider: SpeechProvider = {
  id: 'locked-test',
  label: 'Locked',
  init: async () => true,
  getAllVoices: async () => [
    { id: 'pro-1', name: 'Pro', lang: 'en-US', tier: 'pro', disabled: true },
    { id: 'plus-1', name: 'Plus', lang: 'en-US', tier: 'plus' },
  ],
  synthesize: async () => ({ audio: new ArrayBuffer(0), boundaries: [] }),
};

describe('BufferedTTSClient with voices the plan lacks', () => {
  it('never picks a locked voice, even a remembered one', async () => {
    const client = new BufferedTTSClient(provider);
    await client.init();
    expect(await client.getVoiceIdFromLang('en')).toBe('plus-1');
    // Remembered before a downgrade.
    TTSUtils.setPreferredVoice('locked-test', 'en', 'pro-1');
    expect(await client.getVoiceIdFromLang('en')).toBe('plus-1');
  });

  it('lists voices in the order the provider gives, when it has one', async () => {
    const client = new BufferedTTSClient({
      ...provider,
      compareVoices: (a, b) => b.name.localeCompare(a.name),
    });
    await client.init();
    expect((await client.getVoices('en'))[0]!.voices.map((v) => v.id)).toEqual(['pro-1', 'plus-1']);
  });
});
