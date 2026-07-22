import Foundation
import UIKit
import WidgetKit

enum ReadingWidgetWriter {
  static let suiteName = "group.com.bilingify.readest"
  static let snapshotKey = "readingWidgetSnapshot"
  static let thumbMaxPixels: CGFloat = 240

  struct SnapshotBook: Codable {
    let hash: String
    let title: String
    let author: String
    let percent: Int
  }
  struct Snapshot: Codable {
    let books: [SnapshotBook]
    let sectionTitle: String
    let emptyTitle: String
  }

  static var containerURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName)
  }

  static func coversDir() -> URL? {
    guard let base = containerURL?.appendingPathComponent("widget/covers", isDirectory: true)
    else { return nil }
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  /// Downsample a cover file to <= thumbMaxPixels on the long edge and write
  /// it as JPEG into the App Group container. Returns silently on failure.
  static func writeThumbnail(hash: String, sourcePath: String) {
    guard let dir = coversDir() else { return }
    let dst = dir.appendingPathComponent("\(hash).jpg")
    guard let image = UIImage(contentsOfFile: sourcePath) else {
      try? FileManager.default.removeItem(at: dst)
      return
    }
    let longEdge = max(image.size.width, image.size.height)
    let scale = longEdge > thumbMaxPixels ? thumbMaxPixels / longEdge : 1
    // Round to whole pixels: the renderer allocates a whole-pixel buffer, so a
    // fractional target would leave the trailing pixel column/row only partially
    // covered (semi-transparent). Flattened into JPEG that shows up as a bright
    // hairline along the right/bottom edge. Whole-pixel target == full coverage.
    let target = CGSize(
      width: (image.size.width * scale).rounded(),
      height: (image.size.height * scale).rounded())
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1.0
    let renderer = UIGraphicsImageRenderer(size: target, format: format)
    let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
    if let data = resized.jpegData(compressionQuality: 0.8) {
      try? data.write(to: dst)
    }
  }

  static func write(snapshot: Snapshot) {
    guard let data = try? JSONEncoder().encode(snapshot) else { return }
    UserDefaults(suiteName: suiteName)?.set(data, forKey: snapshotKey)
    DispatchQueue.main.async {
      WidgetCenter.shared.reloadAllTimelines()
    }
  }
}
