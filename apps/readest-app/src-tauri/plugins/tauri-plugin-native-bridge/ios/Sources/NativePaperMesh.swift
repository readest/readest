import Foundation

/// Reusable clipped 64-hinge mesh, the Swift twin of the Android
/// `NativePaperMesh` and the browser `buildPageCurlMesh`. Each vertex is
/// `u, v, x, y, z, shade`; shade >= 1 marks the paper's back.
final class NativePaperMesh {
  private(set) var vertices = [Float](repeating: 0, count: 8192)
  private(set) var count = 0
  private var rect = [Double](repeating: 0, count: 16)
  private var inner = [Double](repeating: 0, count: 8)
  private var a = [Double](repeating: 0, count: 16)
  private var b = [Double](repeating: 0, count: 16)
  private var width = 1.0
  private var height = 1.0
  // A spread turns only its outer column; [origin, width] is that leaf.
  private var origin = 0.0
  private var nx = 1.0
  private var ny = 0.0
  private var fold = 0.0
  private var step = 0.0
  private var rtl = false
  private let angle = Double.pi / 65
  private let cosines: [Double]
  private let sines: [Double]
  private let sumX: [Double]
  private let sumZ: [Double]

  init() {
    let angle = self.angle
    let sinHalf = sin(angle / 2)
    cosines = (0..<65).map { cos(Double($0) * angle) }
    sines = (0..<65).map { sin(Double($0) * angle) }
    sumX = (0..<65).map {
      sin(Double($0) * angle / 2) / sinHalf * cos((Double($0) * angle - angle) / 2)
    }
    sumZ = (0..<65).map {
      sin(Double($0) * angle / 2) / sinHalf * sin((Double($0) * angle - angle) / 2)
    }
  }

  /// Signed distance from a source point to the current fold line.
  private func distance(_ x: Double, _ y: Double) -> Double {
    (x - fold) * nx + (y - height / 2) * ny
  }

  /// Clip a polygon to one side of a hinge into preallocated storage.
  private func clip(
    _ input: [Double], _ size: Int, _ edge: Double, _ above: Bool, _ output: inout [Double]
  ) -> Int {
    var n = 0
    for i in 0..<size {
      let j = (i + 1) % size
      let ax = input[i * 2], ay = input[i * 2 + 1]
      let bx = input[j * 2], by = input[j * 2 + 1]
      let da = distance(ax, ay) - edge, db = distance(bx, by) - edge
      let ia = above ? da >= 0 : da <= 0
      let ib = above ? db >= 0 : db <= 0
      if ia {
        output[n * 2] = ax
        output[n * 2 + 1] = ay
        n += 1
      }
      if ia != ib {
        let t = da / (da - db)
        output[n * 2] = ax + (bx - ax) * t
        output[n * 2 + 1] = ay + (by - ay) * t
        n += 1
      }
    }
    return n
  }

  /// Project a source point through the hinge rotations and append its textured vertex.
  private func vertex(_ x: Double, _ y: Double, _ deform: Bool) {
    let sourceX = origin + x
    var px = sourceX, py = y, z = 0.0, shade = 0.0
    let s = distance(x, y)
    if deform && s > 0 && step < 1e-6 {
      // A spread leaf with no bend left lies flat on the facing column.
      px -= 2 * s * nx
      py -= 2 * s * ny
    } else if deform && s > 0 {
      let band = min(64, Int(floor(s / step + 1e-7)))
      let remainder = s - Double(band) * step
      let bentX = step * sumX[band] + remainder * cosines[band]
      z = step * sumZ[band] + remainder * sines[band]
      px -= (s - bentX) * nx
      py -= (s - bentX) * ny
      shade = max(0, 0.25 - abs(0.25 - min(64, s / step) / 128))
    }
    vertices[count] = Float((rtl ? width - sourceX : sourceX) / width)
    vertices[count + 1] = Float(y / height)
    vertices[count + 2] = Float(rtl ? width - px : px)
    vertices[count + 3] = Float(py)
    vertices[count + 4] = Float(z)
    vertices[count + 5] = Float(shade)
    count += 6
  }

  /// Projected screen coordinate of a stored vertex, matching the vertex shader.
  private func projected(_ index: Int, _ vertical: Bool) -> Double {
    let depth = 2.0 * Double(vertices[index + 4]) / (7.0 * width)
    return vertical
      ? (Double(vertices[index + 3]) - height / 2 - depth * height / 2) / (1 - depth)
      : (Double(vertices[index + 2]) - width / 2) / (1 - depth)
  }

  /// Triangulate a clipped polygon and mark back-facing triangles for shading.
  private func emit(_ polygon: [Double], _ size: Int, _ deform: Bool) {
    guard size >= 3 else { return }
    for i in 1..<(size - 1) {
      vertex(polygon[0], polygon[1], deform)
      vertex(polygon[i * 2], polygon[i * 2 + 1], deform)
      vertex(polygon[(i + 1) * 2], polygon[(i + 1) * 2 + 1], deform)
      let base = count - 18
      let ax = projected(base, false), ay = projected(base, true)
      let bx = projected(base + 6, false), by = projected(base + 6, true)
      let cx = projected(base + 12, false), cy = projected(base + 12, true)
      let area = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * (rtl ? -1 : 1)
      if area < 0 {
        vertices[base + 5] += 1
        vertices[base + 11] += 1
        vertices[base + 17] += 1
      }
    }
  }

  /// Build the current fold into reusable vertex storage and return the vertex count.
  @discardableResult
  func build(
    _ w: Int, _ h: Int, _ progress: Float, _ grabY: Float, _ mirrored: Bool, _ columns: Int = 1
  ) -> Int {
    width = Double(w)
    height = Double(h)
    rtl = mirrored
    count = 0
    let p = Double(min(max(progress, 0), 1))
    let spread = columns >= 2
    if !spread && p >= 1 { return 0 }
    let leaf = spread ? width / 2 : width
    origin = width - leaf
    let slope = (0.2 - 2 * (Double(grabY) - 0.5)) * (1 - p)
    let norm = hypot(1.0, slope)
    nx = 1 / norm
    ny = slope / norm
    // A spread leaf tightens to nothing so it lands flat on the facing column.
    let bend = leaf * 0.7 * (spread ? 1 - p * p : 1.0)
    fold = leaf - (leaf + bend) * p
    step = bend / 64 / norm
    rect[0] = 0; rect[1] = 0
    rect[2] = leaf; rect[3] = 0
    rect[4] = leaf; rect[5] = height
    rect[6] = 0; rect[7] = height
    if spread {
      inner[0] = -origin; inner[1] = 0
      inner[2] = 0; inner[3] = 0
      inner[4] = 0; inner[5] = height
      inner[6] = -origin; inner[7] = height
      emit(inner, 4, false)
    }
    if p <= 0 {
      emit(rect, 4, false)
      return count / 6
    }
    if step < 1e-6 {
      emit(rect, 4, true)
      return count / 6
    }
    var n = clip(rect, 4, 0, false, &a)
    emit(a, n, true)
    for band in 0..<64 {
      n = clip(rect, 4, Double(band) * step, true, &a)
      let m = clip(a, n, Double(band + 1) * step, false, &b)
      emit(b, m, true)
    }
    n = clip(rect, 4, 64 * step, true, &a)
    emit(a, n, true)
    return count / 6
  }
}
