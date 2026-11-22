import Foundation
import Tauri

#if canImport(FoundationModels)
  import FoundationModels
#endif

struct OnDeviceLLMGenerateArgs: Decodable {
  let requestId: String
  let instructions: String
  let prompt: String
  let temperature: Double?
  let maxTokens: Int?
}

struct OnDeviceLLMCancelArgs: Decodable {
  let requestId: String
}

struct OnDeviceLLMFailure: Error, Equatable {
  let message: String
}

/// Apple's on-device model (Foundation Models, iOS 26+) as an offline LLM for
/// translation and the context dictionary (#7429). The app targets iOS 15, so
/// every use sits behind an availability check and the framework links weakly.
enum OnDeviceLLM {
  private static let lock = NSLock()
  private static var tasks: [String: Task<Void, Never>] = [:]
  /// Cancels that arrived before their request started: generate hops to a
  /// blocking thread in Rust, so its cancel can overtake it.
  private static var cancelledEarly: Set<String> = []

  static func status() -> [String: Any] {
    #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
          // Base codes ("zh" for both scripts): JS checks the target language.
          let languages = Set(model.supportedLanguages.compactMap { $0.languageCode?.identifier })
          return [
            "available": true, "contextSize": model.contextSize, "languages": Array(languages).sorted(),
          ]
        case .unavailable(let reason):
          return ["available": false, "reason": String(describing: reason)]
        }
      }
    #endif
    return ["available": false, "reason": "unsupportedOS"]
  }

  /// Why the model can't answer, in words, or nil when it can. The session's
  /// own error for an ineligible device is "The assets required for the
  /// session are unavailable.", which doesn't say what to do.
  static func unavailableMessage(reason: String?) -> String? {
    switch reason {
    case nil: return nil
    case "appleIntelligenceNotEnabled":
      return "Apple Intelligence is turned off. Turn it on in Settings > Apple Intelligence & Siri."
    case "modelNotReady":
      return "The Apple Intelligence model is still downloading. Try again later."
    default:
      return "Apple Intelligence is not available on this device."
    }
  }

  static func generate(_ args: OnDeviceLLMGenerateArgs, invoke: Invoke) {
    let complete: @Sendable (Result<String, OnDeviceLLMFailure>) -> Void = { result in
      switch result {
      case .success(let text): invoke.resolve(["text": text])
      case .failure(let failure): invoke.reject(failure.message)
      }
    }
    if let message = unavailableMessage(reason: status()["reason"] as? String) {
      return complete(.failure(OnDeviceLLMFailure(message: message)))
    }
    #if canImport(FoundationModels)
      if #available(iOS 26.0, *) {
        start(args, completion: complete)
      }
    #endif
  }

  static func cancel(_ requestId: String) {
    lock.lock()
    let task = tasks.removeValue(forKey: requestId)
    if task == nil { cancelledEarly.insert(requestId) }
    lock.unlock()
    task?.cancel()
  }

  #if canImport(FoundationModels)
    /// Runs one request on a session from `makeSession` (the system model
    /// unless a test passes its own), cancellable by `requestId`.
    @available(iOS 26.0, *)
    static func start(
      _ args: OnDeviceLLMGenerateArgs,
      makeSession: @escaping @Sendable (String) -> LanguageModelSession = { instructions in
        // Book text is the user's own content being translated or explained.
        LanguageModelSession(
          model: SystemLanguageModel(guardrails: .permissiveContentTransformations),
          instructions: instructions)
      },
      completion: @escaping @Sendable (Result<String, OnDeviceLLMFailure>) -> Void
    ) {
      // Registered under the lock so a fast reply can't remove its entry first.
      lock.lock()
      if cancelledEarly.remove(args.requestId) != nil {
        lock.unlock()
        return completion(.failure(OnDeviceLLMFailure(message: "Aborted")))
      }
      defer { lock.unlock() }
      tasks[args.requestId] = Task {
        defer { finish(args.requestId) }
        do {
          // A fresh session per request: a session takes one request at a
          // time, and its 4096-token window would fill across lookups.
          let session = makeSession(args.instructions)
          let options = GenerationOptions(
            temperature: args.temperature, maximumResponseTokens: args.maxTokens)
          let response = try await session.respond(to: args.prompt, options: options)
          try Task.checkCancellation()
          completion(.success(response.content))
        } catch {
          let message =
            Task.isCancelled || error is CancellationError
            ? "Aborted" : isContextOverflow(error) ? tooLongMessage : describe(error)
          completion(.failure(OnDeviceLLMFailure(message: message)))
        }
      }
    }
  #endif

  static let tooLongMessage = "The text is too long for Apple Intelligence on this device."

  #if canImport(FoundationModels)
    /// iOS 26 reports an overflow as a session GenerationError, iOS 27 as a LanguageModelError.
    @available(iOS 26.0, *)
    private static func isContextOverflow(_ error: Error) -> Bool {
      if let error = error as? LanguageModelSession.GenerationError,
        case .exceededContextWindowSize = error
      {
        return true
      }
      if #available(iOS 27.0, *), let error = error as? LanguageModelError,
        case .contextSizeExceeded = error
      {
        return true
      }
      return false
    }
  #endif

  private static func finish(_ requestId: String) {
    lock.lock()
    tasks.removeValue(forKey: requestId)
    lock.unlock()
  }

  private static func describe(_ error: Error) -> String {
    if let localized = error as? LocalizedError {
      let parts = [localized.errorDescription, localized.failureReason, localized.recoverySuggestion]
        .compactMap { $0 }
      if !parts.isEmpty { return parts.joined(separator: " ") }
    }
    return String(describing: error)
  }
}
