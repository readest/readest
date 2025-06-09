package com.readest.native_tts

import android.os.Bundle
import android.app.Activity
import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import app.tauri.plugin.PluginResult
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import org.json.JSONArray
import org.json.JSONObject
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class TTSVoiceData(
    val id: String,
    val name: String,
    val lang: String,
    val disabled: Boolean = false
)

data class TTSMessageEvent(
    val code: String, // 'boundary' | 'error' | 'end'
    val message: String? = null,
    val mark: String? = null
)

enum class TTSGranularity(val value: String) {
    WORD("word"),
    SENTENCE("sentence"),
    PARAGRAPH("paragraph")
}

@TauriPlugin
class NativeTTSPlugin(private val activity: Activity) : Plugin(activity) {
    
    companion object {
        private const val TAG = "NativeTTSPlugin"
        private const val CHANNEL_NAME = "tts_events"
    }
    
    private var textToSpeech: TextToSpeech? = null
    private var isInitialized = AtomicBoolean(false)
    private var isPaused = AtomicBoolean(false)
    private var isSpeaking = AtomicBoolean(false)
    private var currentVoiceId = AtomicReference<String>("")
    private var currentLang = AtomicReference<String>("en-US")
    private var currentRate = AtomicReference<Float>(1.0f)
    private var currentPitch = AtomicReference<Float>(1.0f)
    
    // Event channels for each speaking session
    private val eventChannels = ConcurrentHashMap<String, Channel<TTSMessageEvent>>()
    private val speakingJobs = ConcurrentHashMap<String, Job>()
    
    private val coroutineScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    
    @Command
    fun init(invoke: Invoke) {
        coroutineScope.launch {
            try {
                val success = initializeTTS()
                val result = JSObject().apply {
                    put("success", success)
                }
                invoke.resolve(result)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize TTS", e)
                invoke.reject("Failed to initialize TTS: ${e.message}")
            }
        }
    }
    
    private suspend fun initializeTTS(): Boolean = suspendCancellableCoroutine { continuation ->
        try {
            textToSpeech = TextToSpeech(activity) { status ->
                when (status) {
                    TextToSpeech.SUCCESS -> {
                        setupTTSListener()
                        isInitialized.set(true)
                        continuation.resume(true) {}
                    }
                    else -> {
                        Log.e(TAG, "TTS initialization failed with status: $status")
                        continuation.resume(false) {}
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception during TTS initialization", e)
            continuation.resume(false) {}
        }
    }
    
    private fun setupTTSListener() {
        textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                utteranceId?.let { id ->
                    isSpeaking.set(true)
                    sendEvent(id, TTSMessageEvent("boundary", "start"))
                }
            }
            
            override fun onDone(utteranceId: String?) {
                utteranceId?.let { id ->
                    isSpeaking.set(false)
                    sendEvent(id, TTSMessageEvent("end"))
                    closeEventChannel(id)
                }
            }
            
            override fun onError(utteranceId: String?) {
                utteranceId?.let { id ->
                    isSpeaking.set(false)
                    sendEvent(id, TTSMessageEvent("error", "TTS playback error"))
                    closeEventChannel(id)
                }
            }
            
            override fun onRangeStart(utteranceId: String?, start: Int, end: Int, frame: Int) {
                utteranceId?.let { id ->
                    sendEvent(id, TTSMessageEvent("boundary", "range", "pos:$start-$end"))
                }
            }
        })
    }
    
    @Command
    fun speak(invoke: Invoke) {
        val args = invoke.parseArgs(SpeakArgs::class.java)
        
        if (!isInitialized.get()) {
            invoke.reject("TTS not initialized")
            return
        }
        
        val utteranceId = UUID.randomUUID().toString()
        
        coroutineScope.launch {
            try {
                val eventChannel = Channel<TTSMessageEvent>(Channel.UNLIMITED)
                eventChannels[utteranceId] = eventChannel
                
                val speakJob = launch {
                    speakText(args.ssml, utteranceId, args.preload ?: false)
                }
                speakingJobs[utteranceId] = speakJob
                
                // Return the utterance ID so frontend can listen to events
                val result = JSObject().apply {
                    put("utteranceId", utteranceId)
                }
                invoke.resolve(result)
                
                // Start sending events to the frontend
                startEventStream(utteranceId)
                
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start speaking", e)
                invoke.reject("Failed to start speaking: ${e.message}")
            }
        }
    }
    
