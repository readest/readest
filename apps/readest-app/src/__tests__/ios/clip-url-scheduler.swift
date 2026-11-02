import Foundation

// Deterministic stand-ins for the two asynchronous boundaries used by the
// production capture method. The method itself is appended by the Vitest test.
struct DispatchTime {
  let seconds: Double
  static func now() -> DispatchTime { DispatchTime(seconds: DispatchQueue.main.now) }
  static func + (lhs: DispatchTime, rhs: Double) -> DispatchTime {
    DispatchTime(seconds: lhs.seconds + rhs)
  }
}

final class DispatchQueue {
  static var main = DispatchQueue()
  var now = 27.0
  private var pending: [(Double, () -> Void)] = []

  func asyncAfter(deadline: DispatchTime, execute: @escaping () -> Void) {
    pending.append((deadline.seconds, execute))
  }

  func drain() {
    while !pending.isEmpty {
      pending.sort { $0.0 < $1.0 }
      let (time, work) = pending.removeFirst()
      now = time
      work()
    }
  }
}

final class WebView {
  let textAppearsAt: Double?
  private(set) var evaluations = 0

  init(textAppearsAt: Double?) { self.textAppearsAt = textAppearsAt }

  func evaluateJavaScript(_ script: String, completion: (Any?, Error?) -> Void) {
    evaluations += 1
    let ready = textAppearsAt.map { DispatchQueue.main.now >= $0 } ?? false
    completion(ready ? "<article>Late rendered article</article>" : nil, nil)
  }
}

enum CaptureError: Error {
  case timedOut
  case loadFailed(String)
}

final class CaptureHarness {
  let webView: WebView
  var captureFired = false
  var completed = false
  var contentWaitEnded = true
  var outcome = "pending"
  var completions = 0

  init(textAppearsAt: Double?) { webView = WebView(textAppearsAt: textAppearsAt) }

  func finish(_ result: Result<String, CaptureError>) {
    guard !completed else { return }
    completed = true
    completions += 1
    switch result {
    case .success(let html): outcome = html
    case .failure: outcome = "timeout"
    }
  }

  // PRODUCTION_CAPTURE_METHOD

  func run() {
    DispatchQueue.main.asyncAfter(deadline: DispatchTime(seconds: 30)) { [self] in
      finish(.failure(.timedOut))
    }
    captureOuterHtml(requireReady: true)
    DispatchQueue.main.drain()
  }
}

let late = CaptureHarness(textAppearsAt: 28)
late.run()
DispatchQueue.main = DispatchQueue()
let blank = CaptureHarness(textAppearsAt: nil)
blank.run()
print(String(data: try JSONSerialization.data(withJSONObject: [
  "late": late.outcome,
  "lateCompletions": late.completions,
  "blank": blank.outcome,
  "blankCompletions": blank.completions,
  "blankEvaluations": blank.webView.evaluations,
]), encoding: .utf8)!)
