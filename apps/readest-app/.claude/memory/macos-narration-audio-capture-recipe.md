---
name: macos-narration-audio-capture-recipe
description: "How to measure audible gaps in Read Aloud / narration on the macOS app via BlackHole loopback, and the three traps that skew the numbers"
metadata:
  node_type: memory
  type: reference
  originSessionId: b8fbc2e8-ee50-4193-b397-c5ed2ce0d266
  modified: 2026-10-20T19:18:46.237Z
---

Used for #6902 (2026-10-21) on installed Readest 0.12.16.

- BlackHole 2ch is installed. Switch the default output with a CoreAudio Swift helper (no SwitchAudioSource): compile a ~50-line `audioout list|get|set <name>` into the scratchpad. Restore to "MacBook Pro扬声器" afterwards.
- Record: `ffmpeg -f avfoundation -i ":1" -t N -ac 1 -ar 48000 out.wav` (":1" = BlackHole).
- Trap 1: while computer-use drives the app, the captured level drops ~30 dB (mean -68 dB). Silence detection still works at `silencedetect=noise=-85dB` because loopback silence is digital zero; -50 dB gives fake 9 s "gaps".
- Trap 2: ffmpeg avfoundation dropped ~14% of samples (87 s file for ~101 s wall time). It is uniform, so compare runs against each other or rescale; never trust absolute seconds without checking file duration against wall time.
- Trap 3: `t` starts Read Aloud from the saved TTS position, not always the visible page; zoom-check the first highlight before trusting a run.
- Envelope cross-correlation failed on the attenuated capture; matching the pause pattern by hand against `silencedetect` on the source (`-ss clipBegin`) worked.
- Test book: `~/Documents/books/issues/My Vampire System ch2251-2300 (readaloud).epub` (one SMIL + ~4 MB mp3 per chapter; join 2251→2252 is at page 5).

Related: [[media-overlay-narration-5480]]
