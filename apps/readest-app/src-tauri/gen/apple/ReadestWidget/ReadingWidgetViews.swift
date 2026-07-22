import WidgetKit
import SwiftUI

extension View {
  /// Adaptive widget card surface: paper-white in light mode, near-black in
  /// dark mode. Uses containerBackground on iOS 17+ (required there) and a
  /// plain background on the iOS 15/16 deployment floor.
  @ViewBuilder
  func widgetCardBackground() -> some View {
    if #available(iOS 17.0, *) {
      containerBackground(Color(.systemBackground), for: .widget)
    } else {
      background(Color(.systemBackground))
    }
  }
}

private func bookURL(_ hash: String) -> URL { URL(string: "readest://book/\(hash)")! }

// MARK: - Progress Bar (overlaid along the bottom of the cover)
private struct ProgressBar: View {
  let percent: Int
  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Color.white.opacity(0.35))
        Capsule().fill(Color.accentColor)
          .frame(width: geo.size.width * CGFloat(min(100, max(0, percent))) / 100)
      }
    }
    .frame(height: 3)
  }
}

// MARK: - Cover Cell (shared by all widget families)
// Center-cropped cover image fills its cell; a % badge sits top-right and a
// thin progress bar is overlaid along the bottom edge. Missing-cover fallback
// shows a tinted tile with the title centered.
private struct CoverCell: View {
  let book: WidgetSnapshotBook
  var body: some View {
    ZStack(alignment: .topTrailing) {
      // Cover + progress bar (clipped together to the rounded rect)
      ZStack(alignment: .bottom) {
        if let image = WidgetSnapshotStore.coverImage(for: book.hash) {
          Image(uiImage: image)
            .resizable()
            .aspectRatio(contentMode: .fill)
        } else {
          Color(.secondarySystemBackground)
          Text(book.title)
            .font(.caption2)
            .lineLimit(3)
            .multilineTextAlignment(.center)
            .padding(6)
        }
        ProgressBar(percent: book.percent)
          .padding(.horizontal, 6)
          .padding(.bottom, 5)
      }
      .clipShape(RoundedRectangle(cornerRadius: 8))

      // % badge – outside the clipShape so it is never trimmed
      Text("\(book.percent)%")
        .font(.system(size: 10, weight: .semibold))
        .foregroundColor(.white)
        .padding(.horizontal, 5)
        .padding(.vertical, 3)
        .background(Color.black.opacity(0.6))
        .clipShape(Capsule())
        .padding(5)
    }
  }
}

// MARK: - Small Widget (single cover fills the entire widget)
struct SmallReadingView: View {
  let snapshot: WidgetSnapshot
  var body: some View {
    if let book = snapshot.books.first {
      CoverCell(book: book)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetURL(bookURL(book.hash))
    } else {
      EmptyReadingView(title: snapshot.emptyTitle)
    }
  }
}

// MARK: - Medium/Large Widget (row of up to 3 covers, no header for a clean UI)
struct RowReadingView: View {
  let snapshot: WidgetSnapshot
  var body: some View {
    if snapshot.books.isEmpty {
      EmptyReadingView(title: snapshot.emptyTitle)
    } else {
      HStack(alignment: .top, spacing: 10) {
        ForEach(snapshot.books.prefix(3)) { book in
          Link(destination: bookURL(book.hash)) {
            CoverCell(book: book)
              .frame(maxWidth: .infinity, maxHeight: .infinity)
          }
          .frame(maxWidth: .infinity)
        }
      }
      .padding(12)
    }
  }
}

// MARK: - Empty State
struct EmptyReadingView: View {
  let title: String
  var body: some View {
    VStack(spacing: 8) {
      Image(systemName: "books.vertical").font(.title2).foregroundColor(.secondary)
      Text(title).font(.system(size: 12)).foregroundColor(.secondary)
        .multilineTextAlignment(.center)
    }
    .padding(12).frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
