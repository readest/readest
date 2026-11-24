import Compression
import Foundation

struct ColdEpubSegment: Encodable {
  let text: String
  let sectionIndex: Int
  let cfi: String
}

struct ColdEpubSpeech: Encodable {
  let segments: [ColdEpubSegment]
  let startSection: Int
  let language: String?
  // Recorded narration (EPUB 3 Media Overlays), which the reader prefers.
  let hasMediaOverlays: Bool
}

struct ColdEpubError: Error {
  let message: String
  init(_ message: String) { self.message = message }
}

/// Reads an EPUB's text for Read Aloud started from CarPlay while the reader
/// WebView is suspended (phone locked, #7566). A port of the Android cold
/// reader (ColdEpubText.kt): the spine from the saved CFI on, in bounded
/// chunks, each with the CFI the reader resumes from. Offsets count UTF-16
/// units, as DOM offsets do.
enum ColdEpubText {
  private static let maxSegmentLength = 2_500
  private static let blockElements: Set<String> = [
    "address", "article", "aside", "blockquote", "br", "div", "figcaption", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav",
    "p", "pre", "section", "table", "td", "th", "tr",
  ]
  private static let skippedElements: Set<String> = ["script", "style", "svg", "math"]

  static func read(url: URL, resumeCfi: String?) throws -> ColdEpubSpeech {
    let zip = try ZipArchive(url: url)
    guard let container = try zip.read("META-INF/container.xml") else {
      throw ColdEpubError("EPUB is missing META-INF/container.xml")
    }
    guard
      let opfPath = try XNode.parse(container).descendants(named: "rootfile")
        .lazy.compactMap({ $0.attributes["full-path"] }).first
    else { throw ColdEpubError("EPUB container has no rootfile") }
    guard let opfData = try zip.read(opfPath) else {
      throw ColdEpubError("EPUB package document is missing")
    }
    let opf = try XNode.parse(opfData)
    let base = opfPath.range(of: "/", options: .backwards).map { String(opfPath[..<$0.lowerBound]) } ?? ""
    var manifest: [String: String] = [:]
    let items = opf.descendants(named: "item")
    for item in items {
      if let id = item.attributes["id"], let href = item.attributes["href"] {
        manifest[id] = resolveZipPath(base, href)
      }
    }
    let spineIds = opf.descendants(named: "itemref").compactMap { $0.attributes["idref"] }
    let spine = spineIds.compactMap { manifest[$0] }
    guard !spine.isEmpty else { throw ColdEpubError("EPUB spine is empty") }
    let language = opf.descendants(named: "language").first?.textContent
      .trimmingCharacters(in: .whitespacesAndNewlines)

    let startSection = min(max(spineIndex(fromCfi: resumeCfi), 0), spine.count - 1)
    var segments: [ColdEpubSegment] = []
    for sectionIndex in startSection..<spine.count {
      guard let bytes = try zip.read(spine[sectionIndex]) else { continue }
      let sectionCfi = "epubcfi(/6/\((sectionIndex + 1) * 2)"
      let sectionResumeCfi = sectionIndex == startSection ? resumeCfi : nil
      for segment in extractSegments(bytes, resumeCfi: sectionResumeCfi) {
        let cfi = segment.localCfi.map { "\(sectionCfi)!\($0))" } ?? sectionResumeCfi ?? "\(sectionCfi))"
        segments.append(ColdEpubSegment(text: segment.text, sectionIndex: sectionIndex, cfi: cfi))
      }
    }
    return ColdEpubSpeech(
      segments: segments, startSection: startSection,
      language: language?.isEmpty == false ? language : nil,
      // Spine items only, as the reader decides (mediaOverlay/index.ts).
      hasMediaOverlays: items.contains {
        $0.attributes["media-overlay"] != nil && spineIds.contains($0.attributes["id"] ?? "")
      })
  }

