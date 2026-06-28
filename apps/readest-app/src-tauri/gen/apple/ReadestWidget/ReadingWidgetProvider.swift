import WidgetKit
import SwiftUI

struct ReadingEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot
}

struct ReadingProvider: TimelineProvider {
  func placeholder(in context: Context) -> ReadingEntry {
    ReadingEntry(date: Date(), snapshot: WidgetSnapshotStore.load())
  }
  func getSnapshot(in context: Context, completion: @escaping (ReadingEntry) -> Void) {
    completion(ReadingEntry(date: Date(), snapshot: WidgetSnapshotStore.load()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<ReadingEntry>) -> Void) {
    // One static entry; the app calls WidgetCenter.reloadAllTimelines() on change.
    let entry = ReadingEntry(date: Date(), snapshot: WidgetSnapshotStore.load())
    completion(Timeline(entries: [entry], policy: .never))
  }
}
