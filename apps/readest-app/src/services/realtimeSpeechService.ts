import { isTauriAppPlatform } from './environment';
import TauriWebSocketClass from '@tauri-apps/plugin-websocket';

export interface RealtimeSpeechCallbacks {
  onTranscript?: (text: string, role: 'user' | 'assistant') => void;
  onError?: (error: string) => void;
  onConnectionStateChange?: (connected: boolean) => void;
  onRecordingStateChange?: (recording: boolean) => void;
}

// Tauri WebSocket type (simplified interface)
interface TauriWebSocket {
  addListener: (cb: (message: { type: string; data: string }) => void) => () => void;
  send: (message: string | { type: string; data: any }) => Promise<void>;
  disconnect: () => Promise<void>;
}

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
  private sessionReady = false; // Track if session.updated has been received
  private apiKey: string;
  private callbacks: RealtimeSpeechCallbacks;
  private sessionId: string | null = null;
  private conversationItemId: string | null = null;
  private currentAssistantTranscript = '';
  private tauriUnlisten: (() => void) | null = null;

  constructor(apiKey: string, callbacks: RealtimeSpeechCallbacks) {
    console.error('[RealtimeSpeech] *** CONSTRUCTOR CALLED ***');
    console.log('rts!');
    this.apiKey = apiKey;
    this.callbacks = callbacks;
  }

  async connect(systemPrompt: string): Promise<void> {
    console.error('[RealtimeSpeech] *** CONNECT CALLED *** isTauri:', this.isTauri);
    // Disconnect any existing session first to ensure only one session at a time
    if (this.isConnected || this.ws) {
      console.error('[RealtimeSpeech] Disconnecting existing session before creating new one');
      await this.disconnect();
    }

    if (this.isTauri) {
      console.error('[RealtimeSpeech] Using Tauri WebSocket');
      return this.connectTauri(systemPrompt);
    } else {
      console.error('[RealtimeSpeech] Using Browser WebSocket');
      return this.connectBrowser(systemPrompt);
    }
  }

  private async connectTauri(systemPrompt: string): Promise<void> {
    console.error('[RealtimeSpeech] *** connectTauri START ***');
    try {
      const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-realtime`;
      console.error('[RealtimeSpeech] Connecting to:', wsUrl);

      // Use proper Authorization header with Bearer token
      this.ws = (await TauriWebSocketClass.connect(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      })) as TauriWebSocket;
      console.error('[RealtimeSpeech] *** WebSocket connected successfully ***');

      // Set up message listener
      console.error('[RealtimeSpeech] *** Setting up Tauri message listener ***');
      this.tauriUnlisten = this.ws.addListener((message) => {
        console.error(
          '[RealtimeSpeech] *** RAW MESSAGE RECEIVED *** type:',
          message.type,
          'data preview:',
          String(message.data).substring(0, 200),
        );
        if (message.type === 'Text') {
          try {
            const data = JSON.parse(message.data);
            console.error('[RealtimeSpeech] Received message:', data.type, data);
            this.handleMessage(data);
          } catch (error) {
            console.error('[RealtimeSpeech] Error parsing WebSocket message:', error);
          }
        } else if (message.type === 'Close') {
          console.error('[RealtimeSpeech] Connection closed');
          this.isConnected = false;
          this.callbacks.onConnectionStateChange?.(false);
          this.cleanup();
        } else {
          console.error('[RealtimeSpeech] Unknown message type:', message.type, message);
        }
      });

      this.isConnected = true;
      this.sessionReady = false; // Reset session readiness - wait for session.updated
      this.callbacks.onConnectionStateChange?.(true);

      // Send session configuration
      const sessionConfig = {
        type: 'session.update',
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
          instructions: systemPrompt,
          output_modalities: ['audio'],
          audio: {
            input: {
              format: {
                type: 'audio/pcm',
                rate: 24000,
              },
              turn_detection: {
                type: 'semantic_vad',
              },
            },
            output: {
              format: {
                type: 'audio/pcm',
                rate: 24000,
              },
              voice: 'marin',
            },
          },
        },
      };
      console.log('[RealtimeSpeech] Sending session config:', sessionConfig);
      await this.send(sessionConfig);
    } catch (error) {
      console.error('Tauri WebSocket connection error:', error);
      this.callbacks.onError?.('WebSocket connection error');
      throw error;
    }
  }

  private connectBrowser(systemPrompt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-realtime`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[RealtimeSpeech] WebSocket opened');
          // Send session configuration
          const sessionConfig = {
            type: 'session.update',
            session: {
              type: 'realtime',
              model: 'gpt-realtime',
              instructions: systemPrompt,
              output_modalities: ['audio'],
              audio: {
                input: {
                  format: {
                    type: 'audio/pcm',
                    rate: 24000,
                  },
                  turn_detection: {
                    type: 'semantic_vad',
                  },
                },
                output: {
                  format: {
                    type: 'audio/pcm',
                    rate: 24000,
                  },
                  voice: 'marin',
                },
              },
            },
          };
          console.log('[RealtimeSpeech] Sending session config:', sessionConfig);
          this.send(sessionConfig);
          this.isConnected = true;
          this.sessionReady = false; // Reset session readiness - wait for session.updated
          this.callbacks.onConnectionStateChange?.(true);
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[RealtimeSpeech] Received message:', data.type, data);
            this.handleMessage(data);
          } catch (error) {
            console.error('[RealtimeSpeech] Error parsing WebSocket message:', error);
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
      case 'session.created':
        this.sessionId = data.session.id;
        break;

      case 'session.updated':
        // Session is ready - allow audio to be sent
        this.sessionReady = true;
        console.log('[RealtimeSpeech] Session updated - ready to send audio');
        break;

      case 'conversation.item.created':
        if (data.item?.type === 'message') {
          this.conversationItemId = data.item.id;
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (data.transcript) {
          this.callbacks.onTranscript?.(data.transcript, 'user');
        }
        break;

      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': // Legacy support
        if (data.delta) {
          this.currentAssistantTranscript += data.delta;
          // We'll send the full transcript when the response completes
        }
        break;

      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': // Legacy support
        if (this.currentAssistantTranscript) {
          this.callbacks.onTranscript?.(this.currentAssistantTranscript, 'assistant');
          this.currentAssistantTranscript = '';
        }
        break;

      case 'response.output_audio.delta':
      case 'response.audio.delta': // Legacy support
        // Handle audio chunks for playback
        if (data.delta) {
          console.log('[RealtimeSpeech] Received audio delta, size:', data.delta.length);
          this.handleAudioChunk(data.delta);
        }
        break;

      case 'response.output_audio.done':
        console.log('[RealtimeSpeech] Audio output done');
        break;

      case 'response.done':
        // Response is complete
        break;

      case 'error':
        console.error('[RealtimeSpeech] *** ERROR RECEIVED FROM API ***');
        const errorMessage = data.error?.message || 'Unknown error occurred';
        const errorCode = data.error?.code || 'unknown';
        const errorType = data.error?.type || 'unknown';

        console.error('[RealtimeSpeech] API error:', {
          message: errorMessage,
          code: errorCode,
          type: errorType,
          fullError: data.error,
          sessionId: this.sessionId,
          conversationItemId: this.conversationItemId,
          isRecording: this.isRecording,
          isConnected: this.isConnected,
          hasSentValidAudio: this.hasSentValidAudio,
        });

        console.log('cipa');
        // Surface error to UI
        this.callbacks.onError?.(errorMessage);

        // If error is related to empty audio, provide more context
        if (errorMessage.includes('empty bytes') || errorMessage.includes("Invalid 'audio'")) {
          console.error('[RealtimeSpeech] Empty audio bytes error detected. State at error:', {
            isRecording: this.isRecording,
            isConnected: this.isConnected,
            hasSentValidAudio: this.hasSentValidAudio,
            hasWebSocket: !!this.ws,
          });
        }
        break;
    }
  }

  private handleAudioChunk(base64Audio: string): void {
    try {
      console.log('[RealtimeSpeech] Handling audio chunk, base64 length:', base64Audio.length);
      // Decode base64 audio (PCM16 format)
      const binaryString = atob(base64Audio);
      const audioData = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }
      console.log('[RealtimeSpeech] Decoded audio data, bytes:', audioData.length);
      this.audioQueue.push(audioData);
      this.playAudioQueue();
    } catch (error) {
      console.error('[RealtimeSpeech] Error handling audio chunk:', error);
    }
  }

  private async getPlaybackAudioContext(): Promise<AudioContext> {
    // Use a separate audio context for playback to avoid conflicts with recording
    if (!this.playbackAudioContext || this.playbackAudioContext.state === 'closed') {
      console.log('[RealtimeSpeech] Creating playback audio context');
      this.playbackAudioContext = new AudioContext({ sampleRate: 24000 });
    }

    if (this.playbackAudioContext.state === 'suspended') {
      console.log('[RealtimeSpeech] Resuming suspended playback audio context');
      await this.playbackAudioContext.resume();
    }

    return this.playbackAudioContext;
  }

  private async playAudioQueue(scheduledStartTime?: number): Promise<void> {
    // If queue is empty, return early
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }

    // If already playing and no scheduled time provided, return early
    // (chunk will be scheduled when current one is processed)
    if (this.isPlayingAudio && scheduledStartTime === undefined) {
      return;
    }

    try {
      const playbackContext = await this.getPlaybackAudioContext();

      // Process only the first chunk in the queue
      const audioData = this.audioQueue.shift();
      if (!audioData) {
        this.isPlayingAudio = false;
        return;
      }

      // Convert PCM16 to AudioBuffer
      const sampleRate = 24000; // OpenAI Realtime API uses 24kHz
      const numChannels = 1; // Mono
      const length = audioData.length / 2; // 16-bit = 2 bytes per sample

      if (length === 0) {
        console.warn('[RealtimeSpeech] Skipping empty audio chunk');
        // Try to play next chunk immediately
        this.playAudioQueue(scheduledStartTime);
        return;
      }

      const audioBuffer = playbackContext.createBuffer(numChannels, length, sampleRate);
      const channelData = audioBuffer.getChannelData(0);

      // Convert PCM16 to Float32
      const dataView = new DataView(audioData.buffer);
      for (let i = 0; i < length; i++) {
        const sample = dataView.getInt16(i * 2, true); // Little-endian
        channelData[i] = sample / 32768.0; // Normalize to [-1, 1]
      }

      // Calculate chunk duration
      const duration = length / sampleRate;

      // Get current playback time
      const currentTime = playbackContext.currentTime;

      // Determine when to start this chunk
      // If scheduledStartTime is provided and in the future, use it; otherwise start immediately
      const startTime =
        scheduledStartTime !== undefined && scheduledStartTime > currentTime
          ? scheduledStartTime
          : currentTime;

      // Play audio
      const source = playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(playbackContext.destination);

      // Set flag before starting playback
      this.isPlayingAudio = true;

      // Schedule this chunk to start
      source.start(startTime);

      const endTime = startTime + duration;
      console.log(
        '[RealtimeSpeech] Scheduled audio chunk, length:',
        length,
        'samples, duration:',
        duration.toFixed(3),
        's, start:',
        startTime.toFixed(3),
        's, end:',
        endTime.toFixed(3),
        's',
      );

      // Pre-process and schedule the next chunk to start exactly when this one ends
      if (this.audioQueue.length > 0) {
        // Recursively schedule the next chunk to start at the end time
        this.playAudioQueue(endTime);
      } else {
        // No more chunks, set flag to false when this chunk ends
        source.onended = () => {
          this.isPlayingAudio = false;
        };
      }
    } catch (error) {
      console.error('[RealtimeSpeech] Error playing audio:', error);
      this.isPlayingAudio = false;
      // Try to continue with next chunk if there was an error
      if (this.audioQueue.length > 0) {
        this.playAudioQueue();
      }
    }
  }

  async startRecording(): Promise<void> {
    if (this.isRecording) {
      return;
    }

    // Check if mediaDevices API is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Check if we're in a secure context (required for getUserMedia)
      const isSecureContext =
        window.isSecureContext ||
        location.protocol === 'https:' ||
        (location.protocol === 'http:' && location.hostname === 'localhost');

      let errorMessage = 'Microphone access is not available.';
      if (!isSecureContext) {
        errorMessage += ' This feature requires a secure context (HTTPS).';
      } else {
        errorMessage += ' The mediaDevices API is not available.';
        errorMessage +=
          ' On macOS, ensure NSMicrophoneUsageDescription is configured in Info.plist and the app has microphone permissions.';
        errorMessage +=
          ' You may need to grant microphone access in System Settings > Privacy & Security > Microphone.';
      }

      this.callbacks.onError?.(errorMessage);
      throw new Error(errorMessage);
    }

    try {
      // Request microphone access
      // Note: sampleRate constraint may be ignored by browser, so we'll handle resampling if needed
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Initialize audio context with target sample rate
      // The browser will resample if the microphone doesn't support 24kHz
      this.audioContext = new AudioContext({ sampleRate: 24000 });

      // Verify audio context is ready
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Use ScriptProcessorNode for audio processing (AudioWorklet requires separate file)
      // ScriptProcessorNode is deprecated but widely supported
      this.audioProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      // Store reference to current audio processor to prevent processing after cleanup
      const currentProcessor = this.audioProcessor;
      this.audioProcessor.onaudioprocess = (event) => {
        // Atomic check: verify processor is still active and recording state
        // This prevents processing audio after stopRecording() has been called
        if (this.audioProcessor !== currentProcessor) {
          // Processor was replaced/cleaned up, ignore this callback
          return;
        }

        // Double-check isRecording flag to prevent race conditions
        // Also verify connection state before processing
        if (this.isRecording && this.isConnected && this.ws) {
          this.processAudioData(event.inputBuffer.getChannelData(0));
        }
      };

      // Store source reference so we can disconnect it properly
      this.audioSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.audioSource.connect(this.audioProcessor);

      // Connect to a silent gain node so the processor works (ScriptProcessorNode needs a connection)
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      this.audioProcessor.connect(silentGain);
      silentGain.connect(this.audioContext.destination);

      // Reset validation flag when starting recording
      this.hasSentValidAudio = false;

      this.isRecording = true;
      this.callbacks.onRecordingStateChange?.(true);
      console.log('[RealtimeSpeech] Recording started');

      // Audio will be sent automatically via processAudioData callback
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
    // Atomic check for recording state, connection state, WebSocket availability, and session readiness
    // This prevents race conditions where state changes between checks
    const isRecording = this.isRecording;
    const isConnected = this.isConnected;
    const hasWebSocket = !!this.ws;
    const sessionReady = this.sessionReady;

    if (!isRecording || !hasWebSocket || !isConnected || !sessionReady) {
      // Log only occasionally to avoid spam, but provide context when we do
      if (Math.random() < 0.001) {
        console.log('[RealtimeSpeech] Skipping audio processing:', {
          isRecording,
          isConnected,
          hasWebSocket,
          sessionReady,
        });
      }
      return;
    }

    try {
      // Validate that we have actual audio data
      if (!audioData || audioData.length === 0) {
        console.warn('[RealtimeSpeech] Skipping empty audio data array');
        return;
      }

      // Minimum size check - ensure we have meaningful audio data
      const MIN_AUDIO_SAMPLES = 100; // Minimum samples to process
      if (audioData.length < MIN_AUDIO_SAMPLES) {
        console.warn(
          '[RealtimeSpeech] Skipping audio chunk - too small:',
          audioData.length,
          'samples (minimum:',
          MIN_AUDIO_SAMPLES,
          ')',
        );
        return;
      }

      // Check if there's any non-zero audio data
      let hasAudio = false;
      let maxAmplitude = 0;
      for (let i = 0; i < audioData.length; i++) {
        const absValue = Math.abs(audioData[i]!);
        if (absValue > 0.0001) {
          hasAudio = true;
        }
        maxAmplitude = Math.max(maxAmplitude, absValue);
      }

      if (!hasAudio) {
        // Skip silent audio chunks, but log occasionally for debugging
        if (!this.hasSentValidAudio && Math.random() < 0.01) {
          console.log(
            '[RealtimeSpeech] Skipping silent audio chunk (waiting for valid audio), samples:',
            audioData.length,
          );
        }
        return;
      }

      // Convert Float32 to PCM16
      const pcm16 = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        const audioValue = audioData[i];
        if (audioValue === undefined) continue;
        const sample = Math.max(-1, Math.min(1, audioValue));
        pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      // Convert to base64 - build string in chunks to avoid call stack issues
      const uint8Array = new Uint8Array(pcm16.buffer);
      if (uint8Array.length === 0) {
        console.error(
          '[RealtimeSpeech] Empty uint8Array after PCM16 conversion - this should not happen',
          {
            audioDataLength: audioData.length,
            pcm16Length: pcm16.length,
          },
        );
        return;
      }

      // Minimum size validation for uint8Array (PCM16 = 2 bytes per sample)
      const MIN_BYTES = MIN_AUDIO_SAMPLES * 2;
      if (uint8Array.length < MIN_BYTES) {
        console.warn(
          '[RealtimeSpeech] Skipping audio chunk - uint8Array too small:',
          uint8Array.length,
          'bytes (minimum:',
          MIN_BYTES,
          ')',
        );
        return;
      }

      let binaryString = '';
      // Process in chunks to avoid "Maximum call stack size exceeded"
      for (let i = 0; i < uint8Array.length; i++) {
        binaryString += String.fromCharCode(uint8Array[i]!);
      }

      // Validate binary string was created successfully
      if (!binaryString || binaryString.length === 0) {
        console.error('[RealtimeSpeech] Failed to create binary string from uint8Array', {
          uint8ArrayLength: uint8Array.length,
        });
        return;
      }

      const base64Audio = btoa(binaryString);

      // Validate base64 string is not empty and has minimum size
      if (!base64Audio || base64Audio.length === 0) {
        console.error(
          '[RealtimeSpeech] Empty base64 audio string generated - this should not happen',
          {
            binaryStringLength: binaryString.length,
            uint8ArrayLength: uint8Array.length,
          },
        );
        return;
      }

      // Additional validation: base64 should be at least ~67% of original size (base64 encoding overhead)
      const expectedMinBase64Length = Math.floor(uint8Array.length * 0.67);
      if (base64Audio.length < expectedMinBase64Length) {
        console.warn(
          '[RealtimeSpeech] Base64 audio string seems too small:',
          base64Audio.length,
          'chars (expected at least:',
          expectedMinBase64Length,
          ')',
        );
        // Don't return - allow it but log for debugging
      }

      // Mark that we've sent valid audio
      if (!this.hasSentValidAudio) {
        this.hasSentValidAudio = true;
        console.log(
          '[RealtimeSpeech] Sending first valid audio chunk (amplitude:',
          maxAmplitude.toFixed(4),
          ', samples:',
          audioData.length,
          ', base64 size:',
          base64Audio.length,
          'chars)',
        );
      }

      // Send audio to WebSocket
      this.send({
        type: 'input_audio_buffer.append',
        audio: base64Audio,
      }).catch((error) => {
        console.error('[RealtimeSpeech] Error sending audio data:', error);
      });
    } catch (error) {
      console.error('[RealtimeSpeech] Error processing audio data:', error, {
        audioDataLength: audioData?.length,
        isRecording: this.isRecording,
        isConnected: this.isConnected,
      });
    }
  }

  stopRecording(): void {
    if (!this.isRecording) {
      return;
    }

    console.log('[RealtimeSpeech] Stopping recording');

    // Set flag FIRST to prevent new processing from callbacks
    // This must happen before any disconnections to prevent race conditions
    this.isRecording = false;
    this.callbacks.onRecordingStateChange?.(false);

    // Store references to prevent processing after cleanup
    const audioProcessorToCleanup = this.audioProcessor;
    const audioSourceToCleanup = this.audioSource;

    // Disconnect source FIRST to stop new audio data from flowing
    if (audioSourceToCleanup) {
      try {
        audioSourceToCleanup.disconnect();
        console.log('[RealtimeSpeech] Audio source disconnected');
      } catch (error) {
        console.warn('[RealtimeSpeech] Error disconnecting audio source:', error);
      }
      this.audioSource = null;
    }

    // Disconnect audio processor and clear callback to prevent queued processing
    if (audioProcessorToCleanup) {
      try {
        // Clear the callback first to prevent any queued audio from being processed
        audioProcessorToCleanup.onaudioprocess = null;
        audioProcessorToCleanup.disconnect();
        console.log('[RealtimeSpeech] Audio processor disconnected');
      } catch (error) {
        console.warn('[RealtimeSpeech] Error disconnecting audio processor:', error);
      }
      this.audioProcessor = null;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      try {
        this.mediaStream.getTracks().forEach((track) => {
          track.stop();
          track.enabled = false; // Explicitly disable to prevent any further data
        });
        console.log('[RealtimeSpeech] Media stream tracks stopped');
      } catch (error) {
        console.warn('[RealtimeSpeech] Error stopping media stream tracks:', error);
      }
      this.mediaStream = null;
    }

    // Small delay to ensure any in-flight audio processing completes
    // This helps prevent race conditions where audio is processed after stopRecording
    setTimeout(() => {
      // Send input audio buffer commit to finalize the audio buffer
      // Only send if we still have a connection and valid audio was sent
      // Additional validation: ensure WebSocket is still valid and connection is open
      const canSendCommit =
        this.ws &&
        this.isConnected &&
        this.hasSentValidAudio &&
        (this.isTauri
          ? true // Tauri WebSocket doesn't expose readyState easily
          : (this.ws as WebSocket).readyState === WebSocket.OPEN);

      if (canSendCommit) {
        console.log('[RealtimeSpeech] Sending input_audio_buffer.commit (valid audio was sent)');
        this.send({
          type: 'input_audio_buffer.commit',
        }).catch((error) => {
          console.error('[RealtimeSpeech] Error sending commit:', error);
          this.callbacks.onError?.('Failed to finalize audio buffer');
        });
      } else {
        // Log why commit was skipped for debugging
        const skipReason = !this.ws
          ? 'WebSocket not initialized'
          : !this.isConnected
            ? 'Connection closed'
            : !this.hasSentValidAudio
              ? 'No valid audio was sent'
              : this.isTauri
                ? 'Unknown (Tauri)'
                : (this.ws as WebSocket).readyState !== WebSocket.OPEN
                  ? `WebSocket not open (state: ${(this.ws as WebSocket).readyState})`
                  : 'Unknown reason';
        console.log('[RealtimeSpeech] Skipping commit -', skipReason);
      }
    }, 50); // Small delay to let any pending audio processing finish

    // Reset validation flag
    this.hasSentValidAudio = false;
  }

  async disconnect(): Promise<void> {
    console.log('[RealtimeSpeech] Disconnecting');
    this.stopRecording();
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    console.log('[RealtimeSpeech] Cleaning up');

    // Disconnect audio source if still connected
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }

    // Disconnect WebSocket connection
    if (this.ws) {
      try {
        if (this.isTauri) {
          const tauriWs = this.ws as TauriWebSocket;
          await tauriWs.disconnect();
        } else {
          const browserWs = this.ws as WebSocket;
          if (
            browserWs.readyState === WebSocket.OPEN ||
            browserWs.readyState === WebSocket.CONNECTING
          ) {
            browserWs.close();
          }
        }
      } catch (error) {
        console.error('[RealtimeSpeech] Error disconnecting WebSocket:', error);
      }
      this.ws = null;
    }

    if (this.tauriUnlisten) {
      this.tauriUnlisten();
      this.tauriUnlisten = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }

    if (this.playbackAudioContext) {
      this.playbackAudioContext.close().catch(console.error);
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
    this.sessionId = null;
    this.conversationItemId = null;
    this.audioQueue = [];
    this.currentAssistantTranscript = '';
  }

  private async send(data: any): Promise<void> {
    // Log all send attempts for debugging (even if validation fails)
    if (data.type === 'input_audio_buffer.append') {
      console.log('[RealtimeSpeech] Send attempt: input_audio_buffer.append', {
        audioLength: data.audio?.length || 0,
        isRecording: this.isRecording,
        isConnected: this.isConnected,
        hasSentValidAudio: this.hasSentValidAudio,
      });
    } else {
      console.log('[RealtimeSpeech] Send attempt:', data.type);
    }

    if (!this.ws) {
      console.warn('[RealtimeSpeech] Cannot send: WebSocket not initialized');
      return;
    }

    // Pre-send validation for commit operations
    if (data.type === 'input_audio_buffer.commit') {
      // Ensure we're not committing an empty buffer
      if (!this.hasSentValidAudio) {
        console.error(
          '[RealtimeSpeech] Validation failed: Attempted to commit without sending valid audio',
          {
            isRecording: this.isRecording,
            isConnected: this.isConnected,
            hasSentValidAudio: this.hasSentValidAudio,
          },
        );
        return;
      }

      // Log commit attempt for debugging
      console.log('[RealtimeSpeech] Validating commit operation:', {
        hasSentValidAudio: this.hasSentValidAudio,
        isConnected: this.isConnected,
        hasWebSocket: !!this.ws,
      });
    }

    // Pre-send validation for audio data
    if (data.type === 'input_audio_buffer.append') {
      // Check session readiness before sending audio
      if (!this.sessionReady) {
        console.error(
          '[RealtimeSpeech] Validation failed: Session not ready (session.updated not received yet)',
          {
            sessionReady: this.sessionReady,
            isConnected: this.isConnected,
            hasWebSocket: !!this.ws,
          },
        );
        return;
      }

      // Validate audio data before sending
      if (!data.audio || typeof data.audio !== 'string' || data.audio.length === 0) {
        console.error(
          '[RealtimeSpeech] Validation failed: Empty or invalid audio data detected before send',
          {
            hasAudio: !!data.audio,
            audioType: typeof data.audio,
            audioLength: data.audio?.length || 0,
          },
        );
        return;
      }

      // Validate base64 format (basic check - should contain only valid base64 characters)
      const base64Regex = /^[A-Za-z0-9+/=]+$/;
      if (!base64Regex.test(data.audio)) {
        console.error('[RealtimeSpeech] Validation failed: Invalid base64 format detected', {
          audioLength: data.audio.length,
          preview: data.audio.substring(0, 20),
        });
        return;
      }

      // Minimum size check - PCM16 mono at 24kHz needs at least some bytes
      // Even a very short audio chunk should have at least 100 bytes of base64 (roughly 75 bytes raw)
      // REJECT suspiciously small chunks to prevent empty audio from being sent
      if (data.audio.length < 100) {
        console.error(
          '[RealtimeSpeech] Validation failed: Audio chunk is too small (rejecting to prevent empty audio)',
          {
            audioLength: data.audio.length,
            preview: data.audio.substring(0, 20),
            minimumRequired: 100,
          },
        );
        return;
      }
    }

    const messageStr = JSON.stringify(data);

    // Validate serialized message for audio messages
    if (data.type === 'input_audio_buffer.append') {
      try {
        // Parse back the serialized message to verify audio field is present and valid
        const parsedMessage = JSON.parse(messageStr);
        if (
          !parsedMessage.audio ||
          typeof parsedMessage.audio !== 'string' ||
          parsedMessage.audio.length === 0
        ) {
          console.error(
            '[RealtimeSpeech] Validation failed: Serialized message has invalid audio field',
            {
              hasAudio: !!parsedMessage.audio,
              audioType: typeof parsedMessage.audio,
              audioLength: parsedMessage.audio?.length || 0,
              messagePreview: messageStr.substring(0, 200),
            },
          );
          return;
        }

        // Verify base64 format in serialized message
        const base64Regex = /^[A-Za-z0-9+/=]+$/;
        if (!base64Regex.test(parsedMessage.audio)) {
          console.error(
            '[RealtimeSpeech] Validation failed: Serialized message has invalid base64 audio',
            {
              audioLength: parsedMessage.audio.length,
              preview: parsedMessage.audio.substring(0, 20),
            },
          );
          return;
        }

        // Final size check on serialized message
        if (parsedMessage.audio.length < 100) {
          console.error(
            '[RealtimeSpeech] Validation failed: Serialized message audio is too small',
            {
              audioLength: parsedMessage.audio.length,
              preview: parsedMessage.audio.substring(0, 20),
            },
          );
          return;
        }
      } catch (parseError) {
        console.error('[RealtimeSpeech] Validation failed: Error parsing serialized message', {
          error: parseError,
          messagePreview: messageStr.substring(0, 200),
        });
        return;
      }

      const audioSize = data.audio?.length || 0;
      console.log(
        '[RealtimeSpeech] Sending audio chunk (size:',
        audioSize,
        'chars, base64 preview:',
        data.audio?.substring(0, 20) || 'none',
        '...)',
      );

      // Log additional context for debugging
      if (audioSize === 0) {
        console.error('[RealtimeSpeech] CRITICAL: Attempted to send empty audio chunk!', {
          isRecording: this.isRecording,
          isConnected: this.isConnected,
          hasSentValidAudio: this.hasSentValidAudio,
        });
      }
    } else {
      console.log('[RealtimeSpeech] Sending:', data.type, data);
    }

    if (this.isTauri) {
      // Tauri WebSocket
      const tauriWs = this.ws as TauriWebSocket;
      await tauriWs.send(messageStr);
    } else {
      // Browser WebSocket
      const browserWs = this.ws as WebSocket;
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(messageStr);
      } else {
        console.warn(
          '[RealtimeSpeech] Cannot send: WebSocket not open, state:',
          browserWs.readyState,
        );
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
