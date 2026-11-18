import AVFoundation
import Foundation
import os

private let coldLog = Logger(subsystem: "com.bilingify.readest", category: "ColdReadAloud")

/// Reads a book aloud natively when CarPlay starts it while the reader
/// WebView is suspended, as it is with the phone locked (#7566). The text and
/// CFIs come from ColdEpubText. Each paragraph's CFI is saved to the book's
/// config the way the reader saves Read Aloud progress, so the reader opens
/// there when it takes over. Main queue only.
final class ColdReadAloud: NSObject, AVSpeechSynthesizerDelegate {
  let bookHash: String
  let title: String
  let author: String
  let coverURL: URL
  private let epubURL: URL
  private let configURL: URL
  private let settingsURL: URL
  private let synthesizer = AVSpeechSynthesizer()
  // Position writes, in order.
  private let io = DispatchQueue(label: "com.bilingify.readest.cold-read-aloud")
  private var segments: [ColdEpubSegment] = []
  private var index = 0
  private var rate = AVSpeechUtteranceDefaultSpeechRate
  private var voice: AVSpeechSynthesisVoice?
  private var utterance: AVSpeechUtterance?
  private var savedCfi: String?
  private var stopped = false
  private(set) var isPlaying = false

  /// Playback started or paused.
  var onChange: (() -> Void)?
  /// The book ended (toReader false), or it is left to the reader (true): it
  /// couldn't be read, or the reader would play its recorded narration
  /// instead. `playing` is whether it was meant to be playing.
  var onEnd: ((_ toReader: Bool, _ playing: Bool) -> Void)?

  /// Nil unless the book has a downloaded EPUB in the default library, and
  /// App Lock is off: only the reader can unlock it.
  init?(bookHash: String, title: String, author: String) {
    guard !bookHash.isEmpty, bookHash.allSatisfy(\.isHexDigit),
      let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
      let bundleId = Bundle.main.bundleIdentifier
    else { return nil }
    // Tauri's app data and config directory on iOS.
    let root = support.appendingPathComponent(bundleId, isDirectory: true)
    let settingsURL = root.appendingPathComponent("settings.json")
    guard let settings = Self.readJSON(settingsURL), settings["pinCodeEnabled"] as? Bool != true
    else { return nil }
    let bookDir = root.appendingPathComponent("Readest/Books/\(bookHash)", isDirectory: true)
    guard
      let epub = (try? FileManager.default.contentsOfDirectory(at: bookDir, includingPropertiesForKeys: nil))?
        .first(where: { $0.pathExtension.lowercased() == "epub" })
    else { return nil }
    self.bookHash = bookHash
    self.title = title
    self.author = author
    epubURL = epub
    coverURL = bookDir.appendingPathComponent("cover.png")
    configURL = bookDir.appendingPathComponent("config.json")
    self.settingsURL = settingsURL
    super.init()
    synthesizer.delegate = self
  }

  /// Reads the book off the main queue, then speaks from where the reader
  /// would resume Read Aloud, at the reader's rate and voice.
  func start() {
    isPlaying = true
    onChange?()
    // Off `io`, so stop() waits only for position writes, never this read.
    DispatchQueue.global(qos: .userInitiated).async {
      let config = Self.readJSON(self.configURL) ?? [:]
      let settings = Self.readJSON(self.settingsURL) ?? [:]
      let book = config["viewSettings"] as? [String: Any] ?? [:]
      let global = settings["globalViewSettings"] as? [String: Any] ?? [:]
      let resume = ColdEpubText.resumeCfi(
        location: config["location"] as? String, ttsLocation: book["ttsLocation"] as? String)
      let userRate = (book["ttsRate"] ?? global["ttsRate"]) as? Double ?? 1
      let voiceId = (book["ttsVoice"] ?? global["ttsVoice"]) as? String ?? ""
      let useNarration = (book["ttsUseNarration"] ?? global["ttsUseNarration"]) as? Bool ?? true
      let speech: ColdEpubSpeech
      do {
        speech = try ColdEpubText.read(url: self.epubURL, resumeCfi: resume)
      } catch {
        coldLog.error("reading \(self.bookHash) failed: \(String(describing: error))")
        DispatchQueue.main.async { self.end(toReader: true) }
        return
      }
      DispatchQueue.main.async {
        guard !self.stopped else { return }
        // The reader plays a book's recorded narration (Media Overlays or a
        // paired audiobook) when it has one; don't synthesize over it.
        if useNarration && (speech.hasMediaOverlays || config["audiobook"] != nil) {
          coldLog.log("\(self.bookHash) has recorded narration; leaving it to the reader")
          return self.end(toReader: true)
        }
        guard !speech.segments.isEmpty else { return self.end(toReader: true) }
        self.segments = speech.segments
        // NativeTTSPlugin.avRate's mapping of the reader's rate.
        self.rate = min(
          max(AVSpeechUtteranceDefaultSpeechRate * Float(userRate), AVSpeechUtteranceMinimumSpeechRate),
          AVSpeechUtteranceMaximumSpeechRate)
        self.voice = Self.voice(id: voiceId, language: speech.language)
        coldLog.log("speaking \(self.bookHash) from \(resume ?? "the start"), \(speech.segments.count) chunks")
        if self.isPlaying { self.speakCurrent() }
      }
    }
  }

