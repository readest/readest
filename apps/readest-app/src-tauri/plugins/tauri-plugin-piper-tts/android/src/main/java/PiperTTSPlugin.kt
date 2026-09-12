package com.readest.piper_tts

// On-device Piper neural TTS for Android, via sherpa-onnx's OfflineTts.
//
// This file is the glue: HTTP download + tar.bz2 extraction of sherpa-onnx's
// own pre-converted Piper voice packages (see PIPER_RELEASE_BASE below), an
// LRU-ish cache of loaded OfflineTts instances, and the Tauri command
// surface. The actual VITS/Piper inference lives in sherpa-onnx's own
// Kotlin API (Tts.kt, vendored at
// android/src/main/java/com/k2fsa/sherpa/onnx/Tts.kt) plus its native
// libsherpa-onnx-jni.so (vendored at android/src/main/jniLibs/).

import android.app.Activity
import android.content.Context
import android.util.Base64
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.k2fsa.sherpa.onnx.GeneratedAudio
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

@InvokeArg
class VoiceDescriptorArg {
    lateinit var id: String
    lateinit var name: String
    lateinit var lang: String
    lateinit var quality: String
    lateinit var archiveUrl: String
    var sizeBytes: Long = 0
}

@InvokeArg
class ListVoicesArgs {
    lateinit var catalog: Array<VoiceDescriptorArg>
}

@InvokeArg
class DownloadVoiceArgs {
    lateinit var voice: VoiceDescriptorArg
}

@InvokeArg
class CancelDownloadArgs {
    lateinit var id: String
}

@InvokeArg
class DeleteVoiceArgs {
    lateinit var id: String
}

@InvokeArg
class LoadVoiceArgs {
    lateinit var id: String
}

@InvokeArg
class SynthesizeArgs {
    lateinit var id: String
    lateinit var text: String
    var speakerId: Int = 0
    var speed: Float = 1.0f
}

