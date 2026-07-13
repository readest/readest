import AVFoundation
import MediaPlayer
import Tauri
import UIKit
import os

private let keepAliveLog = Logger(subsystem: "com.bilingify.readest", category: "TTSKeepAlive")

// MARK: - Command arguments (camelCase, decoded from the Rust models)

class SpeakArgs: Decodable {
  let text: String?
  let preload: Bool?
}

class SetRateArgs: Decodable {
  let rate: Float?
}

class SetPitchArgs: Decodable {
  let pitch: Float?
}

class SetVoiceArgs: Decodable {
  let voice: String?
}

class UpdateMediaSessionMetadataArgs: Decodable {
  let title: String?
  let artist: String?
  let album: String?
  let artwork: String?
}

struct UpdateCarPlayStateArgs: Decodable {
  let active: Bool?
  let title: String?
  let author: String?
}

class UpdateMediaSessionStateArgs: Decodable {
  let playing: Bool?
  let position: Double?  // milliseconds
  let duration: Double?  // milliseconds
}

class SetMediaSessionActiveArgs: Decodable {
  let active: Bool?
  let notificationTitle: String?
  let notificationText: String?
  let foregroundServiceTitle: String?
  let foregroundServiceText: String?
}

struct PlayoutEnqueueArgs: Decodable {
  let session: Int
  let index: Int
  let data: String  // base64 MP3
  let gapMs: Double?
}

struct PlayoutControlArgs: Decodable {
  // 'start-session' | 'end-session' | 'abort' | 'pause' | 'resume' | 'set-rate'
  let action: String
  let rate: Double?
}

struct PlayoutEnqueueResponse: Encodable {
  let durationMs: Double
}

struct PlayoutControlResponse: Encodable {
  let session: Int?
}

struct PlayoutPositionResponse: Encodable {
  let session: Int
  let index: Int
  let positionMs: Double
  let playing: Bool
}

// MARK: - Command responses (camelCase, re-decoded by the Rust models)

struct InitResponse: Encodable {
  let success: Bool
}

struct SpeakResponse: Encodable {
  let utteranceId: String
}

struct VoiceData: Encodable {
  let id: String
  let name: String
  let lang: String
  let disabled: Bool
}

struct GetVoicesResponse: Encodable {
  let voices: [VoiceData]
}

