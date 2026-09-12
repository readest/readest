# sherpa-onnx vendoring — status

Both pieces sherpa-onnx doesn't publish to Maven are now vendored in this
plugin:

- **Native libs** (`android/src/main/jniLibs/{arm64-v8a,armeabi-v7a}/`):
  `libsherpa-onnx-jni.so` + `libonnxruntime.so`, extracted from
  `sherpa-onnx-v1.13.8-android.tar.bz2`. `libsherpa-onnx-c-api.so` /
  `libsherpa-onnx-cxx-api.so` were dropped — `readelf -d` on the JNI lib
  shows they aren't a runtime dependency (statically linked in), and
  x86/x86_64 were dropped too (emulator-only).
- **Kotlin API** (`android/src/main/java/com/k2fsa/sherpa/onnx/Tts.kt`):
  vendored verbatim from `sherpa-onnx/kotlin-api/Tts.kt` in the upstream
  repo (self-contained, no sibling files needed for TTS). The native method
  names it declares (`newFromFile`, `generateImpl`, `getSampleRate`, …) were
  cross-checked against the exported JNI symbols in the vendored `.so`
  (`nm -D libsherpa-onnx-jni.so | grep Java_com_k2fsa`) to confirm this is
  the matching version.

## Voices and espeak-ng-data: fully automatic now

`PiperTTSPlugin.kt` downloads sherpa-onnx's own pre-converted Piper voice
packages directly from their GitHub releases (`tts-models` tag) and unpacks
them with `org.apache.commons:commons-compress` (added as a normal Gradle
dependency — resolves from Maven Central at build time, nothing to vendor):

- Per-voice: `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-<lang>-<name>-<quality>.tar.bz2`
  (contains `<lang>-<name>-<quality>.onnx` + `tokens.txt` + its own copy of
  `espeak-ng-data/`, which we ignore in favor of the shared copy below).
- Shared, fetched once: `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.tar.bz2`.

**Important — do NOT point `archive_url` at raw Hugging Face
`rhasspy/piper-voices` files** (`.onnx`/`.onnx.json`). sherpa-onnx's VITS
loader reads `language`/`voice`/`comment` etc. from custom ONNX metadata
(`Ort::ModelMetadata`, see `sherpa-onnx/csrc/offline-tts-vits-model.cc`)
that only exists in sherpa-onnx's own converted packages — the raw Piper
files don't have it, and there's no reasonable way to patch it in on-device.
Always use the `vits-piper-*.tar.bz2` release URLs above.

## What's left

Nothing structural — this should compile and run as-is. If a newer
sherpa-onnx release changes the Kotlin API surface or JNI symbol names,
re-vendor `Tts.kt` and the `.so` files together (same version, from the same
release) rather than mixing versions.
