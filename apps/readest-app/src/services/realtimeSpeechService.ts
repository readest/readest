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

const WS_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';
const SAMPLE_RATE = 24000;
const MIN_AUDIO_SAMPLES = 100;

export class RealtimeSpeechService {
  private ws: WebSocket | TauriWebSocket | null = null;
  private isTauri = isTauriAppPlatform();
  private audioContext: AudioContext | null = null;
  private playbackAudioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioQueue: Uint8Array[] = [];
  private isPlayingAudio = false;
  private isRecording = false;
  private isConnected = false;
  private hasSentValidAudio = false;
  private sessionReady = false;
  private apiKey: string;
  private callbacks: RealtimeSpeechCallbacks;
  private currentAssistantTranscript = '';
  private tauriUnlisten: (() => void) | null = null;

  constructor(apiKey: string, callbacks: RealtimeSpeechCallbacks) {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  private createSessionConfig(systemPrompt: string) {
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        instructions: systemPrompt,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            turn_detection: { type: 'semantic_vad' },
          },
          output: {
            format: { type: 'audio/pcm', rate: SAMPLE_RATE },
            voice: 'marin',
          },
        },
      },
    };
  }

  async connect(systemPrompt: string): Promise<void> {
    if (this.isConnected || this.ws) {
      await this.disconnect();
    }
    return this.isTauri ? this.connectTauri(systemPrompt) : this.connectBrowser(systemPrompt);
  }

  private async connectTauri(systemPrompt: string): Promise<void> {
    try {
      this.ws = (await TauriWebSocketClass.connect(WS_URL, {
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
        this.ws = new WebSocket(WS_URL);

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
      case 'response.audio.delta':
        if (data.delta) {
          this.handleAudioChunk(data.delta);
        }
        break;

      case 'error':
        const errorMessage = data.error?.message || 'Unknown error occurred';
        console.error('Realtime API error:', errorMessage);
        this.callbacks.onError?.(errorMessage);
        break;
    }
  }

  private handleAudioChunk(base64Audio: string): void {
    try {
      const binaryString = atob(base64Audio);
      const audioData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }
      this.audioQueue.push(audioData);
      this.playAudioQueue();
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

  private async playAudioQueue(scheduledStartTime?: number): Promise<void> {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }

    if (this.isPlayingAudio && scheduledStartTime === undefined) {
      return;
    }

    try {
      const playbackContext = await this.getPlaybackAudioContext();
      const audioData = this.audioQueue.shift();
      if (!audioData) {
        this.isPlayingAudio = false;
        return;
      }

      const length = audioData.length / 2;
      if (length === 0) {
        this.playAudioQueue(scheduledStartTime);
        return;
      }

      const audioBuffer = playbackContext.createBuffer(1, length, SAMPLE_RATE);
      const channelData = audioBuffer.getChannelData(0);
      const dataView = new DataView(audioData.buffer);

      for (let i = 0; i < length; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }

      const duration = length / SAMPLE_RATE;
      const currentTime = playbackContext.currentTime;
      const startTime =
        scheduledStartTime !== undefined && scheduledStartTime > currentTime
          ? scheduledStartTime
          : currentTime;

      const source = playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(playbackContext.destination);
      this.isPlayingAudio = true;
      source.start(startTime);

      if (this.audioQueue.length > 0) {
        this.playAudioQueue(startTime + duration);
      } else {
        source.onended = () => {
          this.isPlayingAudio = false;
        };
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      this.isPlayingAudio = false;
      if (this.audioQueue.length > 0) {
        this.playAudioQueue();
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

    // Check for non-silent audio
    let hasAudio = false;
    for (let i = 0; i < audioData.length; i++) {
      if (Math.abs(audioData[i]!) > 0.0001) {
        hasAudio = true;
        break;
      }
    }
    if (!hasAudio) return;

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

    this.isConnected = false;
    this.isRecording = false;
    this.isPlayingAudio = false;
    this.hasSentValidAudio = false;
    this.sessionReady = false;
    this.audioQueue = [];
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
