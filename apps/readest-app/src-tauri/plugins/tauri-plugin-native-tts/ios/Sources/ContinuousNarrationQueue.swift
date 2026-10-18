import AVFoundation
import Foundation

// A bounded two-item queue. Segment times stay in the original file's frame,
// even when a composition trims a queued file's opening or tail.
final class ContinuousNarrationQueue {
  let player = AVQueuePlayer()
  var onTransition: ((String, Double) -> Void)?
  var onEnded: (() -> Void)?
  var onError: (() -> Void)?
  private(set) var path: String?
  private var offset = 0.0
  private var next: (path: String, offset: Double, item: AVPlayerItem)?
  private var itemObservation: NSKeyValueObservation?
  private var statusObservation: NSKeyValueObservation?
  private var failureObserver: NSObjectProtocol?
  private var loading = false

  init() {
    player.allowsExternalPlayback = false
    itemObservation = player.observe(\.currentItem, options: [.new]) { [weak self] player, _ in
      guard let self = self, !self.loading else { return }
      if let next = self.next, player.currentItem === next.item {
        self.path = next.path
        self.offset = next.offset
        self.next = nil
        self.watchFailure(next.item)
        self.onTransition?(next.path, self.positionSeconds)
      } else if player.currentItem == nil, self.path != nil {
        self.onEnded?()
      }
    }
  }

  var positionSeconds: Double {
    let time = player.currentTime().seconds
    return offset + (time.isFinite ? time : 0)
  }

  func load(path: String, start: Double) throws {
    if self.path == path, player.currentItem != nil, start >= offset {
      cancelNext()
      seek(to: start)
      return
    }
    let item = AVPlayerItem(url: try Self.url(path))
    item.audioTimePitchAlgorithm = .timeDomain
    loading = true
    player.removeAllItems()
    next = nil
    self.path = path
    offset = 0
    player.insert(item, after: nil)
    loading = false
    watchFailure(item)
    if start > 0 { seek(to: start) }
  }

  func queue(path: String, start: Double, end: Double, after: Double) throws {
    guard let current = player.currentItem, next == nil else { return }
    guard start >= 0, end > start, after > positionSeconds else { return }
    let asset = AVURLAsset(url: try Self.url(path))
    let composition = AVMutableComposition()
    // Queue a trimmed item so advancement starts at the requested SMIL cue;
    // no seek is needed when it becomes current.
    try composition.insertTimeRange(
      CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 60000),
                  duration: CMTime(seconds: asset.duration.seconds - start, preferredTimescale: 60000)),
      of: asset, at: .zero)
    let item = AVPlayerItem(asset: composition)
    item.audioTimePitchAlgorithm = .timeDomain
    guard player.canInsert(item, after: current) else { return }
    next = (path, start, item)
    current.forwardPlaybackEndTime = CMTime(seconds: after - offset, preferredTimescale: 60000)
    player.insert(item, after: current)
  }

  func cancelNext() {
    if let next = next { player.remove(next.item) }
    next = nil
    player.currentItem?.forwardPlaybackEndTime = .invalid
  }

  func seek(to seconds: Double) {
    if seconds < offset, let path = path { try? load(path: path, start: seconds); return }
    cancelNext()
    player.seek(to: CMTime(seconds: max(0, seconds - offset), preferredTimescale: 60000),
                toleranceBefore: .zero, toleranceAfter: .zero)
  }

  func stop() {
    loading = true
    player.pause()
    player.removeAllItems()
    next = nil
    path = nil
    loading = false
    statusObservation?.invalidate()
    if let observer = failureObserver { NotificationCenter.default.removeObserver(observer) }
    failureObserver = nil
  }

  private func watchFailure(_ item: AVPlayerItem) {
    statusObservation?.invalidate()
    if let observer = failureObserver { NotificationCenter.default.removeObserver(observer) }
    failureObserver = NotificationCenter.default.addObserver(
      forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main
    ) { [weak self] _ in self?.onError?() }
    statusObservation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
      if item.status == .failed { self?.onError?() }
    }
  }

  private static func url(_ path: String) throws -> URL {
    if path.hasPrefix("http://") || path.hasPrefix("https://") {
      guard let url = URL(string: path) else { throw URLError(.badURL) }
      return url
    }
    return URL(fileURLWithPath: path)
  }

  deinit {
    itemObservation?.invalidate()
    statusObservation?.invalidate()
    if let observer = failureObserver { NotificationCenter.default.removeObserver(observer) }
  }
}
