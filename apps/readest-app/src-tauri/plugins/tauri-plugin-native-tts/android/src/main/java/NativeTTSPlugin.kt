package com.readest.native_tts

import android.Manifest
import android.os.Bundle
import android.app.Activity
import android.content.Context
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.*
import java.net.URL

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

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

@InvokeArg
class SpeakArgs(
    val text: String? = "",
    val preload: Boolean? = false
)

@InvokeArg
class SetRateArgs(
    val rate: Float? = 1.0f
)

@InvokeArg
class SetPitchArgs(
    val pitch: Float? = 1.0f
)

@InvokeArg
class SetVoiceArgs(
    val voice: String? = null
)

@InvokeArg
class UpdateMediaSessionMetadataArgs {
  var title: String? = null
  var artist: String? = null
  var album: String? = null
  var artwork: String? = null
}

@InvokeArg
class UpdateMediaSessionStateArgs {
  var playing: Boolean? = null
  var position: Int? = null // in milliseconds
  var duration: Int? = null // in milliseconds
}

@InvokeArg
class SetMediaSessionActiveArgs {
  var active: Boolean? = null
  var keepAppInForeground: Boolean? = null
  var notificationTitle: String? = null
  var notificationText: String? = null
  var foregroundServiceTitle: String? = null
  var foregroundServiceText: String? = null
}

@TauriPlugin(
  permissions = [
    Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "postNotification")
  ]
)
class NativeTTSPlugin(private val activity: Activity) : Plugin(activity) {
    
    companion object {
        private const val TAG = "NativeTTSPlugin"
        private const val CHANNEL_NAME = "tts_events"
        var NOTIFICATION_TITLE = "Read Aloud"
        var NOTIFICATION_TEXT = "Ready to read aloud"
        var FOREGROUND_SERVICE_TITLE = "Read Aloud"
        var FOREGROUND_SERVICE_TEXT = "Ready to read aloud"
    }
    
