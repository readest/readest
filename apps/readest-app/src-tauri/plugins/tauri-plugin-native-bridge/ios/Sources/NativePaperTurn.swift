import Metal
import QuartzCore
import UIKit
import UIKit.UIGestureRecognizerSubclass
import WebKit

struct NativePaperArgs: Decodable {
  let op: String
  let owner: Int
  let generation: Int
  let requestId: Int?
  let turnId: Int?
  let released: Bool?
  let key: String?
  let destination: String?
  let x: Double?
  let y: Double?
  let width: Double?
  let height: Double?
  let forward: Bool?
  let rtl: Bool?
  let progress: Double?
  let grabY: Double?
  let commit: Bool?
  let velocity: Double?
  let columns: Int?
}

private struct PaperError: LocalizedError {
  let errorDescription: String?
  init(_ message: String) { errorDescription = message }
}

/// Runs a closure on every display refresh until invalidated.
private final class FrameLink: NSObject {
  private var link: CADisplayLink?
  private let tick: (FrameLink, CFTimeInterval) -> Void

  init(_ tick: @escaping (FrameLink, CFTimeInterval) -> Void) {
    self.tick = tick
    super.init()
    link = CADisplayLink(target: self, selector: #selector(fire(_:)))
    link?.add(to: .main, forMode: .common)
  }

  @objc private func fire(_ link: CADisplayLink) { tick(self, link.timestamp) }

  func invalidate() {
    link?.invalidate()
    link = nil
  }

  /// Run an action after a number of display refreshes.
  static func after(_ frames: Int, _ action: @escaping () -> Void) {
    var remaining = frames
    _ = FrameLink { link, _ in
      remaining -= 1
      if remaining <= 0 {
        link.invalidate()
        action()
      }
    }
  }
}

/// Observe the webview's touch stream without recognizing or preventing a
/// gesture, so a finger-driven sheet follows UIKit touches directly.
private final class PaperTouchObserver: UIGestureRecognizer {
  enum Touch {
    case down(CGPoint), move(CGPoint), up(CGPoint), cancel, multi
  }
  private let report: (Touch) -> Void
  private var tracked: UITouch?

  init(_ report: @escaping (Touch) -> Void) {
    self.report = report
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
  }

  override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
  override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
    false
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard tracked == nil, touches.count == 1, let touch = touches.first else {
      // A second finger is a pinch, not a page turn.
      if tracked != nil { report(.multi) }
      state = .failed
      return
    }
    tracked = touch
    report(.down(touch.location(in: view)))
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let touch = tracked, touches.contains(touch) else { return }
    report(.move(touch.location(in: view)))
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let touch = tracked, touches.contains(touch) else { return }
    report(.up(touch.location(in: view)))
    state = .failed
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    if tracked != nil { report(.cancel) }
    state = .failed
  }

  override func reset() {
    super.reset()
    tracked = nil
  }
}

/// Lossless webview snapshots -> resident Metal textures -> native touch and
/// display-link settlement, the iOS twin of the Android `NativePaperTurn`.
/// Only commands, page identities and acknowledgements cross IPC. Everything
/// runs on the main thread, so a scene is ready as soon as its command returns.
final class NativePaperTurn {
  typealias Completion = ([String: Any]?, String?) -> Void

  private weak var webView: WKWebView?
  private var view: NativePaperView?
  private var owner = 0
  private var generation = 0
  private var active = false
  private var dragging = false
  private var turnId = 0
  private var dirtyAfterFinish = false
  private var current = ""
  private var destination = ""
  private var forward = true
  private var rtl = false
  private var progress: Float = 0
  private var grabY: Float = 0.5
  private var width: CGFloat = 1
  private var height: CGFloat = 1
  private var finger = false
  private var trackNativeTouch = false
  private var down = CGPoint.zero
  private var last = CGPoint.zero
  private var drawScheduled = false
  private var cancelled = false
  private var completeRequested = false
  private var animation: FrameLink?
  private var animationPending: Pending?
  private var animationTarget: Float = 0
  private var pending: [Pending] = []
  private var captures: [Int: Pending] = [:]
  private var latestCapture: [String: Int] = [:]
  private var abortedRequests: [String] = []
  private var requestKeys: [Int: String] = [:]
  private var requestOrder: [Int] = []
  private var uploadedRequests = Set<Int>()