  static func spineIndex(fromCfi cfi: String?) -> Int {
    guard let cfi = cfi,
      let match = cfi.range(of: #"epubcfi\(/6/\d+"#, options: .regularExpression),
      let step = Int(cfi[match].dropFirst("epubcfi(/6/".count))
    else { return 0 }
    return max(step / 2 - 1, 0)
  }

  // MARK: - Section text

  private struct TextRun {
    let node: XNode
    let start: Int
    let end: Int
  }

  private static func extractSegments(_ bytes: Data, resumeCfi: String?) -> [(text: String, localCfi: String?)] {
    var text: [UInt16] = []
    var runs: [TextRun] = []
    var resumeOffset = 0
    // Held for the whole function: nodes only keep weak parent links.
    let document = try? XNode.parse(bytes)
    if let root = document?.children.first(where: { $0.kind == .element }) {
      let body = root.descendants(named: "body").first ?? root
      let anchor = resumeCfi.flatMap { resolveLocalCfi(root, $0) }
      var anchorOffset = -1
      appendText(body, to: &text, anchor: anchor, anchorOffset: &anchorOffset, runs: &runs)
      resumeOffset = max(anchorOffset, 0)
    } else {
      // EPUB requires XHTML, but tolerate old books with HTML-ish markup.
      text = Array(fallbackText(bytes).utf16)
    }

    var segments: [(text: String, localCfi: String?)] = []
    var lineStart = resumeOffset
    while lineStart <= text.count {
      let lineEnd = text[lineStart...].firstIndex(of: 0x0A) ?? text.count
      // Collapse each whitespace run to one space, remembering where every
      // kept unit came from so a chunk maps back to a DOM offset.
      var normalized: [UInt16] = []
      var sources: [Int] = []
      var index = lineStart
      while index < lineEnd {
        if isSpace(text[index]) {
          index += 1
          continue
        }
        var wordEnd = index
        while wordEnd < lineEnd && !isSpace(text[wordEnd]) { wordEnd += 1 }
        if !normalized.isEmpty {
          sources.append(index - 1)
          normalized.append(0x20)
        }
        for unit in index..<wordEnd {
          sources.append(unit)
          normalized.append(text[unit])
        }
        index = wordEnd
      }
      for chunk in splitLongSegment(normalized) {
        let source = sources[chunk.lowerBound]
        let cfi = run(containing: source, in: runs).map { localCfi($0.node, source - $0.start) }
        segments.append((String(decoding: normalized[chunk], as: UTF16.self), cfi))
      }
      lineStart = lineEnd + 1
    }
    return segments
  }

  private static func isSpace(_ unit: UInt16) -> Bool {
    unit == 0x20 || (0x09...0x0D).contains(unit)
  }

  private static func run(containing offset: Int, in runs: [TextRun]) -> TextRun? {
    var low = 0
    var high = runs.count - 1
    while low <= high {
      let mid = (low + high) / 2
      if offset < runs[mid].start {
        high = mid - 1
      } else if offset >= runs[mid].end {
        low = mid + 1
      } else {
        return runs[mid]
      }
    }
    return nil
  }

  // Sentence-sized pieces of at most maxSegmentLength units, as ranges of the
  // normalized line (sentences there are separated by exactly one space).
  private static func splitLongSegment(_ text: [UInt16]) -> [Range<Int>] {
    if text.isEmpty { return [] }
    if text.count <= maxSegmentLength { return [0..<text.count] }
    var sentences: [Range<Int>] = []
    var start = 0
    for index in 1..<text.count where text[index] == 0x20 && [0x2E, 0x21, 0x3F].contains(text[index - 1]) {
      sentences.append(start..<index)
      start = index + 1
    }
    sentences.append(start..<text.count)

    var chunks: [Range<Int>] = []
    var pending: Range<Int>?
    for sentence in sentences {
      if let current = pending, current.count + sentence.count + 1 > maxSegmentLength {
        chunks.append(current)
        pending = nil
      }
      if sentence.count > maxSegmentLength {
        if let current = pending {
          chunks.append(current)
          pending = nil
        }
        var chunkStart = sentence.lowerBound
        while chunkStart < sentence.upperBound {
          var chunkEnd = min(chunkStart + maxSegmentLength, sentence.upperBound)
          var nextStart = chunkEnd
          if chunkEnd < sentence.upperBound {
            // Break at the last space that fits; a single longer word is cut,
            // but never inside a surrogate pair.
            if let space = text[chunkStart..<chunkEnd].lastIndex(of: 0x20), space > chunkStart {
              chunkEnd = space
              nextStart = space + 1
            } else if UTF16.isLeadSurrogate(text[chunkEnd - 1]) {
              chunkEnd -= 1
              nextStart = chunkEnd
            }
          }
          chunks.append(chunkStart..<chunkEnd)
          chunkStart = nextStart
        }
      } else {
        pending = pending.map { $0.lowerBound..<sentence.upperBound } ?? sentence
      }
    }
    if let current = pending { chunks.append(current) }
    return chunks
  }

  private struct TextAnchor {
    let node: XNode
    let offset: Int
  }

  private static func appendText(
    _ node: XNode, to text: inout [UInt16], anchor: TextAnchor?, anchorOffset: inout Int,
    runs: inout [TextRun]
  ) {
    if anchorOffset < 0, let anchor = anchor, anchor.node === node {
      anchorOffset = text.count + (node.kind == .text ? min(max(anchor.offset, 0), node.length) : 0)
    }
    switch node.kind {
    case .text:
      let start = text.count
      text.append(contentsOf: node.value.utf16)
      runs.append(TextRun(node: node, start: start, end: text.count))
    case .element:
      let name = node.name.lowercased()
      if skippedElements.contains(name) { return }
      let isBlock = blockElements.contains(name)
      if isBlock { text.append(0x0A) }
      for child in node.children {
        appendText(child, to: &text, anchor: anchor, anchorOffset: &anchorOffset, runs: &runs)
      }
      if isBlock { text.append(0x0A) }
    case .document:
      break
    }
  }

  private static func fallbackText(_ bytes: Data) -> String {
    var html = String(decoding: bytes, as: UTF8.self)
    for (pattern, replacement) in [
      (#"(?is)<(head|script|style|svg|math)[^>]*>.*?</\1>"#, " "),
      (#"(?i)<br\s*/?>|</?(p|div|li|h[1-6]|section|article|tr)[^>]*>"#, "\n"),
      (#"(?s)<[^>]+>"#, " "),
    ] {
      html = html.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
    }
    for (entity, character) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&amp;", "&")] {
      html = html.replacingOccurrences(of: entity, with: character)
    }
    return html
  }

  // MARK: - CFI

  // EPUB CFI numbers both elements (even) and the text between them (odd);
  // adjacent text (and CDATA) shares one odd slot. Mirrors foliate-js.
  private enum Slot {
    case before, first, last, after, gap
    case node(XNode)

    func contains(_ target: XNode) -> Bool {
      if case .node(let node) = self { return node === target }
      return false
    }
  }

  private static func indexCfiChildren(_ node: XNode) -> [Slot] {
    // The DOM here already merges adjacent text and CDATA into one text node.
    var slots: [Slot] = []
    for child in node.children {
      if case .node(let last) = slots.last, last.kind == .element, child.kind == .element {
        slots.append(.gap)
      }
      slots.append(.node(child))
    }
    if case .node(let first) = slots.first, first.kind == .element { slots.insert(.first, at: 0) }
    if case .node(let last) = slots.last, last.kind == .element { slots.append(.last) }
    return [.before] + slots + [.after]
  }

  private static func localCfi(_ textNode: XNode, _ textOffset: Int) -> String {
    var node = textNode
    var steps: [Int] = []
    while let parent = node.parent, parent.kind == .element,
      let index = indexCfiChildren(parent).firstIndex(where: { $0.contains(node) })
    {
      steps.append(index)
      node = parent
    }
    return steps.reversed().map { "/\($0)" }.joined() + ":\(textOffset)"
  }

  /// Resolves the content-document half of a reader CFI, so speech resumes
  /// at the saved text offset instead of the start of its section.
  private static func resolveLocalCfi(_ root: XNode, _ cfi: String) -> TextAnchor? {
    guard let bang = cfi.range(of: "!", options: .backwards) else { return nil }
    var local = String(cfi[bang.upperBound...])
    if local.hasSuffix(")") { local.removeLast() }
    if local.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
    let rangeParts = splitUnescaped(local, ",")
    let collapsedStart = rangeParts.count >= 2 ? rangeParts[0] + rangeParts[1] : local

    let steps = cfiSteps(collapsedStart)
    guard let lastStep = steps.last else { return nil }

    var current = root
    for step in steps {
      let slots = indexCfiChildren(current)
      guard step.index < slots.count else { return nil }
      switch slots[step.index] {
      case .node(let node): current = node
      case .first: current = current.children.first ?? current
      case .last: current = current.children.last ?? current
      case .before, .after: break
      case .gap: return nil
      }
    }
    return TextAnchor(node: current, offset: lastStep.offset ?? 0)
  }

  private typealias CfiStep = (index: Int, offset: Int?)
  private static let stepPattern = try? NSRegularExpression(
    pattern: #"/(\d+)(?:\[(?:\^.|[^\]])*\])?(?::(\d+))?"#)

  private static func cfiSteps(_ path: String) -> [CfiStep] {
    guard let stepPattern = stepPattern else { return [] }
    let source = path as NSString
    return stepPattern.matches(in: path, range: NSRange(location: 0, length: source.length)).map {
      let offset = $0.range(at: 2)
      return (
        Int(source.substring(with: $0.range(at: 1))) ?? 0,
        offset.location == NSNotFound ? nil : Int(source.substring(with: offset))
      )
    }
  }

  /// Where the reader resumes Read Aloud (useTTSControl, isCfiInLocation):
  /// the saved TTS position when it lies on the saved page, else the page.
  static func resumeCfi(location: String?, ttsLocation: String?) -> String? {
    let page = location?.isEmpty == false ? location : nil
    let tts = ttsLocation?.isEmpty == false ? ttsLocation : nil
    guard let page = page, let tts = tts else { return page ?? tts }
    if tts == page || unwrapCfi(tts).hasPrefix(unwrapCfi(page)) { return tts }
    let bounds = cfiPoints(page)
    let point = cfiPoints(tts)
    return compareCfi(point, bounds.start) >= 0 && compareCfi(point, bounds.end) <= 0 ? tts : page
  }

  private static func unwrapCfi(_ cfi: String) -> String {
    cfi.hasPrefix("epubcfi(") && cfi.hasSuffix(")") ? String(cfi.dropFirst(8).dropLast()) : cfi
  }

  // A point is its steps per indirection ("!") part.
  private typealias CfiPoint = [[CfiStep]]

  private static func cfiPoints(_ cfi: String) -> (start: CfiPoint, end: CfiPoint) {
    let inner = unwrapCfi(cfi)
    let parts = splitUnescaped(inner, ",")
    let point = { (path: String) in splitUnescaped(path, "!").map(cfiSteps) }
    guard parts.count == 3 else { return (point(inner), point(inner)) }
    return (point(parts[0] + parts[1]), point(parts[0] + parts[2]))
  }

  // foliate-js CFI.compare: a range compares by its start, then its end.
  private static func compareCfi(_ a: (start: CfiPoint, end: CfiPoint), _ b: CfiPoint) -> Int {
    let byStart = comparePoints(a.start, b)
    return byStart != 0 ? byStart : comparePoints(a.end, b)
  }

  private static func comparePoints(_ a: CfiPoint, _ b: CfiPoint) -> Int {
    for part in 0..<max(a.count, b.count) {
      let p = part < a.count ? a[part] : []
      let q = part < b.count ? b[part] : []
      let last = max(p.count, q.count) - 1
      if last < 0 { continue }
      for step in 0...last {
        guard step < p.count else { return -1 }
        guard step < q.count else { return 1 }
        if p[step].index != q[step].index { return p[step].index > q[step].index ? 1 : -1 }
        if step == last, let x = p[step].offset, let y = q[step].offset, x != y { return x > y ? 1 : -1 }
      }
    }
    return 0
  }

  private static func splitUnescaped(_ value: String, _ delimiter: Character) -> [String] {
    var result: [String] = []
    var current = ""
    var escaped = false
    var bracketDepth = 0
    for character in value {
      if escaped {
        escaped = false
      } else if character == "^" {
        escaped = true
      } else if character == "[" {
        bracketDepth += 1
      } else if character == "]" && bracketDepth > 0 {
        bracketDepth -= 1
      } else if character == delimiter && bracketDepth == 0 {
        result.append(current)
        current = ""
        continue
      }
      current.append(character)
    }
    result.append(current)
    return result
  }

  private static func resolveZipPath(_ base: String, _ href: String) -> String {
    let path = URLComponents(string: href)?.path ?? href
    var parts: [Substring] = []
    for part in (base.isEmpty ? path : "\(base)/\(path)").split(separator: "/") {
      switch part {
      case ".": continue
      case "..": _ = parts.popLast()
      default: parts.append(part)
      }
    }
    return parts.joined(separator: "/")
  }
}

// MARK: - XML

/// The little DOM the reader needs: elements and text, with adjacent text and
/// CDATA merged into one node (they share a CFI slot anyway).
private final class XNode {
  enum Kind { case document, element, text }

  let kind: Kind
  let name: String
  let attributes: [String: String]
  var value = ""
  weak var parent: XNode?
  var children: [XNode] = []

  init(kind: Kind, name: String = "", attributes: [String: String] = [:]) {
    self.kind = kind
    self.name = name
    self.attributes = attributes
  }

  var length: Int { value.utf16.count }

  var textContent: String {
    kind == .text ? value : children.map(\.textContent).joined()
  }

  func append(_ child: XNode) {
    child.parent = self
    children.append(child)
  }

  func appendText(_ text: String) {
    if let last = children.last, last.kind == .text {
      last.value += text
    } else {
      let node = XNode(kind: .text)
      node.value = text
      append(node)
    }
  }

  func descendants(named name: String) -> [XNode] {
    var found: [XNode] = []
    for child in children where child.kind == .element {
      if child.name == name { found.append(child) }
      found.append(contentsOf: child.descendants(named: name))
    }
    return found
  }

  static func parse(_ data: Data) throws -> XNode {
    let builder = DOMBuilder()
    let parser = XMLParser(data: data)
    parser.shouldProcessNamespaces = true
    parser.shouldResolveExternalEntities = false
    parser.delegate = builder
    guard parser.parse() else {
      throw ColdEpubError(parser.parserError?.localizedDescription ?? "Malformed XML")
    }
    return builder.document
  }
}

private final class DOMBuilder: NSObject, XMLParserDelegate {
  let document = XNode(kind: .document)
  private lazy var current = document

  func parser(
    _ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
    qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]
  ) {
    let element = XNode(kind: .element, name: elementName, attributes: attributeDict)
    current.append(element)
    current = element
  }

  func parser(
    _ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?,
    qualifiedName qName: String?
  ) {
    current = current.parent ?? document
  }

  func parser(_ parser: XMLParser, foundCharacters string: String) {
    current.appendText(string)
  }

  func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
    current.appendText(String(decoding: CDATABlock, as: UTF8.self))
  }
}

// MARK: - Zip

/// Reads stored and deflated entries; sizes come from the central directory,
/// so entries written with data descriptors read too. No ZIP64.
private struct ZipArchive {
  // The declared size is the archive's word: refuse to allocate more than any
  // real chapter needs rather than let a bad book exhaust memory.
  private static let maxEntrySize = 128 * 1024 * 1024

  private struct Entry {
    let method: Int
    let compressedSize: Int
    let size: Int
    let offset: Int
  }

  private let data: Data
  private var entries: [String: Entry] = [:]

  init(url: URL) throws {
    data = try Data(contentsOf: url, options: .alwaysMapped)
    guard data.count >= 22 else { throw ColdEpubError("Not a zip file") }
    var end = data.count - 22
    let lowest = max(0, end - 0xFFFF)
    while end > lowest && uint32(at: end) != 0x0605_4b50 { end -= 1 }
    guard uint32(at: end) == 0x0605_4b50 else { throw ColdEpubError("Not a zip file") }

    var position = uint32(at: end + 16)
    for _ in 0..<uint16(at: end + 10) {
      guard position + 46 <= data.count, uint32(at: position) == 0x0201_4b50 else {
        throw ColdEpubError("Corrupt zip directory")
      }
      let nameEnd = position + 46 + uint16(at: position + 28)
      guard nameEnd <= data.count else { throw ColdEpubError("Corrupt zip directory") }
      let name = String(decoding: data[(position + 46)..<nameEnd], as: UTF8.self)
      entries[name] = Entry(
        method: uint16(at: position + 10), compressedSize: uint32(at: position + 20),
        size: uint32(at: position + 24), offset: uint32(at: position + 42))
      position = nameEnd + uint16(at: position + 30) + uint16(at: position + 32)
    }
  }

  func read(_ name: String) throws -> Data? {
    guard let entry = entries[name] else { return nil }
    guard entry.size <= Self.maxEntrySize, entry.compressedSize <= Self.maxEntrySize else {
      throw ColdEpubError("Zip entry \(name) is too large")
    }
    let header = entry.offset
    guard header + 30 <= data.count, uint32(at: header) == 0x0403_4b50 else {
      throw ColdEpubError("Corrupt zip entry \(name)")
    }
    let start = header + 30 + uint16(at: header + 26) + uint16(at: header + 28)
    guard start + entry.compressedSize <= data.count else {
      throw ColdEpubError("Corrupt zip entry \(name)")
    }
    let raw = data[start..<(start + entry.compressedSize)]
    switch entry.method {
    case 0:
      return Data(raw)
    case 8:
      // An empty entry may store no stream at all.
      if entry.size == 0 && raw.isEmpty { return Data() }
      guard let output = Self.inflate(raw, size: entry.size) else {
        throw ColdEpubError("Corrupt zip entry \(name)")
      }
      return output
    default:
      throw ColdEpubError("Unsupported zip compression in \(name)")
    }
  }

  // Raw DEFLATE that must end exactly at `size` bytes: a stream that is
  // corrupt, cut short or longer than declared returns nil. One spare byte
  // lets a longer stream show itself; the decoder reports the stream's end.
  private static func inflate(_ raw: Data, size: Int) -> Data? {
    guard !raw.isEmpty else { return nil }
    var output = Data(count: size + 1)
    let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    defer { stream.deallocate() }
    guard compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK
    else { return nil }
    defer { compression_stream_destroy(stream) }
    let status = output.withUnsafeMutableBytes { out in
      raw.withUnsafeBytes { input in
        stream.pointee.dst_ptr = out.bindMemory(to: UInt8.self).baseAddress!
        stream.pointee.dst_size = size + 1
        stream.pointee.src_ptr = input.bindMemory(to: UInt8.self).baseAddress!
        stream.pointee.src_size = raw.count
        return compression_stream_process(stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
      }
    }
    guard status == COMPRESSION_STATUS_END, stream.pointee.dst_size == 1 else { return nil }
    return output.prefix(size)
  }

  private func uint16(at offset: Int) -> Int {
    Int(data[offset]) | Int(data[offset + 1]) << 8
  }

  private func uint32(at offset: Int) -> Int {
    uint16(at: offset) | uint16(at: offset + 2) << 16
  }
}