/// Native iOS Text-to-Speech backed by `AVSpeechSynthesizer`, mirroring the
/// Android `NativeTTSPlugin` (Android `TextToSpeech`). The shared TypeScript
/// `NativeTTSClient` drives both platforms through the same plugin command and
/// `tts_events` channel contract.
class NativeTTSPlugin: Plugin, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()

  // App-level controls. `rate` arrives pre-curved by the JS client (see
  // `avRate(from:)`); `pitch` is a direct multiplier (1.0 == normal).
  private var currentRate: Float = 1.0
  private var currentPitch: Float = 1.0
  private var currentVoiceId: String = ""

  // Maps a live utterance to the UUID the JS client awaits, so delegate
  // callbacks can route `tts_events` to the right async iterator.
  private var utteranceIds = [ObjectIdentifier: String]()

  // Remote command targets we registered. The lock-screen command center
  // (`MPRemoteCommandCenter.shared()`) is app-global and also used by
  // native-bridge's hardware media-key page-turn handler, so we keep the exact
  // tokens and remove only our own on teardown.
  private var remoteCommandTargets: [(MPRemoteCommand, Any)] = []
  private var mediaSessionActive = false

  // Audio-session interruption + route-change observers (registered while the
  // media session is active). .spokenAudio is a two-way contract: navigation
  // prompts PAUSE us instead of ducking, and the interruption-ended
  // notification's .shouldResume flag is our cue to resume — iOS never
  // restarts the audio itself.
  private var audioSessionObservers: [NSObjectProtocol] = []

  // Timestamp of our own audio-session operations (claim/bounce). The system
  // reacts to these with interruption notifications / pause commands aimed at
  // the app itself; pause-like events inside this shadow window are
  // self-inflicted churn, not user intent (device iOS 18.7: TTS died after
  // one sentence — a pause landed right after the claim/re-claim at speech
  // start). Real interruptions and user taps land outside the window.
  private var lastSessionOpTime = Date.distantPast
  // Rate limit for the category tug-of-war with WebKit.
  private var lastReclaimTime = Date.distantPast
  // .ended is only acted on when its .began was actually forwarded to JS —
  // an interruption can outlast any time window (a phone call), so the pair
  // is matched by this flag, not by time.
  private var interruptionForwarded = false

  private func withinSessionOpWindow() -> Bool {
    return Date().timeIntervalSince(lastSessionOpTime) < 2.0
  }


  // Silent in-process keep-alive. TTS audio renders inside WebKit's media
  // process, so the app's own audio session never carries sound and MediaRemote
  // keeps the client's playback state at Paused — which makes the lock screen
  // drop the now-playing card entirely (CarPlay's template UI still renders).
  // A looping silent player in the app process, played/paused in lockstep with
  // TTS, keeps the app's audio session genuinely active — the same trick the
  // Android MediaPlaybackService uses with its silence.mp3 keep-alive. The
  // Playing/Paused DECLARATION happens separately via setSystemPlaybackState
  // (audio activity alone provably does not flip the MediaRemote client).
  private var keepAlivePlayer: AVAudioPlayer?
  private var keepAliveQueuePlayer: AVQueuePlayer?
  private var keepAliveLooper: AnyObject?

  // Publishes to the MPNowPlayingSession's centers once the session is bound
  // to the real playout AVPlayer (see bindNowPlayingSession), falling back to
  // the default center before that / pre-iOS-16. Info, commands, and player
  // state must all live on ONE MediaRemote player surface — splitting them
  // renders a card without transport buttons.
  private func activeInfoCenter() -> MPNowPlayingInfoCenter {
    if #available(iOS 16.0, *), let session = nowPlayingSession as? MPNowPlayingSession {
      return session.nowPlayingInfoCenter
    }
    return MPNowPlayingInfoCenter.default()
  }

  // Explicitly declare Playing/Paused to MediaRemote. The playbackState
  // property is macOS-only in the SDK headers, but the accessor exists in the
  // iOS runtime — and it is the ONLY lever that flips the client's playback
  // state here: audio activity (a playing in-process AVQueuePlayer), rate-1
  // nowPlayingInfo, an active MPNowPlayingSession, and remote-control
  // registration all provably leave the client Paused, and a Paused client
  // never gets a lock-screen card. Guarded by responds(to:) so a runtime that
  // drops the accessor degrades to the old (card-less) behavior, not a crash.
  // MPNowPlayingPlaybackState: playing = 1, paused = 2, stopped = 3.
  private func setSystemPlaybackState(playing: Bool) {
    setSystemPlaybackStateRaw(playing ? 1 : 2)
  }

  private func setSystemPlaybackStateRaw(_ state: Int) {
    // SIMULATOR ONLY. On the sim the KVC playbackState write is THE lever
    // that flips the MediaRemote client to Playing (nothing else does). On a
    // REAL device it is inert for Playing (state is inferred from session
    // audio) but NOT inert for Paused: writing paused/stopped momentarily
    // flips CanBeNowPlayingPlayer to false, which vacates the
    // ActiveNowPlayingClient slot — the card dismissed on pause and AirPod
    // play fell through to another app (device log 2026-07-13 10:21:18).
    #if targetEnvironment(simulator)
      let center = activeInfoCenter()
      guard center.responds(to: NSSelectorFromString("setPlaybackState:")) else { return }
      center.setValue(NSNumber(value: state), forKey: "playbackState")
    #endif
  }

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  // MARK: - Lifecycle

  // The "init" command maps to the Objective-C selector `init:`; `init` is a
  // Swift reserved word, so the method is named `initialize` and exposed under
  // the expected selector.
  @objc(init:)
  public func initialize(_ invoke: Invoke) {
    // AVSpeechSynthesizer and its voice list are available synchronously; there
    // is no engine handshake to await as there is on Android.
    invoke.resolve(InitResponse(success: true))
  }

  // MARK: - Speech

  @objc public func speak(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SpeakArgs.self)
      let text = args.text ?? ""
      if text.isEmpty {
        invoke.reject("Text cannot be empty")
        return
      }

      let utteranceId = UUID().uuidString
      let rate = currentRate
      let pitch = currentPitch
      let voiceId = currentVoiceId

      // Resolve immediately with the id; events stream over `tts_events`.
      invoke.resolve(SpeakResponse(utteranceId: utteranceId))

      DispatchQueue.main.async {
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = self.avRate(from: rate)
        utterance.pitchMultiplier = self.avPitch(from: pitch)
        // Each sentence is a separate utterance spoken after a gap, so the audio
        // route goes cold between them and the first word can be clipped. A small
        // pre-utterance delay plays silence first to warm the route. See #4676.
        utterance.preUtteranceDelay = 0.1
        if !voiceId.isEmpty, let voice = AVSpeechSynthesisVoice(identifier: voiceId) {
          utterance.voice = voice
        }
        self.utteranceIds[ObjectIdentifier(utterance)] = utteranceId
        self.synthesizer.speak(utterance)
      }
    } catch {
      invoke.reject("Failed to start speaking: \(error.localizedDescription)")
    }
  }

  @objc public func pause(_ invoke: Invoke) {
    // Mirror Android: pause is implemented as stop. The JS client returns
    // `false` from pause(), so the controller stops and re-speaks the current
    // sentence on resume.
    DispatchQueue.main.async {
      self.synthesizer.stopSpeaking(at: .immediate)
    }
    invoke.resolve()
  }

  @objc public func resume(_ invoke: Invoke) {
    // No-op, mirroring Android; the controller re-speaks on resume.
    invoke.resolve()
  }

  @objc public func stop(_ invoke: Invoke) {
    DispatchQueue.main.async {
      self.synthesizer.stopSpeaking(at: .immediate)
      self.utteranceIds.removeAll()
    }
    invoke.resolve()
  }

  @objc public func set_rate(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SetRateArgs.self)
      currentRate = args.rate ?? 1.0
      invoke.resolve()
    } catch {
      invoke.reject("Exception setting rate: \(error.localizedDescription)")
    }
  }

  @objc public func set_pitch(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SetPitchArgs.self)
      currentPitch = args.pitch ?? 1.0
      invoke.resolve()
    } catch {
      invoke.reject("Exception setting pitch: \(error.localizedDescription)")
    }
  }

  @objc public func set_voice(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SetVoiceArgs.self)
      currentVoiceId = args.voice ?? ""
      invoke.resolve()
    } catch {
      invoke.reject("Exception setting voice: \(error.localizedDescription)")
    }
  }

  @objc public func get_all_voices(_ invoke: Invoke) {
    let systemVoices = AVSpeechSynthesisVoice.speechVoices()

    // The JS layer groups voices by primary language (isSameLang), so the same
    // display name can appear twice in one "System TTS" list when a voice exists
    // in multiple regions of the same language (e.g. the Eloquence "Rocko" in
    // both en-US and en-GB). Count (primaryLanguage, displayName) pairs and, for
    // any that collide, append the region so users can tell them apart.
    var nameCounts: [String: Int] = [:]
    for voice in systemVoices {
      let key = "\(primaryLanguage(voice.language))|\(displayName(for: voice))"
      nameCounts[key, default: 0] += 1
    }

    let voices = systemVoices.map { voice -> VoiceData in
      let baseName = displayName(for: voice)
      let key = "\(primaryLanguage(voice.language))|\(baseName)"
      let name =
        (nameCounts[key] ?? 0) > 1
        ? "\(baseName) (\(regionDescription(for: voice.language)))"
        : baseName
      return VoiceData(
        id: voice.identifier,
        name: name,
        lang: voice.language,
        disabled: false
      )
    }
    invoke.resolve(GetVoicesResponse(voices: voices))
  }

  // MARK: - AVSpeechSynthesizerDelegate

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance
  ) {
    if let id = utteranceIds[ObjectIdentifier(utterance)] {
      sendEvent(utteranceId: id, code: "boundary", message: "start")
    }
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance
  ) {
    if let id = utteranceIds.removeValue(forKey: ObjectIdentifier(utterance)) {
      sendEvent(utteranceId: id, code: "end")
    }
  }

  func speechSynthesizer(
    _ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance
  ) {
    // Cancellation comes from stop()/pause(). Do NOT emit "end": the controller
    // treats a finished utterance as a cue to advance, which must not happen on
    // a manual stop or pause (mirrors Android, where stop() emits no onDone).
    utteranceIds.removeValue(forKey: ObjectIdentifier(utterance))
  }

  // MARK: - Media session (lock screen / now playing)

  @objc public func set_media_session_active(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(SetMediaSessionActiveArgs.self)
      let active = args.active ?? true
      DispatchQueue.main.async {
        if active {
          self.activateRemoteCommands()
        } else {
          self.deactivateRemoteCommands()
        }
      }
      invoke.resolve()
    } catch {
      invoke.reject("Failed to set media session active state: \(error.localizedDescription)")
    }
  }

  @objc public func update_media_session_state(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(UpdateMediaSessionStateArgs.self)
      let playing = args.playing ?? false
      let position = args.position
      let duration = args.duration
      DispatchQueue.main.async {
        // DIAGNOSTIC (remove before release): per-push session snapshot, to
        // see when WebKit steals the category back and what state we run in.
        let snap = AVAudioSession.sharedInstance()
        keepAliveLog.log(
          "state push: playing=\(playing) cat=\(snap.category.rawValue) opts=\(snap.categoryOptions.rawValue) rate=\(self.keepAliveQueuePlayer?.rate ?? -1)"
        )
        // The keep-alive must mirror play/pause: MediaRemote derives the
        // client's Playing/Paused from the app's actual audio activity, and
        // the lock screen only surfaces a Playing client.
        self.setKeepAlivePlaying(playing)
        let center = self.activeInfoCenter()
        var info = center.nowPlayingInfo ?? [String: Any]()
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        // Declare pausable audio content: live streams are the documented case
        // where the lock-screen card OMITS the play/pause button entirely, so
        // both keys are set explicitly rather than left to defaults.
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        info[MPNowPlayingInfoPropertyIsLiveStream] = false
        if let position = position {
          info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position / 1000.0
        }
        if let duration = duration, duration > 0 {
          info[MPMediaItemPropertyPlaybackDuration] = duration / 1000.0
        }
        center.nowPlayingInfo = info
        self.setSystemPlaybackState(playing: playing)
      }
      invoke.resolve()
    } catch {
      invoke.reject("Failed to update playback state: \(error.localizedDescription)")
    }
  }

  @objc public func update_media_session_metadata(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(UpdateMediaSessionMetadataArgs.self)
      let title = args.title ?? ""
      let artist = args.artist ?? ""
      let album = args.album ?? ""
      let artwork = args.artwork

      DispatchQueue.main.async {
        let center = self.activeInfoCenter()
        var info = center.nowPlayingInfo ?? [String: Any]()
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = artist
        info[MPMediaItemPropertyAlbumTitle] = album
        center.nowPlayingInfo = info
      }

      // Artwork usually arrives as a base64 data URI; decode off the main thread
      // and apply it once ready so it does not block command handling.
      if let artwork = artwork {
        DispatchQueue.global(qos: .userInitiated).async {
          guard let image = self.loadImage(from: artwork) else { return }
          let mpArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
          DispatchQueue.main.async {
            let center = self.activeInfoCenter()
            var info = center.nowPlayingInfo ?? [String: Any]()
            info[MPMediaItemPropertyArtwork] = mpArtwork
            center.nowPlayingInfo = info
          }
        }
      }

      invoke.resolve()
    } catch {
      invoke.reject("Failed to update metadata: \(error.localizedDescription)")
    }
  }

  // CarPlay-only signal. Deliberately does NOT touch MPRemoteCommandCenter,
  // the audio session, or MPNowPlayingInfoCenter (those stay owned by the
  // WebView navigator.mediaSession path, see #4676). It only records the
  // current now-reading state for the CarPlay scene delegate and pings it to
  // refresh its root list.
  @objc public func update_carplay_state(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(UpdateCarPlayStateArgs.self)
      let active = args.active ?? false
      let defaults = UserDefaults.standard
      defaults.set(active, forKey: "readest.carplay.active")
      defaults.set(args.title ?? "", forKey: "readest.carplay.title")
      defaults.set(args.author ?? "", forKey: "readest.carplay.author")
      DispatchQueue.main.async {
        NotificationCenter.default.post(
          name: Notification.Name("readestCarPlayStateChanged"), object: nil)
      }
      invoke.resolve()
    } catch {
      invoke.reject("Failed to update CarPlay state: \(error.localizedDescription)")
    }
  }

  // MARK: - Permissions

  // iOS lock-screen / now-playing needs no runtime permission. Resolve the
  // Android-style postNotification permission as granted so the shared JS media
  // session code does not try to prompt.
  @objc public override func checkPermissions(_ invoke: Invoke) {
    invoke.resolve(["postNotification": "granted"])
  }

  @objc public override func requestPermissions(_ invoke: Invoke) {
    invoke.resolve(["postNotification": "granted"])
  }

  // MARK: - Helpers

  private func sendEvent(
    utteranceId: String, code: String, message: String? = nil, mark: String? = nil
  ) {
    var data: JSObject = ["utteranceId": utteranceId, "code": code]
    if let message = message {
      data["message"] = message
    }
    if let mark = mark {
      data["mark"] = mark
    }
    trigger("tts_events", data: data)
  }

  // Claim the shared audio session as NON-mixable .playback — the documented
  // shape of a media app. This is sound now because the TTS audio genuinely
  // renders in the app process (native playout AVPlayer for Edge voices,
  // AVSpeechSynthesizer for system voices): the session that owns Now Playing
  // is the session carrying the audio, so election, pause-hold, AirPods
  // routing, and mute-switch immunity all behave like any music app. (The
  // WebAudio era needed mixable + navigator.audioSession games because the
  // audio lived in WebKit's GPU process — see git history of this comment.)
  private func claimAudioSession() {
    let session = AVAudioSession.sharedInstance()
    keepAliveLog.log(
      "audio session before claim: category=\(session.category.rawValue) options=\(session.categoryOptions.rawValue) mode=\(session.mode.rawValue)"
    )
    do {
      try session.setCategory(.playback, mode: .spokenAudio, options: [])
      try session.setActive(true)
    } catch {
      keepAliveLog.error("audio session claim failed: \(error.localizedDescription)")
    }
    keepAliveLog.log(
      "audio session after claim: category=\(session.category.rawValue) options=\(session.categoryOptions.rawValue)"
    )
    lastSessionOpTime = Date()
    // Tell native-bridge's VolumeKeyHandler we own the shared session, so its
    // interception rides it as-is instead of flipping it to .mixWithOthers
    // (which would vacate the Now Playing slot).
    NotificationCenter.default.post(
      name: Notification.Name("ReadestTTSAudioSessionClaimed"), object: nil)
  }

  // WebKit may re-grab the shared session for unrelated web audio (dict
  // pronunciation); cheap re-assert on every state push. Returns whether a
  // re-claim happened so the caller can kick a re-election.
  @discardableResult
  private func reassertAudioSessionIfNeeded() -> Bool {
    let session = AVAudioSession.sharedInstance()
    guard session.category != .playback || !session.categoryOptions.isEmpty else {
      return false
    }
    // Rate-limit the tug-of-war: if WebKit persistently re-grabs, reclaiming
    // on every state push would churn the session once per sentence.
    guard Date().timeIntervalSince(lastReclaimTime) >= 10.0 else {
      return false
    }
    lastReclaimTime = Date()
    claimAudioSession()
    return true
  }

  // Interruptions and route changes are forwarded through the SAME plugin
  // events as lock-screen taps, so pause/resume runs the full TTSController
  // path in JS (WebAudio suspend/resume, position, card state) instead of a
  // native side channel the webview would drift from.
  private func addAudioSessionObservers() {
    if !audioSessionObservers.isEmpty { return }
    let nc = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    audioSessionObservers.append(
      nc.addObserver(
        forName: AVAudioSession.interruptionNotification, object: session, queue: .main
      ) { [weak self] note in
        self?.handleAudioSessionInterruption(note)
      })
    audioSessionObservers.append(
      nc.addObserver(
        forName: AVAudioSession.routeChangeNotification, object: session, queue: .main
      ) { [weak self] note in
        self?.handleAudioRouteChange(note)
      })
  }

  private func removeAudioSessionObservers() {
    for observer in audioSessionObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    audioSessionObservers.removeAll()
  }

  private func handleAudioSessionInterruption(_ note: Notification) {
    guard let info = note.userInfo,
      let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: typeRaw)
    else { return }
    switch type {
    case .began:
      if withinSessionOpWindow() {
        keepAliveLog.log("interruption began IGNORED (self-inflicted session op)")
        return
      }
      interruptionForwarded = true
      keepAliveLog.log("interruption began")
      triggerMediaSession("media-session-pause")
    case .ended:
      let optionsRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
      let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw)
        .contains(.shouldResume)
      let wasForwarded = interruptionForwarded
      interruptionForwarded = false
      keepAliveLog.log("interruption ended shouldResume=\(shouldResume) forwarded=\(wasForwarded)")
      guard wasForwarded, shouldResume else { return }
      // The interruption deactivated our session; reclaim before resuming.
      claimAudioSession()
      triggerMediaSession("media-session-play")
    @unknown default:
      break
    }
  }

  private func handleAudioRouteChange(_ note: Notification) {
    guard let info = note.userInfo,
      let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw),
      reason == .oldDeviceUnavailable
    else { return }
    // Headphones unplugged / Bluetooth dropped: pause, never auto-resume —
    // otherwise spoken audio blasts from the speaker.
    keepAliveLog.log("route lost (oldDeviceUnavailable)")
    triggerMediaSession("media-session-pause")
  }

  private func activateRemoteCommands() {
    if mediaSessionActive {
      return
    }
    mediaSessionActive = true
    // Classic registration for the system now-playing surfaces; without it
    // some iOS versions never consider the app a remote-control candidate.
    UIApplication.shared.beginReceivingRemoteControlEvents()
    claimAudioSession()
    addAudioSessionObservers()
    startKeepAlive()
    registerRemoteCommands(on: activeCommandCenter())
  }

  private func registerRemoteCommands(on center: MPRemoteCommandCenter) {

    center.playCommand.isEnabled = true
    addRemoteTarget(center.playCommand) { [weak self] _ in
      keepAliveLog.log("playCommand")
      self?.triggerMediaSession("media-session-play")
      return .success
    }
    center.pauseCommand.isEnabled = true
    addRemoteTarget(center.pauseCommand) { [weak self] _ in
      guard let self = self else { return .success }
      // The system fires pause commands at the now-playing client when its
      // audio session churns — including churn WE cause (claim/bounce).
      if self.withinSessionOpWindow() {
        keepAliveLog.log("pauseCommand IGNORED (session-op window)")
        return .success
      }
      keepAliveLog.log("pauseCommand")
      self.triggerMediaSession("media-session-pause")
      return .success
    }
    // The lock screen shows a single play/pause button; it gets its own event
    // because JS 'play'/'pause' are directional (audio-focus events reuse
    // them) while this one genuinely toggles.
    center.togglePlayPauseCommand.isEnabled = true
    addRemoteTarget(center.togglePlayPauseCommand) { [weak self] _ in
      guard let self = self else { return .success }
      if self.withinSessionOpWindow() {
        keepAliveLog.log("toggleCommand IGNORED (session-op window)")
        return .success
      }
      keepAliveLog.log("toggleCommand")
      self.triggerMediaSession("media-session-toggle")
      return .success
    }
    center.nextTrackCommand.isEnabled = true
    addRemoteTarget(center.nextTrackCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-next")
      return .success
    }
    center.previousTrackCommand.isEnabled = true
    addRemoteTarget(center.previousTrackCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-previous")
      return .success
    }
    // Skip-interval commands are what the lock-screen card actually renders as
    // side-button ICONS (track prev/next alone left the button row blank while
    // still hit-testable); they are also the audiobook-style UX (Apple Books
    // shows the same). Routed to the sentence-level seek handlers in JS.
    center.skipBackwardCommand.isEnabled = true
    center.skipBackwardCommand.preferredIntervals = [10]
    addRemoteTarget(center.skipBackwardCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-seek-backward")
      return .success
    }
    center.skipForwardCommand.isEnabled = true
    center.skipForwardCommand.preferredIntervals = [10]
    addRemoteTarget(center.skipForwardCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-seek-forward")
      return .success
    }
  }

  // Single surface (see activeInfoCenter): commands live on the shared center,
  // same client surface as the default info center's player.
  private func activeCommandCenter() -> MPRemoteCommandCenter {
    if #available(iOS 16.0, *), let session = nowPlayingSession as? MPNowPlayingSession {
      return session.remoteCommandCenter
    }
    return MPRemoteCommandCenter.shared()
  }

  // MPNowPlayingSession bound to the REAL playout AVPlayer (iOS 16+). The
  // system observes the player and reports EXPLICIT Playing/Paused to
  // MediaRemote — an inferred-only client evaporates from the Now Playing
  // slot the moment its audio pauses (device log 2026-07-13: pause nulled
  // inferredNowPlayingClient and the slot fell to another app). The earlier
  // sim-era attempt split item/commands across two MediaRemote players
  // because there was NO real player; binding the actual audio player keeps
  // one coherent surface. Stored as AnyObject: iOS 16 API, pre-16 fallback
  // stays on the default center.
  private var nowPlayingSession: AnyObject?

  private func bindNowPlayingSession(to player: AVPlayer) {
    guard #available(iOS 16.0, *) else { return }
    guard nowPlayingSession == nil, mediaSessionActive else { return }
    let session = MPNowPlayingSession(players: [player])
    session.automaticallyPublishesNowPlayingInfo = false
    // Carry already-published metadata over from the default center, then
    // move the command targets to the session's center.
    session.nowPlayingInfoCenter.nowPlayingInfo = MPNowPlayingInfoCenter.default().nowPlayingInfo
    nowPlayingSession = session
    for (command, token) in remoteCommandTargets {
      command.removeTarget(token)
    }
    remoteCommandTargets.removeAll()
    registerRemoteCommands(on: session.remoteCommandCenter)
    session.becomeActiveIfPossible()
    keepAliveLog.log("now-playing session bound to playout player")
  }

  private func deactivateRemoteCommands() {
    for (command, token) in remoteCommandTargets {
      command.removeTarget(token)
    }
    remoteCommandTargets.removeAll()
    // Clear the SESSION's info center before tearing the session down, then
    // the default one too (pre-iOS-16 path / belt and braces).
    setSystemPlaybackStateRaw(3)  // stopped
    activeInfoCenter().nowPlayingInfo = nil
    removeAudioSessionObservers()
    stopKeepAlive()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    // Release the claimed session so interrupted apps get their resume signal;
    // best-effort (WebKit re-activates on demand for other in-app web audio).
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    // Counterpart to the Claimed post in claimAudioSession: a live volume-key
    // interception re-owns the session (mixable) when it hears this.
    NotificationCenter.default.post(
      name: Notification.Name("ReadestTTSAudioSessionReleased"), object: nil)
    UIApplication.shared.endReceivingRemoteControlEvents()
    nowPlayingSession = nil
    mediaSessionActive = false
  }

  // MARK: - Silent keep-alive (see keepAlivePlayer)

  // One second of 16-bit mono audio as an in-memory WAV — no bundled asset
  // needed, and the players loop it forever. amplitude 0 = silence.
  // DIAGNOSTIC: a non-zero amplitude renders an audible 440 Hz tone, used to
  // test whether the device's now-playing inference requires AUDIBLE session
  // output (Apple discounts silent output as an anti-fake-now-playing
  // heuristic). Must be 0 in any shipping build.
  private func makeSilentWavData(sampleRate: Int = 8000, amplitude: Double = 0) -> Data {
    let frames = sampleRate
    let dataSize = frames * 2
    func le32(_ v: Int) -> [UInt8] {
      [UInt8(v & 0xff), UInt8((v >> 8) & 0xff), UInt8((v >> 16) & 0xff), UInt8((v >> 24) & 0xff)]
    }
    func le16(_ v: Int) -> [UInt8] {
      [UInt8(v & 0xff), UInt8((v >> 8) & 0xff)]
    }
    var d = Data()
    d.append(contentsOf: Array("RIFF".utf8))
    d.append(contentsOf: le32(36 + dataSize))
    d.append(contentsOf: Array("WAVE".utf8))
    d.append(contentsOf: Array("fmt ".utf8))
    d.append(contentsOf: le32(16))
    d.append(contentsOf: le16(1)) // PCM
    d.append(contentsOf: le16(1)) // mono
    d.append(contentsOf: le32(sampleRate))
    d.append(contentsOf: le32(sampleRate * 2)) // byte rate
    d.append(contentsOf: le16(2)) // block align
    d.append(contentsOf: le16(16)) // bits per sample
    d.append(contentsOf: Array("data".utf8))
    d.append(contentsOf: le32(dataSize))
    if amplitude > 0 {
      var samples = [UInt8]()
      samples.reserveCapacity(dataSize)
      for i in 0..<frames {
        let v = Int16(amplitude * 32767.0 * sin(2.0 * Double.pi * 440.0 * Double(i) / Double(sampleRate)))
        samples.append(UInt8(truncatingIfNeeded: Int(v) & 0xff))
        samples.append(UInt8(truncatingIfNeeded: (Int(v) >> 8) & 0xff))
      }
      d.append(contentsOf: samples)
    } else {
      d.append(Data(count: dataSize))
    }
    return d
  }

  // DIAGNOSTIC KNOB: 0 = silence (shipping value). Non-zero renders a quiet
  // 440 Hz tone from the keep-alive player, used on-device to prove the
  // now-playing election does NOT hinge on audible output (2026-07-12: tone
  // audible, still no lock card; the gate was the mixable audio session).
  private let keepAliveAmplitude: Double = 0

  // The silent WAV as a temp file: AVPlayer (unlike AVAudioPlayer) needs a URL.
  private func silentWavURL() -> URL? {
    let name = keepAliveAmplitude > 0 ? "tts-keepalive-tone.wav" : "tts-keepalive.wav"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    if !FileManager.default.fileExists(atPath: url.path) {
      do {
        try makeSilentWavData(amplitude: keepAliveAmplitude).write(to: url)
      } catch {
        keepAliveLog.error("wav write failed: \(error.localizedDescription)")
        return nil
      }
    }
    return url
  }

  private func startKeepAlive() {
    if #available(iOS 16.0, *) {
      if keepAliveQueuePlayer == nil, let url = silentWavURL() {
        let player = AVQueuePlayer()
        // Never route the silence to AirPlay-style external UIs.
        player.allowsExternalPlayback = false
        keepAliveLooper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        keepAliveQueuePlayer = player
      }
      keepAliveQueuePlayer?.play()
      keepAliveLog.log("start: rate=\(self.keepAliveQueuePlayer?.rate ?? -1)")
    } else {
      if keepAlivePlayer == nil {
        do {
          keepAlivePlayer = try AVAudioPlayer(
            data: makeSilentWavData(amplitude: keepAliveAmplitude),
            fileTypeHint: AVFileType.wav.rawValue)
          keepAlivePlayer?.numberOfLoops = -1
          keepAlivePlayer?.prepareToPlay()
        } catch {
          keepAliveLog.error("init failed: \(error.localizedDescription)")
          return
        }
      }
      keepAlivePlayer?.play()
    }
  }

  private func stopKeepAlive() {
    if #available(iOS 16.0, *) {
      keepAliveQueuePlayer?.pause()
      (keepAliveLooper as? AVPlayerLooper)?.disableLooping()
      keepAliveQueuePlayer = nil
      keepAliveLooper = nil
    }
    keepAlivePlayer?.stop()
    keepAlivePlayer = nil
    keepAliveLog.log("stopped")
  }

  private func setKeepAlivePlaying(_ playing: Bool) {
    var reclaimed = false
    if playing {
      reclaimed = reassertAudioSessionIfNeeded()
    }
    if let player = keepAliveQueuePlayer {
      if playing {
        if player.rate == 0 {
          player.play()
          keepAliveLog.log("resume (session path)")
        } else if reclaimed {
          // The now-playing election runs on session-audio TRANSITIONS: after
          // winning the category back from WebKit, a continuously-running
          // keep-alive never re-triggers it and the card stays gone. Bounce
          // the player to produce a fresh starts-playing edge.
          player.pause()
          player.play()
          lastSessionOpTime = Date()
          keepAliveLog.log("bounced after reclaim")
        }
      } else if player.rate != 0 {
        // playing == false: pause in lockstep. With MPNowPlayingSession bound
        // to the playout player the paused state is reported EXPLICITLY, so
        // the inferred-from-audio fallback no longer needs silence to keep
        // the slot — and a still-running silent player contradicts the
        // session-observed paused player, which mediaremoted resolves by
        // vacating the client from the Now Playing slot.
        player.pause()
        keepAliveLog.log("paused (session path)")
      }
      return
    }
    guard let player = keepAlivePlayer else { return }
    if playing {
      if !player.isPlaying { player.play() }
    } else if player.isPlaying {
      player.pause()
    }
  }

  private func addRemoteTarget(
    _ command: MPRemoteCommand,
    handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus
  ) {
    let token = command.addTarget(handler: handler)
    remoteCommandTargets.append((command, token))
  }

  private func triggerMediaSession(_ event: String) {
    trigger(event, data: JSObject())
  }

  // MARK: - Native audio playout (Edge TTS)
  //
  // Plays the Edge TTS MP3 utterances with an in-process AVPlayer instead of
  // WebAudio. WebAudio renders in WebKit's GPU process under a session the
  // app cannot own, which made every system media behavior a fight (lock
  // card, pause-hold, AirPods routing, mute switch). With the audio in the
  // app's own non-mixable .playback session, all of them are textbook.
  // The player is deliberately dumb: enqueue/play/pause/rate/position. All
  // orchestration (word boundaries, highlighting, timeline) stays in JS.

  private struct PlayoutItem {
    let index: Int
    let url: URL
    let gapSec: Double
  }

  private var playoutSession = 0
  private var playoutQueue: [PlayoutItem] = []
  private var playoutPlayer: AVPlayer?
  private var playoutCurrentIndex = -1
  private var playoutRate: Float = 1.0
  private var playoutPlaying = false
  private var playoutSessionEnded = false
  private var playoutPendingAdvance = false
  private var playoutGapTimer: Timer?
  private var playoutItemEndObserver: NSObjectProtocol?

  @objc public func playout_control(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PlayoutControlArgs.self)
      DispatchQueue.main.async {
        switch args.action {
        case "start-session":
          self.abortPlayout()
          self.playoutSession += 1
          self.playoutPlaying = true
          invoke.resolve(PlayoutControlResponse(session: self.playoutSession))
        case "end-session":
          self.playoutSessionEnded = true
          // Everything may already have been skipped or finished.
          if self.playoutCurrentIndex == -1 && self.playoutQueue.isEmpty {
            self.emitPlayoutEvent("session-end")
          }
          invoke.resolve(PlayoutControlResponse(session: nil))
        case "abort":
          self.abortPlayout()
          invoke.resolve(PlayoutControlResponse(session: nil))
        case "pause":
          self.playoutPlaying = false
          self.playoutPlayer?.pause()
          invoke.resolve(PlayoutControlResponse(session: nil))
        case "resume":
          self.playoutPlaying = true
          if self.playoutPendingAdvance {
            self.playoutPendingAdvance = false
            self.playoutAdvance()
          } else if self.playoutPlayer?.currentItem != nil {
            self.playoutPlayer?.rate = self.playoutRate
          } else if !self.playoutQueue.isEmpty {
            self.playoutAdvance()
          }
          invoke.resolve(PlayoutControlResponse(session: nil))
        case "set-rate":
          self.playoutRate = Float(args.rate ?? 1.0)
          if self.playoutPlaying, self.playoutPlayer?.currentItem != nil {
            self.playoutPlayer?.rate = self.playoutRate
          }
          invoke.resolve(PlayoutControlResponse(session: nil))
        default:
          invoke.reject("Unknown playout action: \(args.action)")
        }
      }
    } catch {
      invoke.reject("Failed to parse playout control: \(error.localizedDescription)")
    }
  }

  @objc public func playout_enqueue(_ invoke: Invoke) {
    do {
      let args = try invoke.parseArgs(PlayoutEnqueueArgs.self)
      guard let data = Data(base64Encoded: args.data) else {
        invoke.reject("Invalid base64 audio data")
        return
      }
      DispatchQueue.main.async {
        guard args.session == self.playoutSession else {
          invoke.resolve(PlayoutEnqueueResponse(durationMs: 0))
          return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(
          "tts-playout-\(args.session)-\(args.index).mp3")
        do {
          try data.write(to: url)
        } catch {
          invoke.reject("Failed to write audio file: \(error.localizedDescription)")
          return
        }
        // Local file; the synchronous duration load is effectively instant.
        let asset = AVURLAsset(url: url)
        let durationSec = CMTimeGetSeconds(asset.duration)
        self.playoutQueue.append(
          PlayoutItem(index: args.index, url: url, gapSec: (args.gapMs ?? 0) / 1000.0))
        if self.playoutPlaying && self.playoutCurrentIndex == -1 && self.playoutGapTimer == nil {
          self.playoutAdvance()
        }
        invoke.resolve(
          PlayoutEnqueueResponse(durationMs: durationSec.isFinite ? durationSec * 1000.0 : 0))
      }
    } catch {
      invoke.reject("Failed to parse playout enqueue: \(error.localizedDescription)")
    }
  }

  @objc public func playout_position(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let time = self.playoutPlayer?.currentTime()
      let seconds = time.map { CMTimeGetSeconds($0) } ?? 0
      invoke.resolve(
        PlayoutPositionResponse(
          session: self.playoutSession,
          index: self.playoutCurrentIndex,
          positionMs: seconds.isFinite ? seconds * 1000.0 : 0,
          playing: (self.playoutPlayer?.rate ?? 0) != 0
        ))
    }
  }

  private func playoutAdvance() {
    playoutGapTimer?.invalidate()
    playoutGapTimer = nil
    guard !playoutQueue.isEmpty else {
      playoutCurrentIndex = -1
      if playoutSessionEnded {
        emitPlayoutEvent("session-end")
      }
      return
    }
    let item = playoutQueue.removeFirst()
    playoutCurrentIndex = item.index
    if playoutPlayer == nil {
      let player = AVPlayer()
      player.allowsExternalPlayback = false
      playoutPlayer = player
    }
    bindNowPlayingSession(to: playoutPlayer!)
    let playerItem = AVPlayerItem(url: item.url)
    // Pitch-preserving time stretch tuned for voice.
    playerItem.audioTimePitchAlgorithm = .timeDomain
    if let observer = playoutItemEndObserver {
      NotificationCenter.default.removeObserver(observer)
    }
    playoutItemEndObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemDidPlayToEndTime, object: playerItem, queue: .main
    ) { [weak self] _ in
      self?.playoutItemEnded(item)
    }
    playoutPlayer?.replaceCurrentItem(with: playerItem)
    if playoutPlaying {
      playoutPlayer?.playImmediately(atRate: playoutRate)
    }
    emitPlayoutEvent("chunk-start", index: item.index)
  }

  private func playoutItemEnded(_ item: PlayoutItem) {
    try? FileManager.default.removeItem(at: item.url)
    playoutCurrentIndex = -1
    // Inter-sentence gap runs on a native timer so it keeps ticking when the
    // webview's JS timers are throttled in the background.
    if item.gapSec > 0 {
      playoutGapTimer = Timer.scheduledTimer(withTimeInterval: item.gapSec, repeats: false) {
        [weak self] _ in
        guard let self = self else { return }
        self.playoutGapTimer = nil
        if self.playoutPlaying {
          self.playoutAdvance()
        } else {
          self.playoutPendingAdvance = true
        }
      }
    } else if playoutPlaying {
      playoutAdvance()
    } else {
      playoutPendingAdvance = true
    }
  }

  private func abortPlayout() {
    playoutGapTimer?.invalidate()
    playoutGapTimer = nil
    if let observer = playoutItemEndObserver {
      NotificationCenter.default.removeObserver(observer)
      playoutItemEndObserver = nil
    }
    playoutPlayer?.pause()
    playoutPlayer?.replaceCurrentItem(with: nil)
    for item in playoutQueue {
      try? FileManager.default.removeItem(at: item.url)
    }
    playoutQueue.removeAll()
    playoutCurrentIndex = -1
    playoutSessionEnded = false
    playoutPendingAdvance = false
    playoutPlaying = false
  }

  private func emitPlayoutEvent(_ type: String, index: Int? = nil) {
    var data: JSObject = ["type": type, "session": playoutSession]
    if let index = index {
      data["index"] = index
    }
    trigger("playout_events", data: data)
  }

  private func displayName(for voice: AVSpeechSynthesisVoice) -> String {
    switch voice.quality {
    case .enhanced:
      return "\(voice.name) (Enhanced)"
    case .premium:
      return "\(voice.name) (Premium)"
    default:
      return voice.name
    }
  }

  private func primaryLanguage(_ language: String) -> String {
    return String(language.split(separator: "-").first ?? "")
  }

  /// A human-readable region for disambiguating duplicate voice names, e.g.
  /// "en-US" -> "United States". Falls back to the raw subtag, then the full tag.
  private func regionDescription(for language: String) -> String {
    let parts = language.split(separator: "-")
    if parts.count > 1, let regionPart = parts.last {
      let region = String(regionPart)
      return Locale.current.localizedString(forRegionCode: region) ?? region
    }
    return language
  }

  /// Loads artwork from a base64 data URI, a remote URL, or a bundled asset.
  private func loadImage(from urlString: String) -> UIImage? {
    if urlString.hasPrefix("data:image") {
      guard let commaIndex = urlString.firstIndex(of: ",") else {
        return nil
      }
      let base64 = String(urlString[urlString.index(after: commaIndex)...])
      guard let data = Data(base64Encoded: base64) else {
        return nil
      }
      return UIImage(data: data)
    } else if urlString.hasPrefix("http") {
      guard let url = URL(string: urlString), let data = try? Data(contentsOf: url) else {
        return nil
      }
      return UIImage(data: data)
    } else {
      return UIImage(named: urlString)
    }
  }

  /// AVSpeechUtterance rate runs 0...1 with ~0.5 as normal, while the JS client
  /// sends an Android-tuned `pow(userMultiplier, 2.5)` value where 1.0 is
  /// normal. Recover the multiplier and rescale onto the AVSpeechUtterance range.
  private func avRate(from jsRate: Float) -> Float {
    let userMultiplier = pow(max(jsRate, 0.0001), 1.0 / 2.5)
    let mapped = AVSpeechUtteranceDefaultSpeechRate * userMultiplier
    return min(
      max(mapped, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
  }

  /// AVSpeechUtterance pitchMultiplier is clamped to [0.5, 2.0] (1.0 normal).
  private func avPitch(from jsPitch: Float) -> Float {
    return min(max(jsPitch, 0.5), 2.0)
  }
}

@_cdecl("init_plugin_native_tts")
func initPlugin() -> Plugin {
  return NativeTTSPlugin()
}
