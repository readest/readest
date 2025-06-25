# KOKORO TTS Integration

This document explains how to set up and use KOKORO TTS with the Readest audiobook application.

## Overview

KOKORO TTS has been integrated as an additional Text-to-Speech engine alongside the existing EdgeTTS, WebSpeech, and Native TTS options. KOKORO TTS provides high-quality voice synthesis with support for multiple languages and voice mixing capabilities.

## Prerequisites

### 1. KOKORO TTS Server Setup

You need to have a KOKORO TTS server running. You can set this up using the official KOKORO FastAPI implementation:

```bash
# Clone the KOKORO FastAPI repository
git clone https://github.com/remsky/Kokoro-FastAPI.git
cd Kokoro-FastAPI

# Option 1: Using Docker (Recommended)
# For CPU inference
docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest

# For GPU inference (requires NVIDIA GPU)
docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest

# Option 2: Using Docker Compose
cd docker/cpu  # or docker/gpu for GPU support
docker compose up --build

# Option 3: Direct installation with UV
./start-cpu.sh  # or ./start-gpu.sh for GPU support
```

### 2. Server Configuration

By default, the integration expects KOKORO TTS to be running at `http://localhost:8880`. You can configure this by:

1. **Environment Variable**: Set `NEXT_PUBLIC_KOKORO_TTS_URL` in your environment
2. **Runtime Configuration**: The server URL is stored in localStorage and can be updated through the application

## Features

### Supported Capabilities

- **High-Quality Voice Synthesis**: Superior audio quality compared to browser TTS
- **Multi-Language Support**: English, Japanese, Chinese, and more
- **Voice Mixing**: Combine multiple voices with weighted ratios
- **Streaming Audio**: Real-time audio generation for better user experience
- **Multiple Audio Formats**: MP3, WAV, OPUS, FLAC support
- **Sentence-Level Granularity**: Optimized for natural speech flow

### Voice Selection

KOKORO voices appear in the TTS voice selection under the "KOKORO TTS" group. Voice names are formatted for better readability:
- `af_bella` becomes "Bella (AF)"
- `af_sky` becomes "Sky (AF)"

### Voice Mixing

KOKORO TTS supports voice combinations:
- **Simple mixing**: `af_bella+af_sky` (50/50 mix)
- **Weighted mixing**: `af_bella(2)+af_sky(1)` (67/33 mix)

## Usage

### 1. Starting the Application

1. Ensure your KOKORO TTS server is running
2. Start the Readest application
3. The application will automatically detect and initialize KOKORO TTS if the server is available

### 2. Selecting KOKORO Voices

1. Open TTS settings in the application
2. Look for the "KOKORO TTS" voice group
3. Select your preferred KOKORO voice
4. The application will automatically switch to using KOKORO TTS

### 3. Configuration Options

The KOKORO TTS client supports:
- **Server URL Configuration**: Change the KOKORO server endpoint
- **Voice Selection**: Choose from available KOKORO voices
- **Speed Control**: Adjust playback speed (0.1x to 3.0x)
- **Language Detection**: Automatic language detection from content

## Troubleshooting

### Common Issues

1. **KOKORO TTS not appearing in voice list**
   - Verify KOKORO server is running at the configured URL
   - Check browser console for connection errors
   - Ensure no firewall is blocking the connection

2. **Audio playback issues**
   - Check KOKORO server logs for errors
   - Verify the selected voice is available
   - Try a different audio format if supported

3. **Performance issues**
   - Consider using GPU acceleration if available
   - Adjust chunk size settings in KOKORO server
   - Monitor server resource usage

### Server Status Check

You can verify KOKORO server status by visiting:
- API Documentation: `http://localhost:8880/docs`
- Web Interface: `http://localhost:8880/web`
- Voice List: `http://localhost:8880/v1/audio/voices`

### Logs and Debugging

- Browser console shows KOKORO TTS initialization status
- KOKORO server logs provide detailed error information
- Network tab in browser dev tools shows API request/response details

## Advanced Configuration

### Environment Variables

```bash
# Set custom KOKORO server URL
export NEXT_PUBLIC_KOKORO_TTS_URL="http://your-kokoro-server:8880"
```

### Server Configuration

KOKORO TTS server can be configured with various options:
- Model selection
- Audio quality settings
- Streaming parameters
- Voice mixing options

Refer to the [KOKORO FastAPI documentation](https://github.com/remsky/Kokoro-FastAPI) for detailed server configuration options.

## Integration Details

### Architecture

The KOKORO TTS integration follows the existing TTS client pattern:
- `KokoroTTSClient` implements the `TTSClient` interface
- Automatic initialization and voice discovery
- Seamless integration with existing TTS controller
- Graceful fallback to other TTS engines if unavailable

### API Compatibility

The integration uses KOKORO's OpenAI-compatible API endpoints:
- `/v1/audio/voices` - Voice discovery
- `/v1/audio/speech` - Audio generation

### Voice Management

- Automatic voice discovery from server
- Language inference from voice names
- Voice preference storage
- Dynamic voice availability checking

## Support

For issues related to:
- **KOKORO TTS Server**: Check the [KOKORO FastAPI repository](https://github.com/remsky/Kokoro-FastAPI)
- **Integration Issues**: Report in the Readest application repository
- **Voice Quality**: Refer to KOKORO TTS documentation and community

## License

This integration respects the licenses of both projects:
- KOKORO TTS: Apache 2.0 License
- Readest Application: Check the main repository for license details