@TauriPlugin
class PiperTTSPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val TAG = "PiperTTSPlugin"
        private const val VOICES_DIR = "piper_voices"
        private const val ESPEAK_DATA_DIR = "espeak-ng-data"
        // Shared by every Piper voice regardless of language — see
        // https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
        private const val ESPEAK_DATA_URL =
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.tar.bz2"
    }

    private val context: Context get() = activity.applicationContext
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val downloadJobs = ConcurrentHashMap<String, Job>()
    // One loaded OfflineTts per voice id. Piper/VITS models are small
    // (10-30MB) but loading is not free, so a voice stays resident until
    // explicitly unloaded or the plugin's process dies — there is no idle
    // timer here unlike native-tts, because unlike a system TTS engine
    // handle this holds no OS audio resources between calls.
    private val loadedVoices = ConcurrentHashMap<String, OfflineTts>()
    private val loadMutex = Mutex()
    private val espeakMutex = Mutex()
    @Volatile private var espeakDataDir: String? = null

    private fun voiceDir(id: String): File =
        File(context.filesDir, "$VOICES_DIR/$id")

    private fun modelFile(id: String) = File(voiceDir(id), "model.onnx")
    private fun tokensFile(id: String) = File(voiceDir(id), "tokens.txt")

    private fun isVoiceDownloaded(id: String): Boolean =
        modelFile(id).exists() && tokensFile(id).exists()

    // espeak-ng-data is the shared phoneme/language data Piper's espeak-ng
    // frontend needs; every per-voice archive bundles its own copy, but it's
    // identical across all of them, so we fetch it once (same release tag as
    // the voices) into internal storage instead of re-extracting it from
    // every voice's archive.
    private suspend fun ensureEspeakData(): String {
        espeakDataDir?.let { return it }
        return espeakMutex.withLock {
            espeakDataDir?.let { return@withLock it }
            val outDir = File(context.filesDir, ESPEAK_DATA_DIR)
            if (!outDir.exists() || outDir.list().isNullOrEmpty()) {
                outDir.mkdirs()
                val tmp = File(context.cacheDir, "espeak-ng-data.tar.bz2")
                downloadFile(ESPEAK_DATA_URL, tmp) { _, _ -> }
                extractTarBz2(tmp, outDir, stripLeadingDir = true)
                tmp.delete()
            }
            espeakDataDir = outDir.absolutePath
            outDir.absolutePath
        }
    }

    // Extracts a sherpa-onnx tts-models .tar.bz2 into outDir. Archives are
    // laid out as `<name>/model.onnx`, `<name>/tokens.txt`,
    // `<name>/espeak-ng-data/...`; stripLeadingDir drops that one top-level
    // folder so callers get flat contents directly under outDir.
    private fun extractTarBz2(archive: File, outDir: File, stripLeadingDir: Boolean) {
        outDir.mkdirs()
        BZip2CompressorInputStream(archive.inputStream().buffered()).use { bz ->
            TarArchiveInputStream(bz).use { tar ->
                var entry = tar.nextTarEntry
                while (entry != null) {
                    val name = if (stripLeadingDir) {
                        entry.name.substringAfter('/', missingDelimiterValue = entry.name)
                    } else {
                        entry.name
                    }
                    if (name.isNotEmpty() && !entry.isDirectory) {
                        val outFile = File(outDir, name)
                        outFile.parentFile?.mkdirs()
                        FileOutputStream(outFile).use { out -> tar.copyTo(out) }
                    }
                    entry = tar.nextTarEntry
                }
            }
        }
    }

    @Command
    fun list_voices(invoke: Invoke) {
        val args = invoke.parseArgs(ListVoicesArgs::class.java)
        val result = JSObject()
        val voices = args.catalog.map { v ->
            JSObject().apply {
                put("id", v.id)
                put("downloaded", isVoiceDownloaded(v.id))
                put("bytesOnDisk", if (isVoiceDownloaded(v.id)) modelFile(v.id).length() + tokensFile(v.id).length() else 0)
            }
        }
        result.put("voices", JSONArray(voices))
        invoke.resolve(result)
    }

    @Command
    fun download_voice(invoke: Invoke) {
        val args = invoke.parseArgs(DownloadVoiceArgs::class.java)
        val voice = args.voice
        val job = coroutineScope.launch {
            val tmpArchive = File(context.cacheDir, "piper-${voice.id}.tar.bz2")
            try {
                voiceDir(voice.id).mkdirs()
                ensureEspeakData()
                downloadFile(voice.archiveUrl, tmpArchive) { downloaded, total ->
                    emitProgress(voice.id, downloaded, if (total > 0) total else downloaded, done = false, error = null)
                }
                val extractDir = File(context.cacheDir, "piper-extract-${voice.id}")
                extractDir.deleteRecursively()
                extractTarBz2(tmpArchive, extractDir, stripLeadingDir = true)
                val extractedModel = extractDir.walkTopDown().firstOrNull { it.name.endsWith(".onnx") }
                val extractedTokens = extractDir.walkTopDown().firstOrNull { it.name == "tokens.txt" }
                if (extractedModel == null || extractedTokens == null) {
                    throw java.io.IOException(
                        "Archive for ${voice.id} did not contain the expected model.onnx/tokens.txt",
                    )
                }
                voiceDir(voice.id).mkdirs()
                if (!extractedModel.copyTo(modelFile(voice.id), overwrite = true).exists() ||
                    !extractedTokens.copyTo(tokensFile(voice.id), overwrite = true).exists()
                ) {
                    throw java.io.IOException("Failed to finalize downloaded voice files")
                }
                extractDir.deleteRecursively()
                emitProgress(voice.id, 1, 1, done = true, error = null)
                invoke.resolve(JSObject().apply {
                    put("id", voice.id)
                    put("success", true)
                })
            } catch (e: Exception) {
                Log.e(TAG, "Voice download failed for ${voice.id}", e)
                voiceDir(voice.id).deleteRecursively()
                emitProgress(voice.id, 0, 0, done = true, error = e.message)
                invoke.reject("Failed to download voice ${voice.id}: ${e.message}")
            } finally {
                tmpArchive.delete()
                downloadJobs.remove(voice.id)
            }
        }
        downloadJobs[voice.id] = job
    }

    private fun downloadFile(urlStr: String, out: File, onProgress: (Long, Long) -> Unit): Long {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.instanceFollowRedirects = true
        try {
            conn.connect()
            if (conn.responseCode !in 200..299) {
                throw java.io.IOException("HTTP ${conn.responseCode} for $urlStr")
            }
            val total = conn.contentLengthLong
            var downloaded = 0L
            conn.inputStream.use { input ->
                FileOutputStream(out).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        downloaded += n
                        onProgress(downloaded, total)
                    }
                }
            }
            return downloaded
        } finally {
            conn.disconnect()
        }
    }

    private fun emitProgress(id: String, downloaded: Long, total: Long, done: Boolean, error: String?) {
        trigger("download_progress", JSObject().apply {
            put("id", id)
            put("bytesDownloaded", downloaded)
            put("totalBytes", total)
            put("done", done)
            error?.let { put("error", it) }
        })
    }

    @Command
    fun cancel_download(invoke: Invoke) {
        val args = invoke.parseArgs(CancelDownloadArgs::class.java)
        downloadJobs.remove(args.id)?.cancel()
        invoke.resolve(JSObject())
    }

    @Command
    fun delete_voice(invoke: Invoke) {
        val args = invoke.parseArgs(DeleteVoiceArgs::class.java)
        coroutineScope.launch {
            loadMutex.withLock {
                loadedVoices.remove(args.id)?.release()
            }
            voiceDir(args.id).deleteRecursively()
            invoke.resolve(JSObject())
        }
    }

    @Command
    fun load_voice(invoke: Invoke) {
        val args = invoke.parseArgs(LoadVoiceArgs::class.java)
        coroutineScope.launch {
            try {
                val tts = getOrLoadVoice(args.id)
                invoke.resolve(JSObject().apply {
                    put("id", args.id)
                    put("sampleRate", tts.sampleRate())
                    put("numSpeakers", tts.numSpeakers())
                })
            } catch (e: Exception) {
                Log.e(TAG, "Failed to load voice ${args.id}", e)
                invoke.reject("Failed to load voice ${args.id}: ${e.message}")
            }
        }
    }

    @Command
    fun unload_voice(invoke: Invoke) {
        val args = invoke.parseArgs(LoadVoiceArgs::class.java)
        coroutineScope.launch {
            loadMutex.withLock {
                loadedVoices.remove(args.id)?.release()
            }
            invoke.resolve(JSObject())
        }
    }

    private suspend fun getOrLoadVoice(id: String): OfflineTts {
        loadedVoices[id]?.let { return it }
        return loadMutex.withLock {
            loadedVoices[id]?.let { return@withLock it }
            if (!isVoiceDownloaded(id)) {
                throw java.io.IOException("Voice $id is not downloaded")
            }
            val dataDir = ensureEspeakData()
            val vitsConfig = OfflineTtsVitsModelConfig(
                model = modelFile(id).absolutePath,
                tokens = tokensFile(id).absolutePath,
                dataDir = dataDir,
            )
            val modelConfig = OfflineTtsModelConfig(
                vits = vitsConfig,
                numThreads = 2,
                debug = false,
                provider = "cpu",
            )
            val config = OfflineTtsConfig(model = modelConfig, maxNumSentences = 1)
            val tts = OfflineTts(assetManager = null, config = config)
            loadedVoices[id] = tts
            tts
        }
    }

    @Command
    fun synthesize(invoke: Invoke) {
        val args = invoke.parseArgs(SynthesizeArgs::class.java)
        coroutineScope.launch {
            try {
                val tts = getOrLoadVoice(args.id)
                // Blocking native call; runs on Dispatchers.IO so it does not
                // block the plugin's main-thread command dispatch.
                val audio: GeneratedAudio = tts.generate(
                    text = args.text,
                    sid = args.speakerId,
                    speed = if (args.speed > 0f) args.speed else 1.0f,
                )
                val wavBytes = pcmFloatToWavBytes(audio.samples, audio.sampleRate)
                invoke.resolve(JSObject().apply {
                    put("audioBase64", Base64.encodeToString(wavBytes, Base64.NO_WRAP))
                    put("sampleRate", audio.sampleRate)
                    put("numSamples", audio.samples.size)
                })
            } catch (e: Exception) {
                Log.e(TAG, "Synthesis failed for voice ${args.id}", e)
                invoke.reject("Synthesis failed: ${e.message}")
            }
        }
    }

    @Command
    fun stop(invoke: Invoke) {
        // Sherpa-onnx's generate() is a single blocking call with no native
        // cancellation hook; per-sentence synthesis is short enough (well
        // under a second on a modern phone) that BufferedTTSClient's own
        // AbortSignal simply lets the in-flight call finish and discards the
        // result rather than needing native interruption.
        invoke.resolve(JSObject())
    }

    // Minimal 16-bit PCM mono WAV writer: sherpa-onnx hands back normalized
    // float32 samples in [-1, 1]; the rest of the TTS pipeline (WebAudioPlayer
    // / decodeAudioData) expects a standard container it can decode.
    private fun pcmFloatToWavBytes(samples: FloatArray, sampleRate: Int): ByteArray {
        val bytesPerSample = 2
        val dataSize = samples.size * bytesPerSample
        val buffer = java.nio.ByteBuffer.allocate(44 + dataSize)
            .order(java.nio.ByteOrder.LITTLE_ENDIAN)
        buffer.put("RIFF".toByteArray())
        buffer.putInt(36 + dataSize)
        buffer.put("WAVE".toByteArray())
        buffer.put("fmt ".toByteArray())
        buffer.putInt(16)
        buffer.putShort(1) // PCM
        buffer.putShort(1) // mono
        buffer.putInt(sampleRate)
        buffer.putInt(sampleRate * bytesPerSample)
        buffer.putShort((bytesPerSample).toShort())
        buffer.putShort((bytesPerSample * 8).toShort())
        buffer.put("data".toByteArray())
        buffer.putInt(dataSize)
        for (s in samples) {
            val clamped = s.coerceIn(-1.0f, 1.0f)
            val intVal = (clamped * 32767.0f).toInt().toShort()
            buffer.putShort(intVal)
        }
        return buffer.array()
    }
}