  private final class Pending {
    private(set) var live = true
    private weak var turn: NativePaperTurn?
    private let complete: Completion
    private var deadline: DispatchWorkItem?

    init(_ turn: NativePaperTurn, _ complete: @escaping Completion) {
      self.turn = turn
      self.complete = complete
      turn.pending.append(self)
      let deadline = DispatchWorkItem { [weak self, weak turn] in
        if self?.live == true { turn?.failAll("Native page frame timed out") }
      }
      self.deadline = deadline
      DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: deadline)
    }

    /// Complete a bridge request once and remove its timeout.
    func resolve(_ result: [String: Any] = [:]) {
      guard settle() else { return }
      complete(result, nil)
    }

    /// Reject a bridge request once and remove its timeout.
    func reject(_ message: String) {
      guard settle() else { return }
      complete(nil, message)
    }

    private func settle() -> Bool {
      guard live else { return false }
      live = false
      deadline?.cancel()
      turn?.pending.removeAll { $0 === self }
      return true
    }
  }

  init(webView: WKWebView) {
    self.webView = webView
    webView.addGestureRecognizer(PaperTouchObserver { [weak self] in self?.touch($0) })
  }

  /// Tear down the failed scene and reject every outstanding request.
  private func failAll(_ message: String) {
    stopAnimation()
    animationPending = nil
    active = false
    dragging = false
    cancelled = true
    view?.removeFromSuperview()
    view = nil
    // Settling a request removes it from `pending`.
    let outstanding = pending
    outstanding.forEach { $0.reject(message) }
    clearRequests()
  }

  private func clearRequests() {
    captures.removeAll()
    latestCapture.removeAll()
    requestKeys.removeAll()
    requestOrder.removeAll()
    uploadedRequests.removeAll()
  }

  private func stopAnimation() {
    animation?.invalidate()
    animation = nil
  }

  /// Wait until WebKit has presented the webview's latest rendering, then a
  /// committed frame. `takeSnapshot` waits for the next presentation update.
  private func presented(_ p: Pending, _ action: @escaping () -> Void) {
    guard let webView, webView.window != nil else {
      return failAll("WebView not available for native paper")
    }
    let config = WKSnapshotConfiguration()
    config.rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    config.snapshotWidth = 1
    webView.takeSnapshot(with: config) { _, _ in
      FrameLink.after(1) { if p.live { action() } }
    }
  }

  /// Wait for two display refreshes before acknowledging a newly shown sheet.
  private func painted(_ p: Pending, _ action: @escaping () -> Void) {
    FrameLink.after(2) { if p.live { action() } }
  }

  /// The command's CSS rect in webview points, snapped to device pixels and
  /// clipped to the webview so the snapshot maps one texel to one pixel.
  private func region(_ args: NativePaperArgs, in webView: WKWebView) -> CGRect {
    let scale = webView.window?.screen.scale ?? UIScreen.main.scale
    let snap = { (value: Double?) in (CGFloat(value ?? 0) * scale).rounded() / scale }
    let x = snap(args.x), y = snap(args.y)
    let rect = CGRect(
      x: x, y: y, width: snap((args.x ?? 0) + (args.width ?? 0)) - x,
      height: snap((args.y ?? 0) + (args.height ?? 0)) - y)
    return rect.intersection(webView.bounds)
  }

  /// Create or move the native sheet, refusing a competing owner during an active turn.
  private func ensureRegion(_ args: NativePaperArgs, keep: Pending) throws -> Bool {
    guard let webView, let container = webView.superview else {
      throw PaperError("WebView not available for native paper")
    }
    if owner != args.owner {
      // A competing idle capture must not tear down the active reader.
      if active { return false }
      pending.filter { $0 !== keep }.forEach { $0.resolve(["ready": false, "cancelled": true]) }
      clearRequests()
      view?.removeFromSuperview()
      view = nil
      owner = args.owner
      generation = args.generation
    }
    let rect = region(args, in: webView)
    guard !rect.isNull, rect.width > 0, rect.height > 0 else {
      throw PaperError("Empty native page region")
    }
    let sheet = try view ?? NativePaperView(scale: webView.window?.screen.scale ?? UIScreen.main.scale)
    if sheet.superview !== container {
      sheet.alpha = 0
      container.insertSubview(sheet, aboveSubview: webView)
    }
    view = sheet
    sheet.place(webView.convert(rect, to: container))
    width = rect.width
    height = rect.height
    return true
  }

  /// Dispatch an owner-scoped bridge command and settle its completion callback.
  func command(_ args: NativePaperArgs, _ complete: @escaping Completion) {
    let p = Pending(self, complete)
    let requestId = args.requestId ?? 0
    let turn = args.turnId ?? 0
    do {
      // IPC calls may arrive out of order, including before this reader has
      // created its first sheet. Retain owner-scoped aborts.
      if args.op == "abortCapture" {
        abortedRequests.append("\(args.owner):\(requestId)")
        if abortedRequests.count > 64 { abortedRequests.removeFirst() }
        if args.owner != owner { return p.resolve() }
      }
      if args.op == "capture" {
        guard try ensureRegion(args, keep: p) else { return p.resolve(["ready": false]) }
        generation = max(generation, args.generation)
        return capture(args, p)
      }
      if args.owner != owner { return p.resolve(["ready": false]) }
      if ["move", "animate", "complete", "cancel", "finish"].contains(args.op) && turn != turnId {
        return p.resolve(["ready": false, "cancelled": true])
      }
      generation = max(generation, args.generation)
      switch args.op {
      case "abortCapture":
        captures.removeValue(forKey: requestId)?.resolve(["ready": false])
        if let key = requestKeys[requestId], uploadedRequests.contains(requestId),
          latestCapture[key] == requestId
        {
          view?.drop(key)
          latestCapture.removeValue(forKey: key)
        }
        p.resolve()
      case "cover":
        guard let view else { throw PaperError("Native paper surface missing") }
        turnId = turn
        dragging = false
        current = args.key ?? ""
        destination = current
        forward = true
        progress = 0
        grabY = 0.5
        try view.scene(current, current, true, false, 0, 0.5, 1)
        view.alpha = 1
        painted(p) { p.resolve() }
      case "idle":
        let coveredTurn = turnId
        // Preview restoration has reached JS, but the webview may still
        // present the neighbouring page.
        presented(p) { [weak self] in
          if self?.turnId == coveredTurn { self?.view?.alpha = 0 }
          p.resolve()
        }
      case "start":
        guard let view else { throw PaperError("Native paper surface missing") }
        let released = args.released ?? false
        turnId = turn
        current = args.key ?? ""
        destination = args.destination ?? ""
        forward = args.forward ?? true
        rtl = args.rtl ?? false
        cancelled = false
        completeRequested = false
        progress = Float(args.progress ?? 0)
        grabY = Float(args.grabY ?? 0.5)
        trackNativeTouch = finger && !released
        let bufferedRelease = released && progress > 0
        if bufferedRelease { progress = min(progress, 0.5) }
        if trackNativeTouch { updateFinger() }
        try view.scene(current, destination, forward, rtl, progress, grabY, args.columns ?? 1)
        active = true
        dragging = !bufferedRelease
        view.alpha = 1
        p.resolve(["touchTracked": trackNativeTouch])
      case "move":
        if active && dragging && !finger && animationPending == nil {
          progress = Float(args.progress ?? 0)
          grabY = Float(args.grabY ?? 0.5)
          requestDraw()
        }
        p.resolve()
      case "animate":
        animate(args, p)
      case "complete":
        completeRequested = true
        p.resolve()
      case "cancel":
        dragging = false
        cancelled = true
        animationTarget = 0
        if animationPending != nil {
          completeAnimation()
        } else {
          progress = 0
          view?.alpha = 0
          requestDraw()
        }
        p.resolve()
      case "finish":
        presented(p) { [weak self] in
          guard let self else { return p.resolve() }
          if turn != self.turnId { return p.resolve(["ready": false, "cancelled": true]) }
          self.active = false
          self.dragging = false
          self.view?.alpha = 0
          if self.dirtyAfterFinish {
            self.view?.clear(preserveScene: false)
            self.dirtyAfterFinish = false
          }
          p.resolve()
        }
      case "invalidate":
        captures.values.forEach { $0.resolve(["ready": false]) }
        captures.removeAll()
        latestCapture.removeAll()
        dirtyAfterFinish = active
        if !active { view?.alpha = 0 }
        view?.clear(preserveScene: active)
        p.resolve()
      case "dispose":
        dispose(except: p)
        p.resolve()
      default:
        p.reject("Unknown native paper command")
      }
    } catch {
      failAll(error.localizedDescription)
    }
  }

  /// Snapshot the webview beneath the sheet and upload a generation-checked page texture.
  private func capture(_ args: NativePaperArgs, _ p: Pending) {
    let requestId = args.requestId ?? 0
    let key = args.key ?? ""
    if let aborted = abortedRequests.firstIndex(of: "\(args.owner):\(requestId)") {
      abortedRequests.remove(at: aborted)
      return p.resolve(["ready": false])
    }
    guard !active, let webView else { return p.resolve(["ready": false]) }
    captures[requestId] = p
    latestCapture[key] = requestId
    requestKeys[requestId] = key
    requestOrder.append(requestId)
    while requestOrder.count > 32 {
      let oldest = requestOrder.removeFirst()
      requestKeys.removeValue(forKey: oldest)
      uploadedRequests.remove(oldest)
    }
    let valid = { [weak self] () -> Bool in
      guard let self else { return false }
      return p.live && self.owner == args.owner && self.generation == args.generation
        && self.latestCapture[key] == requestId && !self.active
    }
    // The snapshot renders the webview's own layers, never the sheet above
    // it, at full screen scale. It waits for the next presentation update.
    let config = WKSnapshotConfiguration()
    config.rect = region(args, in: webView)
    webView.takeSnapshot(with: config) { [weak self] image, error in
      guard let self else { return }
      self.captures.removeValue(forKey: requestId)
      guard valid() else { return p.resolve(["ready": false]) }
      guard let image = image?.cgImage else {
        return self.failAll(
          "Native page snapshot failed: \(error?.localizedDescription ?? "no image")")
      }
      guard let view = self.view else { return p.resolve(["ready": false]) }
      do {
        try view.upload(key, image)
        self.uploadedRequests.insert(requestId)
        p.resolve(["ready": true, "keys": view.keys])
      } catch {
        self.failAll(error.localizedDescription)
      }
    }
  }

  /// Track the native finger without consuming the webview touch sequence.
  private func touch(_ touch: PaperTouchObserver.Touch) {
    switch touch {
    case .down(let point):
      down = point
      last = point
      finger = true
      if animationPending != nil { completeRequested = true }
    case .move(let point):
      last = point
      if active && dragging && trackNativeTouch && animationPending == nil && finger {
        updateFinger()
        requestDraw()
      }
    case .up(let point):
      last = point
      if active && dragging && trackNativeTouch && animationPending == nil && finger {
        updateFinger()
        requestDraw()
      }
      finger = false
      dragging = false
    case .cancel:
      finger = false
      dragging = false
    case .multi:
      finger = false
    }
  }

  /// Translate the latest finger position into the current sheet pose.
  private func updateFinger() {
    let distance = forward != rtl ? down.x - last.x : last.x - down.x
    progress = Float(min(max(distance / width, 0), 1))
    grabY = Float(0.5 + (last.y - down.y) / height)
  }

  /// Coalesce finger-follow poses into one display refresh.
  private func requestDraw() {
    guard !drawScheduled else { return }
    drawScheduled = true
    FrameLink.after(1) { [weak self] in
      guard let self else { return }
      self.drawScheduled = false
      if self.active && self.animationPending == nil { self.draw() }
    }
  }

  private func draw() {
    do {
      try view?.draw(progress, grabY)
    } catch {
      failAll(error.localizedDescription)
    }
  }

  /// Settle the released sheet on the display link.
  private func animate(_ args: NativePaperArgs, _ p: Pending) {
    guard active else { return p.resolve(["cancelled": true]) }
    guard animationPending == nil else { return p.reject("Native paper already settling") }
    dragging = false
    animationPending = p
    animationTarget = (args.commit ?? false) && !cancelled ? 1 : 0
    let from = progress
    let span = abs(animationTarget - from)
    let velocity = abs(args.velocity ?? 0)
    let duration = max(
      100, min(240, velocity > 0.3 ? Double(span) * Double(width) / velocity : 240 * Double(span)))
    if span < 0.001 { return completeAnimation() }
    var lastTime: CFTimeInterval = 0
    var elapsed = 0.0
    animation = FrameLink { [weak self] _, now in
      guard let self, self.animationPending === p, p.live else { return }
      // A stalled frame advances the clock by at most 1/6 of the minimum
      // duration, so a hitch slows the sheet instead of skipping poses.
      if lastTime != 0 { elapsed += min(max((now - lastTime) * 1000, 0), 100.0 / 6) }
      lastTime = now
      // A following gesture accelerates the tail, keeping the 100 ms minimum.
      let settle = self.completeRequested ? min(duration, 100) : duration
      let t = min(elapsed / settle, 1)
      self.progress = from + (self.animationTarget - from) * Float(t)
      if t < 1 { self.draw() } else { self.completeAnimation() }
    }
  }

  /// Present the terminal pose before acknowledging settlement.
  private func completeAnimation() {
    guard let p = animationPending else { return }
    stopAnimation()
    progress = animationTarget
    do {
      try view?.draw(progress, grabY)
    } catch {
      return failAll(error.localizedDescription)
    }
    painted(p) { [weak self] in
      if self?.animationPending === p { self?.animationPending = nil }
      p.resolve(["cancelled": self?.cancelled ?? true])
    }
  }

  /// Drop the scene when the webview loads a new document. The old page can
  /// no longer finish its turn, and a held sheet would refuse the new reader.
  func reset() {
    dispose(except: nil)
  }

  /// Release the scene and settle outstanding requests except the caller being disposed.
  private func dispose(except keep: Pending?) {
    stopAnimation()
    animationPending = nil
    active = false
    dragging = false
    pending.filter { $0 !== keep }.forEach { $0.resolve(["ready": false, "cancelled": true]) }
    view?.removeFromSuperview()
    view = nil
    clearRequests()
    owner = 0
  }
}

