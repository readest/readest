import WidgetKit
import SwiftUI

struct ReadingWidget: Widget {
  let kind = "ReadingWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ReadingProvider()) { entry in
      ReadingWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("Readest")
    .description("Continue reading your recent books.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

struct ReadingWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: ReadingEntry
  var body: some View {
    content.widgetCardBackground()
  }

  @ViewBuilder private var content: some View {
    switch family {
    case .systemSmall: SmallReadingView(snapshot: entry.snapshot)
    default: RowReadingView(snapshot: entry.snapshot)
    }
  }
}

@main
struct ReadestWidgetBundle: WidgetBundle {
  var body: some Widget { ReadingWidget() }
}