    private var textToSpeech: TextToSpeech? = null
    private var isInitialized = AtomicBoolean(false)
    private var isPaused = AtomicBoolean(false)
    private var isSpeaking = AtomicBoolean(false)
    private var currentRate = AtomicReference<Float>(1.0f)
    private var currentPitch = AtomicReference<Float>(1.0f)
    
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
            val preferredEngine = Settings.Secure.getString(
                activity.contentResolver,
                Settings.Secure.TTS_DEFAULT_SYNTH
            )
            textToSpeech = TextToSpeech(activity, { status ->
                when (status) {
                    TextToSpeech.SUCCESS -> {
                        setupTTSListener()
                        isInitialized.set(true)
                        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
                        continuation.resume(true) {}
                    }
                    else -> {
                        Log.e(TAG, "TTS initialization failed with status: $status")
                        @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
                        continuation.resume(false) {}
                    }
                }
            }, preferredEngine)
        } catch (e: Exception) {
            Log.e(TAG, "Exception during TTS initialization", e)
            @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
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

            @Deprecated("deprecated in API level 21")
            override fun onError(utteranceId: String?) {
                utteranceId?.let { id ->
                    isSpeaking.set(false)
                    sendEvent(id, TTSMessageEvent("error", "TTS playback error"))
                    closeEventChannel(id)
                }
            }
            
            override fun onError(utteranceId: String?, errorCode: Int) {
                utteranceId?.let { id ->
                    isSpeaking.set(false)
                    sendEvent(id, TTSMessageEvent("error", "TTS playback error:$errorCode"))
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
        val text = args.text ?: ""
        
        if (text.isEmpty()) {
            invoke.reject("Text cannot be empty")
            return
        }
        
        val utteranceId = UUID.randomUUID().toString()
        
        coroutineScope.launch {
            try {
                val eventChannel = Channel<TTSMessageEvent>(Channel.UNLIMITED)
                eventChannels[utteranceId] = eventChannel
                
                val speakJob = launch {
                    speakText(text, utteranceId, args.preload ?: false)
                }
                speakingJobs[utteranceId] = speakJob
                
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
    
    private suspend fun speakText(text: String, utteranceId: String, preload: Boolean) {
        withContext(Dispatchers.Main) {
            try {
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
            val targetVoice = voices?.find { voice ->
                val languageTag = voice.locale.toLanguageTag()
                voice.name == args.voice || (languageTag.contains(voice.name) && languageTag == args.voice)
            }
            
            if (targetVoice != null) {
                val result = textToSpeech?.setVoice(targetVoice)
                if (result == TextToSpeech.SUCCESS) {
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
                val voiceName = voice.name
                val language = voice.locale.toLanguageTag()
                val (id, name) = if (language.contains(voiceName)) {
                    language to language
                } else {
                    voiceName to voiceName
                }
                JSObject().apply {
                    put("id", id)
                    put("name", name)
                    put("lang", language)
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

    private suspend fun loadArtworkFromUrl(urlString: String): Bitmap? {
        return withContext(Dispatchers.IO) {
            try {
                when {
                    urlString.startsWith("data:image/") -> {
                        val base64Data = urlString.substringAfter("base64,")
                        val decodedBytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
                        BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                    }
                    urlString.startsWith("http") -> {
                        val url = URL(urlString)
                        val input: java.io.InputStream = url.openStream()
                        BitmapFactory.decodeStream(input)
                    }
                    else -> {
                        val assetPath = urlString.removePrefix("/")
                        val inputStream = activity.assets.open(assetPath)
                        BitmapFactory.decodeStream(inputStream)
                    }
                }
            } catch (e: Exception) {
                null
            }
        }
    }

    @Command
    fun update_media_session_metadata(invoke: Invoke) {
        val args = invoke.parseArgs(UpdateMediaSessionMetadataArgs::class.java)
        val title = args.title ?: ""
        val artist = args.artist ?: ""
        val album = args.album ?: ""

        coroutineScope.launch {
            try {
                val artworkBitmap = args.artwork?.let { loadArtworkFromUrl(it) }
                val intent = Intent(activity, MediaPlaybackService::class.java).apply {
                    action = "UPDATE_METADATA"
                    putExtra("title", title)
                    putExtra("artist", artist)
                    putExtra("album", album)
                    putExtra("artwork", artworkBitmap)
                }
                activity.startService(intent)
                invoke.resolve()
            } catch (e: Exception) {
                invoke.reject("Failed to update metadata: ${e.message}")
            }
        }
    }

    @Command
    fun update_media_session_state(invoke: Invoke) {
        var args = invoke.parseArgs(UpdateMediaSessionStateArgs::class.java)
        val isPlaying = args.playing ?: false
        val position = args.position ?: 0
        val duration = args.duration ?: 0

        try {
            val intent = Intent(activity, MediaPlaybackService::class.java).apply {
                action = "UPDATE_PLAYBACK_STATE"
                putExtra("playing", isPlaying)
                putExtra("position", position)
                putExtra("duration", duration)
            }
            activity.startService(intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to update playback state: ${e.message}")
        }
    }

    @Command
    fun set_media_session_active(invoke: Invoke) {
        var args = invoke.parseArgs(SetMediaSessionActiveArgs::class.java)
        val active = args.active ?: true

        args.notificationTitle?.let { NOTIFICATION_TITLE = it }
        args.notificationText?.let { NOTIFICATION_TEXT = it }
        args.foregroundServiceTitle?.let { FOREGROUND_SERVICE_TITLE = it }
        args.foregroundServiceText?.let { FOREGROUND_SERVICE_TEXT = it }

        try {
            val intent = Intent(activity, MediaPlaybackService::class.java)
            if (active) {
                MediaPlaybackService.pluginEventTrigger = { event, data -> trigger(event, data) }
                MediaPlaybackService.currentTitle = FOREGROUND_SERVICE_TITLE
                MediaPlaybackService.currentArtist = FOREGROUND_SERVICE_TEXT
                ContextCompat.startForegroundService(activity, intent)
            } else {
                activity.stopService(intent)
                MediaPlaybackService.pluginEventTrigger = null
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Failed to set media session active state: ${e.message}")
        }
    }
    
    fun destroy() {
        try {
            val intent = Intent(activity, MediaPlaybackService::class.java)
            activity.stopService(intent)

            coroutineScope.cancel()
            textToSpeech?.shutdown()
            eventChannels.values.forEach { it.close() }
            eventChannels.clear()
            speakingJobs.values.forEach { it.cancel() }
            speakingJobs.clear()

            Log.d(TAG, "Plugin destroyed successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error during plugin destruction", e)
        }
    }
}