  func play() {
    guard !stopped, !isPlaying else { return }
    isPlaying = true
    if !synthesizer.continueSpeaking() && !segments.isEmpty { speakCurrent() }
    onChange?()
  }

  func pause() {
    guard isPlaying else { return }
    isPlaying = false
    synthesizer.pauseSpeaking(at: .immediate)
    onChange?()
  }

  // As the reader's forward and backward: paused stays paused, at the new chunk.
  func skip(_ delta: Int) {
    guard !stopped, !segments.isEmpty else { return }
    index = min(max(index + delta, 0), segments.count - 1)
    if isPlaying {
      speakCurrent()
    } else {
      utterance = nil
      synthesizer.stopSpeaking(at: .immediate)
      save(segments[index].cfi)
    }
  }

  /// Stops for good; the saved position is on disk when this returns.
  func stop() {
    stopped = true
    isPlaying = false
    utterance = nil
    synthesizer.stopSpeaking(at: .immediate)
    // Written once more, in case the last write failed.
    if !segments.isEmpty {
      savedCfi = nil
      save(segments[index].cfi)
    }
    io.sync {}
  }

  private func speakCurrent() {
    synthesizer.stopSpeaking(at: .immediate)
    let segment = segments[index]
    save(segment.cfi)
    let next = AVSpeechUtterance(string: segment.text)
    next.rate = rate
    next.voice = voice
    utterance = next
    synthesizer.speak(next)
  }

  private func end(toReader: Bool) {
    let playing = isPlaying
    stopped = true
    isPlaying = false
    onEnd?(toReader, playing)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish finished: AVSpeechUtterance) {
    guard finished === utterance, !stopped else { return }
    if index + 1 < segments.count {
      index += 1
      if isPlaying { speakCurrent() }
    } else {
      end(toReader: false)
    }
  }

  // The reader's progress write: TTSSessionManager moves `location` with
  // `ttsLocation`, so a reopened book lands on the spoken paragraph.
  private func save(_ cfi: String) {
    guard cfi != savedCfi else { return }
    savedCfi = cfi
    let url = configURL
    io.async {
      do {
        // A config that exists but can't be read is left alone: rewriting it
        // would drop its notes and settings.
        guard var config = Self.readJSON(url) else { throw ColdEpubError("unreadable config") }
        var book = config["viewSettings"] as? [String: Any] ?? [:]
        book["ttsLocation"] = cfi
        config["viewSettings"] = book
        config["location"] = cfi
        config["updatedAt"] = Int(Date().timeIntervalSince1970 * 1000)
        try JSONSerialization.data(withJSONObject: config).write(to: url, options: .atomic)
      } catch {
        coldLog.error("saving the position failed: \(String(describing: error))")
        // Not saved: let the next save of this position try again.
        DispatchQueue.main.async { if self.savedCfi == cfi { self.savedCfi = nil } }
      }
    }
  }

  // Empty when the file is absent, nil when it exists but isn't a JSON object.
  private static func readJSON(_ url: URL) -> [String: Any]? {
    guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  // The reader's voice when it speaks the book's language, else that
  // language's default voice.
  private static func voice(id: String, language: String?) -> AVSpeechSynthesisVoice? {
    let primary = { (code: String) in code.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first }
    if let chosen = AVSpeechSynthesisVoice(identifier: id),
      language.map({ primary($0) == primary(chosen.language) }) ?? true
    {
      return chosen
    }
    return language.flatMap { AVSpeechSynthesisVoice(language: $0) }
  }
}