/// A Metal sheet placed above the webview. `takeSnapshot` renders only the
/// webview's own layers, so capturing a neighbour never sees this cover.
/// Frames present with the Core Animation transaction that changes its alpha.
final class NativePaperView: UIView {
  private struct GPU {
    let device: MTLDevice
    let queue: MTLCommandQueue
    let pipeline: MTLRenderPipelineState
    let depthState: MTLDepthStencilState
    let nearest: MTLSamplerState
    let linear: MTLSamplerState
  }
  private static var shared: GPU?

  override class var layerClass: AnyClass { CAMetalLayer.self }
  private var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
  private let gpu: GPU
  private var depth: MTLTexture?
  private var pixelsWide = 0
  private var pixelsHigh = 0
  private var textures: [String: MTLTexture] = [:]
  private(set) var keys: [String] = []
  private let mesh = NativePaperMesh()
  private var current: String?
  private var destination: String?
  private var forward = true
  private var rtl = false
  private var columns = 1
  private var progress: Float = 0
  private var grabY: Float = 0.5

  init(scale: CGFloat) throws {
    gpu = try Self.makeGPU()
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = .clear
    isUserInteractionEnabled = false
    contentScaleFactor = scale
    metalLayer.device = gpu.device
    metalLayer.pixelFormat = .bgra8Unorm
    metalLayer.isOpaque = false
    metalLayer.framebufferOnly = true
    // Each frame commits with the transaction that shows or hides the sheet.
    metalLayer.presentsWithTransaction = true
  }