    private suspend fun speakText(ssml: String, utteranceId: String, preload: Boolean) {
        withContext(Dispatchers.Main) {
            try {
                // Parse SSML and extract text
                val text = parseSSML(ssml)

                textToSpeech?.apply {
                    setSpeechRate(currentRate.get())
                    setPitch(currentPitch.get())
                }
                
                val params = Bundle().apply {
                    putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
                }
                
                val result = textToSpeech?.speak(
                    text,
                    if (preload) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH,
                    params,
                    utteranceId
                )
                
                if (result != TextToSpeech.SUCCESS) {
                    sendEvent(utteranceId, TTSMessageEvent("error", "Failed to start speech"))
                }
            } catch (e: Exception) {
                sendEvent(utteranceId, TTSMessageEvent("error", "Exception during speech: ${e.message}"))
            }
        }
    }
    
    private fun parseSSML(ssml: String): String {
        // Simple SSML parsing - extract text content
        return ssml
            .replace(Regex("<[^>]*>"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }
    
    private fun startEventStream(utteranceId: String) {
        coroutineScope.launch {
            val channel = eventChannels[utteranceId] ?: return@launch
            
            try {
                for (event in channel) {
                    val eventData = JSObject().apply {
                        put("utteranceId", utteranceId)
                        put("code", event.code)
                        event.message?.let { put("message", it) }
                        event.mark?.let { put("mark", it) }
                    }
                    
                    // Send event to frontend via Tauri event system
                    trigger(CHANNEL_NAME, eventData)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error in event stream for $utteranceId", e)
            }
        }
    }
    
    private fun sendEvent(utteranceId: String, event: TTSMessageEvent) {
        coroutineScope.launch {
            eventChannels[utteranceId]?.trySend(event)
        }
    }
    
    private fun closeEventChannel(utteranceId: String) {
        coroutineScope.launch {
            eventChannels[utteranceId]?.close()
            eventChannels.remove(utteranceId)
            speakingJobs[utteranceId]?.cancel()
            speakingJobs.remove(utteranceId)
        }
    }
    
    @Command
    fun pause(invoke: Invoke) {
        try {
            if (textToSpeech?.stop() == TextToSpeech.SUCCESS) {
                isPaused.set(true)
                invoke.resolve()
            } else {
                invoke.reject("Failed to pause TTS")
            }
        } catch (e: Exception) {
            invoke.reject("Exception while pausing: ${e.message}")
        }
    }
    
    @Command
    fun resume(invoke: Invoke) {
        // Android TTS doesn't have native resume, so we'll need to track state
        try {
            isPaused.set(false)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception while resuming: ${e.message}")
        }
    }
    
    @Command
    fun stop(invoke: Invoke) {
        try {
            if (textToSpeech?.stop() == TextToSpeech.SUCCESS) {
                isSpeaking.set(false)
                isPaused.set(false)
                
                // Cancel all active speaking jobs and close channels
                speakingJobs.values.forEach { it.cancel() }
                eventChannels.values.forEach { it.close() }
                speakingJobs.clear()
                eventChannels.clear()
                
                invoke.resolve()
            } else {
                invoke.reject("Failed to stop TTS")
            }
        } catch (e: Exception) {
            invoke.reject("Exception while stopping: ${e.message}")
        }
    }
    
    @Command
    fun set_primary_lang(invoke: Invoke) {
        val args = invoke.parseArgs(SetLangArgs::class.java)
        try {
            val locale = Locale.forLanguageTag(args.lang)
            val result = textToSpeech?.setLanguage(locale)
            
            when (result) {
                TextToSpeech.LANG_AVAILABLE,
                TextToSpeech.LANG_COUNTRY_AVAILABLE,
                TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE -> {
                    currentLang.set(args.lang)
                    invoke.resolve()
                }
                else -> {
                    invoke.reject("Language not supported: ${args.lang}")
                }
            }
        } catch (e: Exception) {
            invoke.reject("Exception setting language: ${e.message}")
        }
    }
    
    @Command
    fun set_rate(invoke: Invoke) {
        val args = invoke.parseArgs(SetRateArgs::class.java)
        try {
            currentRate.set(args.rate)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception setting rate: ${e.message}")
        }
    }
    
    @Command
    fun set_pitch(invoke: Invoke) {
        val args = invoke.parseArgs(SetPitchArgs::class.java)
        try {
            currentPitch.set(args.pitch)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Exception setting pitch: ${e.message}")
        }
    }
    
    @Command
    fun set_voice(invoke: Invoke) {
        val args = invoke.parseArgs(SetVoiceArgs::class.java)
        try {
            val voices = textToSpeech?.voices
            val targetVoice = voices?.find { it.name == args.voice }
            
            if (targetVoice != null) {
                val result = textToSpeech?.setVoice(targetVoice)
                if (result == TextToSpeech.SUCCESS) {
                    currentVoiceId.set(args.voice)
                    invoke.resolve()
                } else {
                    invoke.reject("Failed to set voice: ${args.voice}")
                }
            } else {
                invoke.reject("Voice not found: ${args.voice}")
            }
        } catch (e: Exception) {
            invoke.reject("Exception setting voice: ${e.message}")
        }
    }
    
    @Command
    fun get_all_voices(invoke: Invoke) {
        try {
            val voices = textToSpeech?.voices?.map { voice ->
                JSObject().apply {
                    put("id", voice.name)
                    put("name", voice.name)
                    put("lang", voice.locale.toLanguageTag())
                    put("disabled", false)
                }
            } ?: emptyList()
            
            val result = JSObject().apply {
                put("voices", JSONArray(voices))
            }
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("Exception getting voices: ${e.message}")
        }
    }
    
    @Command
    fun get_voices(invoke: Invoke) {
        val args = invoke.parseArgs(GetVoicesArgs::class.java)
        try {
            val locale = Locale.forLanguageTag(args.lang)
            val voices = textToSpeech?.voices?.filter { voice ->
                voice.locale.language == locale.language
            }?.map { voice ->
                JSObject().apply {
                    put("id", voice.name)
                    put("name", voice.name)
                    put("lang", voice.locale.toLanguageTag())
                    put("disabled", false)
                }
            } ?: emptyList()
            
            val result = JSObject().apply {
                put("voices", JSONArray(voices))
            }
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("Exception getting voices for language: ${e.message}")
        }
    }
    
    @Command
    fun get_granularities(invoke: Invoke) {
        try {
            val granularities = TTSGranularity.values().map { it.value }
            val result = JSObject().apply {
                put("granularities", JSONArray(granularities))
            }
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("Exception getting granularities: ${e.message}")
        }
    }
    
    @Command
    fun get_voice_id(invoke: Invoke) {
        try {
            val result = JSObject().apply {
                put("voiceId", currentVoiceId.get())
            }
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("Exception getting voice ID: ${e.message}")
        }
    }
    
    @Command
    fun get_speaking_lang(invoke: Invoke) {
        try {
            val result = JSObject().apply {
                put("lang", currentLang.get())
            }
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject("Exception getting speaking language: ${e.message}")
        }
    }
    
    fun destroy() {
        coroutineScope.cancel()
        textToSpeech?.shutdown()
        eventChannels.values.forEach { it.close() }
        eventChannels.clear()
        speakingJobs.values.forEach { it.cancel() }
        speakingJobs.clear()
    }
}

// Data classes for command arguments
data class SpeakArgs(
    val ssml: String,
    val preload: Boolean? = false
)

data class SetLangArgs(
    val lang: String
)

data class SetRateArgs(
    val rate: Float
)

data class SetPitchArgs(
    val pitch: Float
)

data class SetVoiceArgs(
    val voice: String
)

data class GetVoicesArgs(
    val lang: String
)