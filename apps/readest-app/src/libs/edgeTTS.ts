import { md5 } from 'js-md5';
import { randomMd5 } from '@/utils/misc';
import { LRUCache } from '@/utils/lru';

const EDGE_SPEECH_URL =
  'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const EDGE_API_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_TTS_VOICES = {
  'ar-SA': ['ar-SA-HamedNeural', 'ar-SA-ZariyahNeural'],
  'de-DE': ['de-DE-AmalaNeural', 'de-DE-ConradNeural', 'de-DE-KatjaNeural', 'de-DE-KillianNeural'],
  'en-US': [
    'en-US-AriaNeural',
    'en-US-AnaNeural',
    'en-US-ChristopherNeural',
    'en-US-EricNeural',
    'en-US-GuyNeural',
    'en-US-JennyNeural',
    'en-US-MichelleNeural',
    'en-US-RogerNeural',
    'en-US-SteffanNeural',
  ],
  'es-ES': ['es-ES-AlvaroNeural', 'es-ES-ElviraNeural'],
  'fr-FR': ['fr-FR-DeniseNeural', 'fr-FR-EloiseNeural', 'fr-FR-HenriNeural'],
  'ja-JP': ['ja-JP-KeitaNeural', 'ja-JP-NanamiNeural'],
  'ko-KR': ['ko-KR-InJoonNeural', 'ko-KR-SunHiNeural'],
  'pt-BR': ['pt-BR-AntonioNeural', 'pt-BR-FranciscaNeural'],
  'ru-RU': ['ru-RU-DmitryNeural', 'ru-RU-SvetlanaNeural'],
  'zh-CN': [
    'zh-CN-XiaoxiaoNeural',
    'zh-CN-XiaoyiNeural',
    'zh-CN-YunjianNeural',
    'zh-CN-liaoning-XiaobeiNeural',
    'zh-CN-shaanxi-XiaoniNeural',
    'zh-CN-YunxiNeural',
    'zh-CN-YunxiaNeural',
    'zh-CN-YunyangNeural',
  ],
  'zh-TW': ['zh-TW-HsiaoChenNeural', 'zh-TW-YunJheNeural', 'zh-TW-HsiaoYuNeural'],
};

const genVoiceList = (voices: Record<string, string[]>) => {
  return Object.entries(voices).flatMap(([lang, voices]) => {
    return voices.map((id) => {
      const name = id.replace(`${lang}-`, '').replace('Neural', '');
      return { name, id, lang };
    });
  });
};

export interface EdgeTTSPayload {
  lang: string;
  text: string;
  voice: string;
  rate: number;
  pitch: number;
}

const hashPayload = (payload: EdgeTTSPayload): string => {
  const base = JSON.stringify(payload);
  return md5(base);
};

export class EdgeSpeechTTS {
  static voices = genVoiceList(EDGE_TTS_VOICES);
  private static audioCache = new LRUCache<string, AudioBuffer>(200);

  constructor() {}

  async #fetchEdgeSpeechWs({ lang, text, voice, rate }: EdgeTTSPayload): Promise<Response> {
    const connectId = randomMd5();
    const url = `${EDGE_SPEECH_URL}?ConnectionId=${connectId}&TrustedClientToken=${EDGE_API_TOKEN}`;
    const date = new Date().toString();
    const configHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      Path: 'speech.config',
      'X-Timestamp': date,
    };
    const contentHeaders = {
      'Content-Type': 'application/ssml+xml',
      Path: 'ssml',
      'X-RequestId': connectId,
      'X-Timestamp': date,
    };
    const configContent = JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          },
        },
      },
    });

    const genSSML = (lang: string, text: string, voice: string, rate: number) => {
      return `
        <speak version="1.0" xml:lang="${lang}">
          <voice name="${voice}">
            <prosody rate="${rate}">
              ${text}
            </prosody>
          </voice>
        </speak>
      `;
    };

    const genSendContent = (headerObj: Record<string, string>, content: string) => {
      let header = '';
      for (const key of Object.keys(headerObj)) {
        header += `${key}: ${headerObj[key]}\r\n`;
      }
      return `${header}\r\n${content}`;
    };

    const getHeadersAndData = (message: string) => {
      const lines = message.split('\n');
      const headers: Record<string, string> = {};
      let body = '';
      let lineIdx = 0;

      for (lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx]!.trim();
        if (!line) break;
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) continue;
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        headers[key] = value;
      }

      for (lineIdx = lineIdx + 1; lineIdx < lines.length; lineIdx++) {
        body += lines[lineIdx] + '\n';
      }

      return { headers, body };
    };

    const ssml = genSSML(lang, text, voice, rate);
    const content = genSendContent(contentHeaders, ssml);
    const config = genSendContent(configHeaders, configContent);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      let audioData = new ArrayBuffer(0);

      ws.addEventListener('open', () => {
        ws.send(config);
        ws.send(content);
      });

      ws.addEventListener('message', (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          const { headers } = getHeadersAndData(event.data);
          if (headers['Path'] === 'turn.end') {
            ws.close();
            if (!audioData.byteLength) {
              return reject(new Error('No audio data received.'));
            }
            const res = new Response(audioData);
            resolve(res);
          }
        } else if (event.data instanceof ArrayBuffer) {
          const dataView = new DataView(event.data);
          const headerLength = dataView.getInt16(0);
          if (event.data.byteLength > headerLength + 2) {
            const newBody = event.data.slice(2 + headerLength);
            const merged = new Uint8Array(audioData.byteLength + newBody.byteLength);
            merged.set(new Uint8Array(audioData), 0);
            merged.set(new Uint8Array(newBody), audioData.byteLength);
            audioData = merged.buffer;
          }
        }
      });

      ws.addEventListener('error', () => {
        ws.close();
        reject(new Error('WebSocket error occurred.'));
      });
    });
  }

  async create(payload: EdgeTTSPayload): Promise<Response> {
    return this.#fetchEdgeSpeechWs(payload);
  }

  async createAudio(payload: EdgeTTSPayload): Promise<AudioBuffer> {
    const cacheKey = hashPayload(payload);
    if (EdgeSpeechTTS.audioCache.has(cacheKey)) {
      return EdgeSpeechTTS.audioCache.get(cacheKey)!;
    }
    try {
      const res = await this.create(payload);
      const arrayBuffer = await res.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      EdgeSpeechTTS.audioCache.set(cacheKey, audioBuffer);
      return audioBuffer;
    } catch (error) {
      throw error;
    }
  }
}