  required init?(coder: NSCoder) { nil }

  private static func makeGPU() throws -> GPU {
    if let shared { return shared }
    guard let device = MTLCreateSystemDefaultDevice(), let queue = device.makeCommandQueue() else {
      throw PaperError("Metal is unavailable for native paper")
    }
    let library = try device.makeLibrary(source: shaders, options: nil)
    let descriptor = MTLRenderPipelineDescriptor()
    descriptor.vertexFunction = library.makeFunction(name: "paperVertex")
    descriptor.fragmentFunction = library.makeFunction(name: "paperFragment")
    descriptor.depthAttachmentPixelFormat = .depth32Float
    let color = descriptor.colorAttachments[0]!
    color.pixelFormat = .bgra8Unorm
    color.isBlendingEnabled = true
    color.sourceRGBBlendFactor = .sourceAlpha
    color.destinationRGBBlendFactor = .oneMinusSourceAlpha
    color.sourceAlphaBlendFactor = .one
    color.destinationAlphaBlendFactor = .oneMinusSourceAlpha
    let depthDescriptor = MTLDepthStencilDescriptor()
    depthDescriptor.depthCompareFunction = .lessEqual
    depthDescriptor.isDepthWriteEnabled = true
    let sampler = { (filter: MTLSamplerMinMagFilter) -> MTLSamplerState? in
      let descriptor = MTLSamplerDescriptor()
      descriptor.minFilter = filter
      descriptor.magFilter = filter
      descriptor.sAddressMode = .clampToEdge
      descriptor.tAddressMode = .clampToEdge
      return device.makeSamplerState(descriptor: descriptor)
    }
    guard let depthState = device.makeDepthStencilState(descriptor: depthDescriptor),
      let nearest = sampler(.nearest), let linear = sampler(.linear)
    else { throw PaperError("Cannot create native paper GPU state") }
    let gpu = GPU(
      device: device, queue: queue,
      pipeline: try device.makeRenderPipelineState(descriptor: descriptor),
      depthState: depthState, nearest: nearest, linear: linear)
    shared = gpu
    return gpu
  }

