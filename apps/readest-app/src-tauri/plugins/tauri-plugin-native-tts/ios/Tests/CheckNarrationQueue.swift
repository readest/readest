// Standalone AVFoundation check, runnable on macOS without an iOS app bundle:
// swiftc Sources/ContinuousNarrationQueue.swift Tests/CheckNarrationQueue.swift -o /tmp/check-queue
import AVFoundation
import Foundation

@main enum CheckNarrationQueue {
  static func main() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let first = directory.appendingPathComponent("first.wav").path
    let second = directory.appendingPathComponent("second.wav").path
    try wave().write(to: URL(fileURLWithPath: first))
    try wave().write(to: URL(fileURLWithPath: second))

    let queue = ContinuousNarrationQueue()
    defer { queue.stop() }
    queue.player.isMuted = true
    var transitions = 0
    var ended = false
    queue.onTransition = { path, position in
      precondition(path == second && position >= 0.2 && position < 0.6)
      transitions += 1
    }
    queue.onEnded = { ended = true }
    queue.onError = { preconditionFailure("Native audio failed") }

    try queue.load(path: first, start: 0)
    try queue.queue(path: second, start: 0.2, end: 0.7, after: 0.4)
    // A paused queue must not advance on wall-clock time.
    spin(0.5)
    precondition(transitions == 0)
    queue.player.rate = 1.5
    wait { transitions == 1 }
    precondition(queue.player.rate == 1.5)
    wait { ended }
    print("PASS: native handover, nonzero clip start, pause, and rate")

    // A seek can go back before the queued segment's trimmed opening.
    try queue.load(path: first, start: 0)
    try queue.queue(path: second, start: 0.2, end: 0.7, after: 0.4)
    queue.player.play()
    wait { transitions == 2 }
    queue.player.pause()
    queue.seek(to: 0.05)
    spin(0.1)
    precondition(queue.positionSeconds < 0.2)
    print("PASS: seek before a queued clip's opening")

    try queue.load(path: first, start: 0)
    try queue.queue(path: second, start: 0.2, end: 0.7, after: 0.4)
    queue.cancelNext()
    ended = false
    queue.player.play()
    wait { ended }
    precondition(transitions == 2)
    print("PASS: cancellation removes the queued member")
  }

  private static func wait(_ condition: () -> Bool) {
    let deadline = Date().addingTimeInterval(8)
    while !condition() && Date() < deadline { spin(0.01) }
    precondition(condition(), "Native audio check timed out")
  }
  private static func spin(_ seconds: Double) {
    RunLoop.main.run(until: Date().addingTimeInterval(seconds))
  }
  private static func wave() -> Data {
    var bytes = Data()
    func text(_ value: String) { bytes.append(contentsOf: value.utf8) }
    func number<T: FixedWidthInteger>(_ value: T) {
      var little = value.littleEndian
      withUnsafeBytes(of: &little) { bytes.append(contentsOf: $0) }
    }
    text("RIFF"); number(UInt32(32036)); text("WAVEfmt "); number(UInt32(16))
    number(UInt16(1)); number(UInt16(1)); number(UInt32(16000)); number(UInt32(32000))
    number(UInt16(2)); number(UInt16(16)); text("data"); number(UInt32(32000))
    for i in 0..<16000 { number(Int16(1000 * sin(Double(i) * 440 * .pi / 8000))) }
    return bytes
  }
}
