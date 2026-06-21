import AVFoundation
import MediaPlayer
import Tauri
import UIKit

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

class UpdateMediaSessionStateArgs: Decodable {
  let playing: Bool?
  let position: Double?  // milliseconds
  let duration: Double?  // milliseconds
}

class SetMediaSessionActiveArgs: Decodable {
  let active: Bool?
  let keepAppInForeground: Bool?
  let notificationTitle: String?
  let notificationText: String?
  let foregroundServiceTitle: String?
  let foregroundServiceText: String?
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
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        if let position = position {
          info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position / 1000.0
        }
        if let duration = duration, duration > 0 {
          info[MPMediaItemPropertyPlaybackDuration] = duration / 1000.0
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
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
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
        info[MPMediaItemPropertyTitle] = title
        info[MPMediaItemPropertyArtist] = artist
        info[MPMediaItemPropertyAlbumTitle] = album
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      }

      // Artwork usually arrives as a base64 data URI; decode off the main thread
      // and apply it once ready so it does not block command handling.
      if let artwork = artwork {
        DispatchQueue.global(qos: .userInitiated).async {
          guard let image = self.loadImage(from: artwork) else { return }
          let mpArtwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
          DispatchQueue.main.async {
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [String: Any]()
            info[MPMediaItemPropertyArtwork] = mpArtwork
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
          }
        }
      }

      invoke.resolve()
    } catch {
      invoke.reject("Failed to update metadata: \(error.localizedDescription)")
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

  private func activateRemoteCommands() {
    if mediaSessionActive {
      return
    }
    mediaSessionActive = true
    let center = MPRemoteCommandCenter.shared()

    center.playCommand.isEnabled = true
    addRemoteTarget(center.playCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-play")
      return .success
    }
    center.pauseCommand.isEnabled = true
    addRemoteTarget(center.pauseCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-pause")
      return .success
    }
    // The lock screen shows a single play/pause button; the controller's "play"
    // handler toggles, so route the toggle command there too.
    center.togglePlayPauseCommand.isEnabled = true
    addRemoteTarget(center.togglePlayPauseCommand) { [weak self] _ in
      self?.triggerMediaSession("media-session-play")
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
  }

  private func deactivateRemoteCommands() {
    for (command, token) in remoteCommandTargets {
      command.removeTarget(token)
    }
    remoteCommandTargets.removeAll()
    MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    mediaSessionActive = false
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
