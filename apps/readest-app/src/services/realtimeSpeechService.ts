import { isTauriAppPlatform } from './environment';
import TauriWebSocketClass from '@tauri-apps/plugin-websocket';

export interface RealtimeSpeechCallbacks {
  onTranscript?: (text: string, role: 'user' | 'assistant') => void;
  onError?: (error: string) => void;
  onConnectionStateChange?: (connected: boolean) => void;
  onRecordingStateChange?: (recording: boolean) => void;
}

interface TauriWebSocket {
  addListener: (cb: (message: { type: string; data: string }) => void) => () => void;
  send: (message: string | { type: string; data: any }) => Promise<void>;
  disconnect: () => Promise<void>;
}

const SAMPLE_RATE = 24000;
const MIN_AUDIO_SAMPLES = 100;
const BASE_INPUT_THRESHOLD = 0.005;
const PLAYBACK_INPUT_THRESHOLD = 0.03;
const ENERGY_SMOOTHING_ALPHA = 0.25;

export class RealtimeSpeechService {
  private ws: WebSocket | TauriWebSocket | null = null;
  private isTauri = isTauriAppPlatform();
  private audioContext: AudioContext | null = null;
  private playbackAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioQueue: { data: Uint8Array; responseId: string | null }[] = [];
  private isPlayingAudio = false;
  private isRecording = false;
  private isConnected = false;
  private hasSentValidAudio = false;
  private sessionReady = false;
  private apiKey: string;
  private modelSlug: string;
  private voice: string;
  private callbacks: RealtimeSpeechCallbacks;
  private currentAssistantTranscript = '';
  private tauriUnlisten: (() => void) | null = null;
  private smoothedInputEnergy = 0;
  private currentResponseId: string | null = null;
  private cancelledResponseIds = new Map<string, number>();
  private playbackCursor = 0;
  private isSchedulingPlayback = false;
  private activePlaybackSources = new Set<AudioBufferSourceNode>();

  constructor(
    apiKey: string,
    callbacks: RealtimeSpeechCallbacks,
    modelSlug: string = 'gpt-realtime',
    voice: string = 'marin',
  ) {
    this.apiKey = apiKey;
    this.modelSlug = modelSlug;
    this.voice = voice.toLowerCase();
    this.callbacks = callbacks;
  }

  private getWsUrl(): string {
    return `wss://api.openai.com/v1/realtime?model=${this.modelSlug}`;
  }

