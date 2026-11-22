import FoundationModels
import XCTest

@testable import tauri_plugin_native_bridge

/// What the stub saw and how it answers, keyed by the model's id: the
/// framework builds the executor from its configuration, not from our instance.
@available(iOS 27.0, *)
final class StubScript: @unchecked Sendable {
  static let shared = StubScript()
  private let lock = NSLock()
  private var replies: [String: @Sendable () async throws -> String] = [:]
  private var requests: [String: LanguageModelExecutorGenerationRequest] = [:]

  func set(_ id: String, reply: @escaping @Sendable () async throws -> String) {
    lock.withLock { replies[id] = reply }
  }
  func reply(_ id: String) -> (@Sendable () async throws -> String)? { lock.withLock { replies[id] } }
  func record(_ id: String, _ request: LanguageModelExecutorGenerationRequest) {
    lock.withLock { requests[id] = request }
  }
  func request(_ id: String) -> LanguageModelExecutorGenerationRequest? { lock.withLock { requests[id] } }
}

@available(iOS 27.0, *)
struct StubModel: LanguageModel {
  typealias Executor = StubExecutor
  let id: String
  var capabilities: LanguageModelCapabilities { LanguageModelCapabilities([]) }
  var executorConfiguration: StubExecutor.Configuration { .init(id: id) }
}

@available(iOS 27.0, *)
struct StubExecutor: LanguageModelExecutor {
  struct Configuration: Hashable, Sendable { let id: String }
  typealias Model = StubModel
  let id: String

  init(configuration: Configuration) throws { id = configuration.id }

  nonisolated(nonsending) func respond(
    to request: LanguageModelExecutorGenerationRequest, model: StubModel,
    streamingInto channel: LanguageModelExecutorGenerationChannel
  ) async throws {
    StubScript.shared.record(id, request)
    let text = try await StubScript.shared.reply(id)!()
    await channel.send(.response(action: .appendText(text, tokenCount: 1)))
  }
}

@available(iOS 27.0, *)
private func texts(of segments: [Transcript.Segment]) -> String {
  segments.compactMap { if case .text(let t) = $0 { t.content } else { nil } }.joined()
}

final class OnDeviceLLMTests: XCTestCase {
  private func run(
    id: String, args: OnDeviceLLMGenerateArgs, whileRunning: () -> Void = {}
  ) throws -> Result<String, OnDeviceLLMFailure> {
    guard #available(iOS 27.0, *) else { throw XCTSkip("custom models need iOS 27") }
    let done = expectation(description: "completion")
    nonisolated(unsafe) var result: Result<String, OnDeviceLLMFailure>?
    OnDeviceLLM.start(
      args,
      makeSession: { LanguageModelSession(model: StubModel(id: id), instructions: $0) },
      completion: {
        result = $0
        done.fulfill()
      })
    whileRunning()
    wait(for: [done], timeout: 10)
    return try XCTUnwrap(result)
  }

