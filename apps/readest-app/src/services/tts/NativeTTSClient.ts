import { invoke } from '@tauri-apps/api/core';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { getUserLocale } from '@/utils/misc';
import { parseSSMLMarks } from '@/utils/ssml';
import { stubTranslation as _ } from '@/utils/misc';
import { TTSClient, TTSMessageEvent } from './TTSClient';
import { TTSGranularity, TTSMark, TTSVoice, TTSVoicesGroup } from './types';
import { TTSUtils } from './TTSUtils';
import { TTSController } from './TTSController';

type TTSEventPayload = {
  utteranceId: string;
} & TTSMessageEvent;

const TTSEngines = {
  default: 'System TTS',
  msctts: 'Msc TTS',
  mstrans: 'MSTrans TTS',
  microsoft: 'Microsoft TTS',
  bytedance: 'ByteDance TTS',
  peiyinya: 'PeiYinYa TTS',
  huoshan: 'HuoShan TTS',
  sougou: 'Sougou TTS',
  xiaomi: 'XiaoMi TTS',
  bdetts: 'BDeTTS',
  bdotts: 'BDoTTS',
  vcstts: 'VcsTTS',
  isstts: 'IssTTS',
  xfpeiyin: 'XFPeiYin',
  azure: 'Azure TTS',
  edgetts: 'Edge TTS',
  google: 'Google TTS',
  gemini: 'Gemini TTS',
  weread: 'WeRead TTS',
  aispeech: 'Aispeech',
} as Record<string, string>;

export class NativeTTSClient implements TTSClient {
  name = 'native-tts';
  initialized = false;
  controller?: TTSController;

  #voices: TTSVoice[] = [];
  #primaryLang = 'en';
  #speakingLang = '';
  #currentVoiceId = '';
  #rate = 1.0;
  #pitch = 1.0;

  #eventListener: PluginListener | null = null;
  #activeUtterances = new Map<
    string,
    {
      eventQueue: TTSMessageEvent[];
      resolver: ((value: IteratorResult<TTSMessageEvent>) => void) | null;
      finished: boolean;
    }
  >();

  constructor(controller?: TTSController) {
    this.controller = controller;
  }

  private async setupEventListener(): Promise<void> {
    try {
      if (this.#eventListener) return;
      this.#eventListener = await addPluginListener<TTSEventPayload>(
        'native-tts',
        'tts_events',
        (event) => {
          const { utteranceId, code, message, mark } = event;

          const utteranceData = this.#activeUtterances.get(utteranceId);
          if (!utteranceData) return;

          const ttsEvent: TTSMessageEvent = { code, message, mark };
          utteranceData.eventQueue.push(ttsEvent);
          if (code === 'end' || code === 'error') {
            utteranceData.finished = true;
            if (utteranceData.resolver) {
              utteranceData.resolver({ value: undefined, done: true });
            }
          } else if (utteranceData.resolver) {
            utteranceData.resolver({ value: ttsEvent, done: false });
            utteranceData.resolver = null;
          }
        },
      );
    } catch (error) {
      console.error('Failed to setup TTS event listener:', error);
    }
  }

  async init(): Promise<boolean> {
    const result = await invoke<{ success: boolean }>('plugin:native-tts|init');
    this.initialized = result.success;
    if (this.initialized) {
      this.setupEventListener();
    }
    return this.initialized;
  }

  async *speakMark(mark: TTSMark, preload: boolean, signal: AbortSignal) {
    if (preload) {
      yield { code: 'end', message: 'Dummy preload finished' } as TTSMessageEvent;
      return;
    }
    const { language: voiceLang } = mark;
    const voiceId = await this.getVoiceIdFromLang(voiceLang);
    this.#currentVoiceId = voiceId;
    this.#speakingLang = voiceLang;
    await this.setVoice(voiceId);
    try {
      const result = await invoke<{ utteranceId: string }>('plugin:native-tts|speak', {
        payload: { text: mark.text, preload },
      });

      const utteranceId = result.utteranceId;
      this.#activeUtterances.set(utteranceId, {
        eventQueue: [],
        resolver: null,
        finished: false,
      });