  private createSessionConfig(systemPrompt: string) {
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        model: this.modelSlug,
        instructions: systemPrompt,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            turn_detection: { type: 'semantic_vad' },
          },
          output: {
            format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            voice: this.voice,
          },
        },
      },
    };
  }

  async connect(systemPrompt: string): Promise<void> {
    // s
    if (this.isConnected || this.ws) {
      await this.disconnect();
    }
    return this.isTauri ? this.connectTauri(systemPrompt) : this.connectBrowser(systemPrompt);
  }

  private async connectTauri(systemPrompt: string): Promise<void> {
    try {
      this.ws = (await TauriWebSocketClass.connect(this.getWsUrl(), {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })) as TauriWebSocket;

      this.tauriUnlisten = this.ws.addListener((message) => {
        if (message.type === 'Text') {
          try {
            this.handleMessage(JSON.parse(message.data));
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        } else if (message.type === 'Close') {
          this.isConnected = false;
          this.callbacks.onConnectionStateChange?.(false);
          this.cleanup();
        }
      });

      this.isConnected = true;
      this.sessionReady = false;
      this.callbacks.onConnectionStateChange?.(true);
      await this.send(this.createSessionConfig(systemPrompt));
    } catch (error) {
      console.error('Tauri WebSocket connection error:', error);
      this.callbacks.onError?.('WebSocket connection error');
      throw error;
    }
  }

  private connectBrowser(systemPrompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.getWsUrl());

        this.ws.onopen = () => {
          this.send(this.createSessionConfig(systemPrompt));
          this.isConnected = true;
          this.sessionReady = false;
          this.callbacks.onConnectionStateChange?.(true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            this.handleMessage(JSON.parse(event.data));
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.callbacks.onError?.('WebSocket connection error');
          reject(error);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.callbacks.onConnectionStateChange?.(false);
          this.cleanup();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(data: any): void {
    console.debug('RealtimeSpeechService handleMessage', data);
    switch (data.type) {
      case 'session.updated':
        this.sessionReady = true;
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (data.transcript) {
          this.callbacks.onTranscript?.(data.transcript, 'user');
        }
        break;

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        if (data.delta) {
          this.currentAssistantTranscript += data.delta;
        }
        break;

      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        if (this.currentAssistantTranscript) {
          this.callbacks.onTranscript?.(this.currentAssistantTranscript, 'assistant');
          this.currentAssistantTranscript = '';
        }
        break;

      case 'response.output_audio.delta':
        if (data.delta) {
          this.handleAudioChunk(data.delta, data.response_id || data.response?.id);
        }
        break;

      case 'error':
        const errorMessage = data.error?.message || 'Unknown error occurred';
        console.error('Realtime API error:', errorMessage);
        this.callbacks.onError?.(errorMessage);
        break;
    }
  }

  private handleAudioChunk(base64Audio: string, responseId?: string): void {
    try {
      if (responseId) {
        const cancelledAt = this.cancelledResponseIds.get(responseId);
        if (cancelledAt) {
          return;
        }
        this.currentResponseId = responseId;
      }

      const binaryString = atob(base64Audio);
      const audioData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }
      this.audioQueue.push({ data: audioData, responseId: responseId ?? null });
      this.schedulePlayback().catch((error) =>
        console.error('Error scheduling audio playback:', error),
      );
    } catch (error) {
      console.error('Error handling audio chunk:', error);
    }
  }

  private async getPlaybackAudioContext(): Promise<AudioContext> {
    if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
      this.playbackAudioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    }
    if (this.playbackAudioContext.state === 'suspended') {
      await this.playbackAudioContext.resume();
    }
    return this.playbackAudioContext;
  }

  private async schedulePlayback(): Promise<void> {
    if (this.isSchedulingPlayback) return;
    if (this.audioQueue.length === 0) return;

    this.isSchedulingPlayback = true;
    try {
      const playbackContext = await this.getPlaybackAudioContext();
      if (this.playbackCursor < playbackContext.currentTime) {
        this.playbackCursor = playbackContext.currentTime;
      }

      while (this.audioQueue.length > 0) {
        const chunk = this.audioQueue.shift();
        if (!chunk) continue;
        if (chunk.responseId) {
          const cancelledAt = this.cancelledResponseIds.get(chunk.responseId);
          if (cancelledAt) {
            continue;
          }
        }
        const audioData = chunk.data;
        if (!audioData || audioData.length === 0) continue;
        if (chunk.responseId) {
          this.currentResponseId = chunk.responseId;
        }

        const length = audioData.length / 2;
        if (length === 0) continue;

        const audioBuffer = playbackContext.createBuffer(1, length, SAMPLE_RATE);
        const channelData = audioBuffer.getChannelData(0);
        const dataView = new DataView(audioData.buffer);
        for (let i = 0; i < length; i++) {
          channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
        }

        const duration = length / SAMPLE_RATE;
        const startTime = this.playbackCursor;

        const source = playbackContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(playbackContext.destination);

        this.isPlayingAudio = true;
        this.activePlaybackSources.add(source);

        source.start(startTime);
        const scheduledEndTime = startTime + duration;
        source.onended = () => {
          this.activePlaybackSources.delete(source);
          if (this.activePlaybackSources.size === 0) {
            this.isPlayingAudio = false;
            this.playbackCursor = playbackContext.currentTime;
          }
        };

        this.playbackCursor = scheduledEndTime;
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      this.isPlayingAudio = false;
      this.playbackCursor = this.playbackAudioContext?.currentTime ?? 0;
      this.activePlaybackSources.clear();
      if (this.audioQueue.length > 0) {
        setTimeout(() => {
          this.schedulePlayback().catch((err) => console.error('Error retrying playback:', err));
        }, 0);
      }
    } finally {
      this.isSchedulingPlayback = false;
      if (this.audioQueue.length > 0 && !this.isSchedulingPlayback) {
        this.schedulePlayback().catch((err) =>
          console.error('Error scheduling remaining audio:', err),
        );
      }
    }
  }

  async startRecording(): Promise<void> {
    if (this.isRecording) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      const errorMessage = 'Microphone access is not available. This feature requires HTTPS.';
      this.callbacks.onError?.(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
      const currentProcessor = this.audioProcessor;

      this.audioProcessor.onaudioprocess = (event) => {
        if (this.audioProcessor !== currentProcessor) return;
        if (this.isRecording && this.isConnected && this.ws) {
          this.processAudioData(event.inputBuffer.getChannelData(0));
        }
      };

      this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioSource.connect(this.audioProcessor);

      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      this.audioProcessor.connect(silentGain);
      silentGain.connect(this.audioContext.destination);

      this.hasSentValidAudio = false;
      this.isRecording = true;
      this.callbacks.onRecordingStateChange?.(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
          this.callbacks.onError?.('Microphone permission denied. Please allow microphone access.');
        } else {
          this.callbacks.onError?.(error.message);
        }
      } else {
        this.callbacks.onError?.('Failed to start recording');
      }
      throw error;
    }
  }

  private processAudioData(audioData: Float32Array): void {
    if (!this.isRecording || !this.ws || !this.isConnected || !this.sessionReady) return;
    if (!audioData || audioData.length < MIN_AUDIO_SAMPLES) return;

    // Compute chunk energy (average absolute amplitude over ~170ms)
    let sumAbs = 0;
    for (let i = 0; i < audioData.length; i++) {
      sumAbs += Math.abs(audioData[i]!);
    }
    const chunkEnergy = sumAbs / audioData.length;

    // Smooth energy to avoid reacting to isolated spikes
    this.smoothedInputEnergy =
      ENERGY_SMOOTHING_ALPHA * chunkEnergy +
      (1 - ENERGY_SMOOTHING_ALPHA) * this.smoothedInputEnergy;
    const effectiveEnergy = Math.max(chunkEnergy, this.smoothedInputEnergy);

    const minEnergy = this.isPlayingAudio ? PLAYBACK_INPUT_THRESHOLD : BASE_INPUT_THRESHOLD;
    if (effectiveEnergy <= minEnergy) return;

    if (this.isPlayingAudio) {
      this.interruptPlayback();
    }

    // Convert Float32 to PCM16
    const pcm16 = new Int16Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i]!));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    // Convert to base64
    const uint8Array = new Uint8Array(pcm16.buffer);
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]!);
    }
    const base64Audio = btoa(binaryString);

    if (base64Audio.length < 100) return;

    this.hasSentValidAudio = true;
    this.send({ type: 'input_audio_buffer.append', audio: base64Audio }).catch((error) => {
      console.error('Error sending audio data:', error);
    });
  }

  stopRecording(): void {
    if (!this.isRecording) return;

    this.isRecording = false;
    this.callbacks.onRecordingStateChange?.(false);

    if (this.audioSource) {
      try {
        this.audioSource.disconnect();
      } catch {}
      this.audioSource = null;
    }

    if (this.audioProcessor) {
      try {
        this.audioProcessor.onaudioprocess = null;
        this.audioProcessor.disconnect();
      } catch {}
      this.audioProcessor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => {
        track.stop();
        track.enabled = false;
      });
      this.mediaStream = null;
    }

    setTimeout(() => {
      const canSendCommit =
        this.ws &&
        this.isConnected &&
        this.hasSentValidAudio &&
        (this.isTauri || (this.ws as WebSocket).readyState === WebSocket.OPEN);

      if (canSendCommit) {
        this.send({ type: 'input_audio_buffer.commit' }).catch((error) => {
          console.error('Error sending commit:', error);
        });
      }
    }, 50);

    this.hasSentValidAudio = false;
  }

  async disconnect(): Promise<void> {
    this.stopRecording();
    await this.cleanup();
  }

  private interruptPlayback(addCurrentToCancelled = true): void {
    if (addCurrentToCancelled && this.currentResponseId) {
      this.cancelledResponseIds.set(this.currentResponseId, Date.now());
    }
    this.audioQueue = [];
    this.isPlayingAudio = false;
    this.currentResponseId = null;
    this.isSchedulingPlayback = false;
    this.playbackCursor = this.playbackAudioContext?.currentTime ?? 0;
    this.activePlaybackSources.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
      } catch {}
    });
    this.activePlaybackSources.clear();
  }

  private async cleanup(): Promise<void> {
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    if (this.ws) {
      try {
        if (this.isTauri) {
          await (this.ws as TauriWebSocket).disconnect();
        } else {
          const browserWs = this.ws as WebSocket;
          if (
            browserWs.readyState === WebSocket.OPEN ||
            browserWs.readyState === WebSocket.CONNECTING
          ) {
            browserWs.close();
          }
        }
      } catch {}
      this.ws = null;
    }

    if (this.tauriUnlisten) {
      this.tauriUnlisten();
      this.tauriUnlisten = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    if (this.playbackAudioContext) {
      this.playbackAudioContext.close().catch(() => {});
      this.playbackAudioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.interruptPlayback();
    this.smoothedInputEnergy = 0;
    this.isConnected = false;
    this.isRecording = false;
    this.hasSentValidAudio = false;
    this.sessionReady = false;
    this.currentAssistantTranscript = '';
  }

  private async send(data: { type: string; audio?: string }): Promise<void> {
    if (!this.ws) return;
    // Validate audio data before sending
    if (data.type === 'input_audio_buffer.append') {
      if (!this.sessionReady || !data.audio || data.audio.length < 100) return;
    }

    // Validate commit - don't commit empty buffer
    if (data.type === 'input_audio_buffer.commit' && !this.hasSentValidAudio) return;

    const messageStr = JSON.stringify(data);

    if (this.isTauri) {
      await (this.ws as TauriWebSocket).send(messageStr);
    } else {
      const browserWs = this.ws as WebSocket;
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(messageStr);
      }
    }
  }

  getIsRecording(): boolean {
    return this.isRecording;
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }
}