  /// Move the sheet and size its drawable to the region's device pixels.
  func place(_ frame: CGRect) {
    self.frame = frame
    let wide = Int((frame.width * contentScaleFactor).rounded())
    let high = Int((frame.height * contentScaleFactor).rounded())
    guard wide != pixelsWide || high != pixelsHigh else { return }
    pixelsWide = wide
    pixelsHigh = high
    metalLayer.drawableSize = CGSize(width: wide, height: high)
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .depth32Float, width: max(wide, 1), height: max(high, 1), mipmapped: false)
    descriptor.usage = .renderTarget
    descriptor.storageMode = .private
    depth = gpu.device.makeTexture(descriptor: descriptor)
  }

  /// Upload a snapshot and retain at most three pages, keeping the active scene.
  /// WebKit snapshots can use pixel formats MTKTextureLoader cannot decode, so
  /// the page is redrawn as 8-bit BGRA first; bitmap row 0 is the page's top.
  func upload(_ key: String, _ image: CGImage) throws {
    let wide = image.width, high = image.height
    guard
      let context = CGContext(
        data: nil, width: wide, height: high, bitsPerComponent: 8, bytesPerRow: wide * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
          | CGBitmapInfo.byteOrder32Little.rawValue)
    else { throw PaperError("Cannot decode native page snapshot") }
    context.draw(image, in: CGRect(x: 0, y: 0, width: wide, height: high))
    let descriptor = MTLTextureDescriptor.texture2DDescriptor(
      pixelFormat: .bgra8Unorm, width: wide, height: high, mipmapped: false)
    descriptor.usage = .shaderRead
    guard let pixels = context.data, let texture = gpu.device.makeTexture(descriptor: descriptor)
    else { throw PaperError("Cannot allocate native page texture") }
    texture.replace(
      region: MTLRegionMake2D(0, 0, wide, high), mipmapLevel: 0, withBytes: pixels,
      bytesPerRow: context.bytesPerRow)
    textures[key] = texture
    keys.removeAll { $0 == key }
    keys.append(key)
    while keys.count > 3,
      let oldest = keys.first(where: { $0 != current && $0 != destination })
    {
      keys.removeAll { $0 == oldest }
      textures.removeValue(forKey: oldest)
    }
  }

  /// Select the resident source and destination pages and draw the initial pose.
  func scene(
    _ from: String, _ to: String, _ forwards: Bool, _ mirrored: Bool, _ p: Float, _ y: Float,
    _ spreadColumns: Int
  ) throws {
    guard textures[from] != nil, textures[to] != nil else {
      throw PaperError("Native page textures are not ready")
    }
    current = from
    destination = to
    forward = forwards
    rtl = mirrored
    columns = spreadColumns
    try draw(p, y)
  }

  /// Draw a pose of the current scene.
  func draw(_ p: Float, _ y: Float) throws {
    progress = min(max(p, 0), 1)
    grabY = y
    try render()
  }

  /// Evict obsolete pages, optionally preserving both pages of the active scene.
  func clear(preserveScene: Bool) {
    for key in keys where !preserveScene || (key != current && key != destination) {
      textures.removeValue(forKey: key)
    }
    keys.removeAll { textures[$0] == nil }
    guard !preserveScene else { return }
    current = nil
    destination = nil
    try? render()
  }

  func drop(_ key: String) {
    textures.removeValue(forKey: key)
    keys.removeAll { $0 == key }
  }

  /// Draw both layers into the next drawable and present it with the current transaction.
  private func render() throws {
    guard pixelsWide > 0, pixelsHigh > 0, let depth else { return }
    guard let drawable = metalLayer.nextDrawable() else {
      throw PaperError("Native paper frame could not be presented")
    }
    let pass = MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture = drawable.texture
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    pass.colorAttachments[0].storeAction = .store
    pass.depthAttachment.texture = depth
    pass.depthAttachment.loadAction = .clear
    pass.depthAttachment.clearDepth = 1
    pass.depthAttachment.storeAction = .dontCare
    guard let commands = gpu.queue.makeCommandBuffer(),
      let encoder = commands.makeRenderCommandEncoder(descriptor: pass)
    else { throw PaperError("Cannot encode native paper frame") }
    encoder.setRenderPipelineState(gpu.pipeline)
    encoder.setDepthStencilState(gpu.depthState)
    var page = SIMD2<Float>(Float(pixelsWide), Float(pixelsHigh))
    encoder.setVertexBytes(&page, length: MemoryLayout<SIMD2<Float>>.size, index: 1)
    encoder.setFragmentBytes(&page, length: MemoryLayout<SIMD2<Float>>.size, index: 1)
    let base = forward ? destination : current
    let sheet = forward ? current : destination
    let pose = forward ? progress : 1 - progress
    try drawPage(encoder, base, 0, 0.5)
    // A backward spread turn is the previous spread's forward turn, reversed.
    if columns >= 2 {
      try drawPage(encoder, sheet, pose, grabY, columns, back: base)
    } else {
      try drawPage(encoder, sheet, pose, grabY)
    }
    encoder.endEncoding()
    commands.commit()
    commands.waitUntilScheduled()
    drawable.present()
  }

  /// Render one textured sheet. A spread sheet turns only its outer column;
  /// `back` is the spread its leaf lands on.
  private func drawPage(
    _ encoder: MTLRenderCommandEncoder, _ key: String?, _ p: Float, _ y: Float,
    _ spreadColumns: Int = 1, back: String? = nil
  ) throws {
    guard let key, let texture = textures[key] else { return }
    let backTexture = back.flatMap { textures[$0] }
    guard mesh.build(pixelsWide, pixelsHigh, p, y, rtl, spreadColumns) > 0 else { return }
    guard
      let vertices = mesh.vertices.withUnsafeBytes({
        gpu.device.makeBuffer(bytes: $0.baseAddress!, length: mesh.count * 4)
      })
    else { throw PaperError("Cannot allocate native paper mesh") }
    var spread: Float = backTexture != nil ? 1 : 0
    encoder.setVertexBuffer(vertices, offset: 0, index: 0)
    encoder.setFragmentBytes(&spread, length: MemoryLayout<Float>.size, index: 0)
    encoder.setFragmentTexture(texture, index: 0)
    encoder.setFragmentTexture(backTexture ?? texture, index: 1)
    // A flat device-pixel sheet must not blend adjacent text pixels. Only
    // the projected, moving leaf needs interpolation.
    encoder.setFragmentSamplerState(p <= 0 ? gpu.nearest : gpu.linear, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: mesh.count / 6)
  }

  private static let shaders = """
    #include <metal_stdlib>
    using namespace metal;
    struct PaperOut { float4 position [[position]]; float2 uv; float shade; float height; };
    vertex PaperOut paperVertex(uint id [[vertex_id]], const device float *v [[buffer(0)]],
                                constant float2 &page [[buffer(1)]]) {
      const device float *p = v + id * 6;
      float depth = 2.0 * p[4] / (7.0 * page.x);
      float2 clip = float2(p[2], p[3]) / page * 2.0 - 1.0;
      float w = 1.0 - depth;
      PaperOut out;
      // The Android shader's clip z is -depth over [-w, w]; Metal's range is [0, w].
      out.position = float4(clip.x, -clip.y + depth, (w - depth) * 0.5, w);
      out.uv = float2(p[0], p[1]);
      out.shade = p[5];
      out.height = p[4];
      return out;
    }
    fragment float4 paperFragment(PaperOut in [[stage_in]], texture2d<float> tex [[texture(0)]],
                                  texture2d<float> backTex [[texture(1)]], sampler s [[sampler(0)]],
                                  constant float &spread [[buffer(0)]],
                                  constant float2 &page [[buffer(1)]]) {
      float4 color = tex.sample(s, in.uv);
      float back = step(0.5, in.shade);
      float3 rgb = mix(color.rgb, mix(float3(0.5), color.rgb, 0.6), back);
      // A spread leaf's back is the facing column of the spread it lands on,
      // mirrored about the spine, so the landed leaf matches that page.
      if (spread > 0.5 && back > 0.5) {
        color = backTex.sample(s, float2(1.0 - in.uv.x, in.uv.y));
        rgb = color.rgb;
      }
      rgb = mix(rgb, float3(0.5), in.shade - back);
      if (in.height > 10.0) {
        float2 edge = min(in.uv, 1.0 - in.uv) * page / 2.0;
        float border = clamp(1.0 - min(edge.x, edge.y), 0.0, 1.0);
        rgb = mix(rgb, float3(0.5), 0.4 * border);
      }
      return float4(rgb, color.a);
    }
    """
}
