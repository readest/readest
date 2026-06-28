import Foundation
import UIKit

struct WidgetSnapshotBook: Codable, Identifiable {
  let hash: String
  let title: String
  let author: String
  let percent: Int
  var id: String { hash }
}

struct WidgetSnapshot: Codable {
  let books: [WidgetSnapshotBook]
  let sectionTitle: String
  let emptyTitle: String
}

enum WidgetSnapshotStore {
  static let suiteName = "group.com.bilingify.readest"
  static let snapshotKey = "readingWidgetSnapshot"

  static func load() -> WidgetSnapshot {
    guard
      let data = UserDefaults(suiteName: suiteName)?.data(forKey: snapshotKey),
      let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    else {
      return WidgetSnapshot(books: [], sectionTitle: "Continue reading", emptyTitle: "")
    }
    return snapshot
  }

  static func coverImage(for hash: String) -> UIImage? {
    guard
      let container = FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: suiteName)
    else { return nil }
    let url = container.appendingPathComponent("widget/covers/\(hash).jpg")
    return UIImage(contentsOfFile: url.path)
  }
}