  func testSendsInstructionsPromptAndOptionsToTheModel() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("custom models need iOS 27") }
    StubScript.shared.set("ok") { "Bonjour" }
    let result = try run(
      id: "ok",
      args: .init(
        requestId: "r1", instructions: "Translate into French.", prompt: "Hello",
        temperature: 0.3, maxTokens: 400))
    XCTAssertEqual(result, .success("Bonjour"))

    let request = try XCTUnwrap(StubScript.shared.request("ok"))
    var instructions = ""
    var prompt = ""
    for entry in request.transcript {
      switch entry {
      case .instructions(let i): instructions += texts(of: i.segments)
      case .prompt(let p): prompt += texts(of: p.segments)
      default: break
      }
    }
    XCTAssertEqual(instructions, "Translate into French.")
    XCTAssertEqual(prompt, "Hello")
    XCTAssertEqual(request.generationOptions.temperature, 0.3)
    XCTAssertEqual(request.generationOptions.maximumResponseTokens, 400)
  }

  func testCancelRejectsWithAborted() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("custom models need iOS 27") }
    StubScript.shared.set("slow") {
      try await Task.sleep(for: .seconds(5))
      return "too late"
    }
    let result = try run(
      id: "slow",
      args: .init(requestId: "r2", instructions: "", prompt: "p", temperature: nil, maxTokens: nil),
      whileRunning: {
        // Let the request reach the model before cancelling it.
        let reached = expectation(description: "request reached the model")
        Task {
          while StubScript.shared.request("slow") == nil { try? await Task.sleep(for: .milliseconds(10)) }
          reached.fulfill()
        }
        wait(for: [reached], timeout: 5)
        OnDeviceLLM.cancel("r2")
      })
    XCTAssertEqual(result, .failure(OnDeviceLLMFailure(message: "Aborted")))
  }

  func testCancelBeforeStartNeverAsksTheModel() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("custom models need iOS 27") }
    StubScript.shared.set("early") { "too late" }
    OnDeviceLLM.cancel("r-early")
    let result = try run(
      id: "early",
      args: .init(
        requestId: "r-early", instructions: "", prompt: "p", temperature: nil, maxTokens: nil))
    XCTAssertEqual(result, .failure(OnDeviceLLMFailure(message: "Aborted")))
    XCTAssertNil(StubScript.shared.request("early"))
  }

  func testModelErrorBecomesItsDescription() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("custom models need iOS 27") }
    struct Boom: LocalizedError { var errorDescription: String? { "The model failed." } }
    StubScript.shared.set("fail") { throw Boom() }
    let result = try run(
      id: "fail",
      args: .init(requestId: "r3", instructions: "", prompt: "p", temperature: nil, maxTokens: nil))
    guard case .failure(let failure) = result else { return XCTFail("expected a failure") }
    XCTAssertTrue(failure.message.contains("The model failed."), failure.message)
  }

  func testContextOverflowSaysTheTextIsTooLong() throws {
    guard #available(iOS 27.0, *) else { throw XCTSkip("custom models need iOS 27") }
    let tooLong = "The text is too long for Apple Intelligence on this device."
    StubScript.shared.set("overflow26") {
      throw LanguageModelSession.GenerationError.exceededContextWindowSize(
        .init(debugDescription: "4200 tokens"))
    }
    StubScript.shared.set("overflow27") {
      throw LanguageModelError.contextSizeExceeded(
        .init(contextSize: 4096, tokenCount: 4200, debugDescription: "4200 tokens"))
    }
    for id in ["overflow26", "overflow27"] {
      let result = try run(
        id: id,
        args: .init(requestId: id, instructions: "", prompt: "p", temperature: nil, maxTokens: nil))
      XCTAssertEqual(result, .failure(OnDeviceLLMFailure(message: tooLong)), id)
    }
  }

  func testStatusReportsWindowAndLanguagesOnlyWhenAvailable() throws {
    guard #available(iOS 26.0, *) else { throw XCTSkip("Foundation Models need iOS 26") }
    let status = OnDeviceLLM.status()
    if status["available"] as? Bool == true {
      XCTAssertGreaterThan(status["contextSize"] as? Int ?? 0, 0)
      XCTAssertTrue((status["languages"] as? [String] ?? []).contains("en"))
    } else {
      XCTAssertNil(status["contextSize"])
      XCTAssertNotNil(status["reason"])
    }
  }

  func testUnavailableReasonsReadAsInstructions() {
    XCTAssertNil(OnDeviceLLM.unavailableMessage(reason: nil))
    XCTAssertEqual(
      OnDeviceLLM.unavailableMessage(reason: "appleIntelligenceNotEnabled"),
      "Apple Intelligence is turned off. Turn it on in Settings > Apple Intelligence & Siri.")
    XCTAssertEqual(
      OnDeviceLLM.unavailableMessage(reason: "deviceNotEligible"),
      "Apple Intelligence is not available on this device.")
  }
}