      const abortHandler = () => {
        const utteranceData = this.#activeUtterances.get(utteranceId);
        if (utteranceData && utteranceData.resolver) {
          const error = { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          utteranceData.resolver({ value: error, done: true });
          utteranceData.resolver = null;
        }
        this.stop();
      };

      signal.addEventListener('abort', abortHandler);

      try {
        while (true) {
          const utteranceData = this.#activeUtterances.get(utteranceId);
          if (!utteranceData) break;

          if (utteranceData.eventQueue.length > 0) {
            const event = utteranceData.eventQueue.shift()!;
            event.mark = mark.name;
            yield event;

            if (event.code === 'end' || event.code === 'error') {
              break;
            }
          } else if (utteranceData.finished) {
            break;
          } else {
            const eventPromise = new Promise<TTSMessageEvent | void>((resolve) => {
              const utteranceData = this.#activeUtterances.get(utteranceId);
              if (!utteranceData) return resolve();
              utteranceData.resolver = (res) =>
                resolve(res.value?.code === 'error' ? res.value : undefined);
            });
            const timeoutPromise = new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 100),
            );
            const result = await Promise.race([eventPromise, timeoutPromise]);
            if (result) yield result;
          }

          if (signal.aborted) {
            break;
          }
        }
      } finally {
        signal.removeEventListener('abort', abortHandler);
        this.#activeUtterances.delete(utteranceId);
      }
    } catch (error) {
      console.error('Failed to speak:', error);
      throw error;
    }
  }

  async *speak(ssml: string, signal: AbortSignal, preload: boolean = false) {
    const { marks } = parseSSMLMarks(ssml, this.#primaryLang);

    for (const mark of marks) {
      this.controller?.dispatchSpeakMark(mark);
      for await (const ev of this.speakMark(mark, preload, signal)) {
        if (signal.aborted) {
          yield { code: 'error', message: 'Aborted' } as TTSMessageEvent;
          return;
        }
        yield ev;
      }
    }
  }

  async getVoiceIdFromLang(lang: string) {
    const preferredVoiceId = TTSUtils.getPreferredVoice(this.name, lang);
    const preferredVoice = this.#voices.find((v) => v.id === preferredVoiceId);
    const defaultVoice = preferredVoice
      ? preferredVoice
      : (await this.getVoices(lang))[0]?.voices[0] || null;
    return defaultVoice?.id || '';
  }

  async pause() {
    await invoke('plugin:native-tts|pause');
    return false;
  }

  async resume() {
    // No-op for Android TextToSpeech
    await invoke('plugin:native-tts|resume');
    return false;
  }

  async stop() {
    await invoke('plugin:native-tts|stop');
    this.#activeUtterances.clear();
  }

  async setRate(rate: number) {
    // Power the rate to match the EdgeTTS behavior
    this.#rate = parseFloat(Math.pow(rate, 2.5).toFixed(2));
    await invoke('plugin:native-tts|set_rate', { payload: { rate: this.#rate } });
  }

  async setPitch(pitch: number) {
    this.#pitch = pitch;
    await invoke('plugin:native-tts|set_pitch', { payload: { pitch: this.#pitch } });
  }

  async setVoice(voice: string) {
    this.#currentVoiceId = voice;
    await invoke('plugin:native-tts|set_voice', { payload: { voice } });
  }

  async getAllVoices() {
    if (this.#voices.length > 0) {
      return this.#voices;
    }
    try {
      const result = await invoke<{ voices: TTSVoice[] }>('plugin:native-tts|get_all_voices');
      this.#voices = result.voices;
      return this.#voices;
    } catch (error) {
      console.error('Failed to get all voices:', error);
      return [];
    }
  }

  async getVoices(lang: string) {
    const locale = lang === 'en' ? getUserLocale(lang) || lang : lang;
    const voices = await this.getAllVoices();
    const filteredVoices = voices.filter(
      (v) => v.lang.startsWith(locale) || (lang === 'en' && ['en-US', 'en-GB'].includes(v.lang)),
    );
    const voiceGroups = new Map<string, TTSVoice[]>();
    filteredVoices.forEach((voice) => {
      const { name, lang } = voice;
      let groupId = voice.id.split('_')[0]!;
      if (groupId in TTSEngines) {
        voice.name = name
          .replace(`${groupId}_`, '')
          .replace(`${lang}-`, '')
          .replace('Neural', '')
          .trim();
      } else {
        groupId = 'default';
      }
      voice.name = voice.name.replace('NOT_SET', _('Default'));
      if (!voiceGroups.has(groupId)) {
        voiceGroups.set(groupId, []);
      }
      voiceGroups.get(groupId)!.push(voice);
    });

    return Array.from(voiceGroups.entries())
      .map(
        ([groupId, voices]) =>
          ({
            id: groupId,
            name: TTSEngines[groupId] || groupId,
            voices: voices.sort(TTSUtils.sortVoicesFunc),
            disabled: !this.initialized || voices.length === 0,
          }) as TTSVoicesGroup,
      )
      .sort((a, b) => {
        if (a.id === 'default') return -1;
        if (b.id === 'default') return 1;
        return a.id.localeCompare(b.id);
      });
  }

  setPrimaryLang(lang: string) {
    this.#primaryLang = lang;
  }

  getGranularities(): TTSGranularity[] {
    return ['sentence'];
  }

  getVoiceId() {
    return this.#currentVoiceId;
  }

  getSpeakingLang() {
    return this.#speakingLang;
  }

  async shutdown() {
    if (this.#eventListener) {
      this.#eventListener.unregister();
      this.#eventListener = null;
    }
    await this.stop();
  }
}
