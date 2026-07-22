import ObjectiveC
import UIKit
import WebKit
import os

private let logger = Logger(
  subsystem: Bundle.main.bundleIdentifier!, category: "TextSelectionSuppressor")

/// Suppresses the iOS long-press text selection for non-editable web content
/// while the reader's instant-highlight quick action is active, so the system
/// selection (and its drag handles) can never race the app's own hold-to-
/// highlight gesture.
///
/// This must be done natively: WebKit's text-interaction gesture recognizers
/// consult selectability before any DOM touch handler runs, `selectstart`
/// never fires for iOS long-press selections, and `user-select: none` breaks
/// `caretRangeFromPoint` (which the instant highlight relies on). The two
/// hooks below are the point-based gates UIKit queries before starting a
/// selection gesture; returning false refuses the gesture without affecting
/// touch delivery, clicks, caret DOM APIs, or focusing editable fields
/// (verified on the iOS 18.5 simulator).
///
/// Editable contexts (inputs, textareas — e.g. the note editor) are exempt via
/// the same first-responder probe ContextMenuSuppressor uses, so caret
/// placement and selection inside fields keep working while suppression is on.
enum TextSelectionSuppressor {
  private static var installed = false
  private static var suppressed = false

  /// Toggles suppression; installs the hooks on first use. Safe to call from
  /// any thread and repeatedly.
  static func setSuppressed(_ enabled: Bool) {
    suppressed = enabled
    if enabled { installIfNeeded() }
  }

  private static func installIfNeeded() {
    guard !installed else { return }
    installed = true

    guard let contentViewClass = NSClassFromString("WKContentView") else {
      logger.warning("WKContentView class not found; selection suppression disabled")
      return
    }

    // - (BOOL)hasSelectablePositionAtPoint:(CGPoint)point
    swizzlePointGate(on: contentViewClass, name: "hasSelectablePositionAtPoint:")
    // - (BOOL)textInteractionGesture:(UIWKGestureType)gesture shouldBeginAtPoint:(CGPoint)point
    swizzleGesturePointGate(on: contentViewClass, name: "textInteractionGesture:shouldBeginAtPoint:")
  }

  // MARK: - Editable-context probe (same approach as ContextMenuSuppressor)

  private static let cutSelector = #selector(UIResponderStandardEditActions.cut(_:))
  private static let pasteSelector = #selector(UIResponderStandardEditActions.paste(_:))

  private static func isEditableContext(_ responder: UIResponder) -> Bool {
    responder.canPerformAction(cutSelector, withSender: nil)
      || responder.canPerformAction(pasteSelector, withSender: nil)
  }

  private static func shouldSuppress(_ receiver: AnyObject) -> Bool {
    guard suppressed else { return false }
    let editable = (receiver as? UIResponder).map(isEditableContext) ?? false
    return !editable
  }

  // MARK: - Gate swizzles

  private static func swizzlePointGate(on cls: AnyClass, name: String) {
    let selector = NSSelectorFromString(name)
    guard let method = class_getInstanceMethod(cls, selector) else {
      logger.warning("\(name) not found; this selection gate is not hooked")
      return
    }
    typealias OriginalIMP = @convention(c) (AnyObject, Selector, CGPoint) -> Bool
    let originalIMP = unsafeBitCast(method_getImplementation(method), to: OriginalIMP.self)
    let block: @convention(block) (AnyObject, CGPoint) -> Bool = { receiver, point in
      if shouldSuppress(receiver) { return false }
      return originalIMP(receiver, selector, point)
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }

  private static func swizzleGesturePointGate(on cls: AnyClass, name: String) {
    let selector = NSSelectorFromString(name)
    guard let method = class_getInstanceMethod(cls, selector) else {
      logger.warning("\(name) not found; this selection gate is not hooked")
      return
    }
    typealias OriginalIMP = @convention(c) (AnyObject, Selector, Int, CGPoint) -> Bool
    let originalIMP = unsafeBitCast(method_getImplementation(method), to: OriginalIMP.self)
    let block: @convention(block) (AnyObject, Int, CGPoint) -> Bool = { receiver, gesture, point in
      if shouldSuppress(receiver) { return false }
      return originalIMP(receiver, selector, gesture, point)
    }
    method_setImplementation(method, imp_implementationWithBlock(block))
  }
}
