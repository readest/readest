import ObjectiveC
import UIKit
import WebKit
import os

private let logger = Logger(
  subsystem: Bundle.main.bundleIdentifier!, category: "ContextMenuSuppressor")

/// Suppresses the iOS system text-selection menu (Copy / Look Up / Translate
/// / Share) for non-editable web content, so it never covers Readest's own
/// annotation toolbar.
///
/// Three hooks are installed; together they cover every code path iOS uses to
/// present that menu:
///
///  * `WKContentView.editMenuInteraction(_:menuForConfiguration:suggestedActions:)`
///    — the `UIEditMenuInteraction` delegate method WebKit uses to *build* the
///    menu on iOS 16+. This is the menu users actually see on modern iOS.
///    Returning an empty `UIMenu` means nothing is presented.
///  * `UIEditMenuInteraction.presentEditMenu(with:)` — the present-time hook,
///    a backstop in case WebKit presents without re-querying the delegate.
///  * `WKContentView.canPerformAction(_:withSender:)` — the legacy
///    `UIMenuController` gate used on iOS 15 and earlier.
///
/// All three keep the native menu intact for editable HTML fields (so Paste /
/// Select All still work) via an editable-context probe: an editable
/// selection reports `cut:` true, an editable caret with clipboard content
/// reports `paste:` true, and non-editable web content reports both false.
enum ContextMenuSuppressor {
  private static var installed = false

  /// Installs the hooks once per process. Safe to call repeatedly.
  static func installIfNeeded() {
    guard !installed else { return }
    installed = true

    // `WKContentView` is the private first-responder subview that hosts the
    // web content and the selection menu. A future Apple rename makes this
    // lookup fail; we log and no-op rather than crash.
    guard let contentViewClass = NSClassFromString("WKContentView") else {
      logger.warning("WKContentView class not found; menu suppression disabled")
      return
    }

    installCanPerformActionSwizzle(on: contentViewClass)
    if #available(iOS 16.0, *) {
      installEditMenuSwizzle(on: contentViewClass)
      installPresentEditMenuSwizzle()
    }
  }

  // MARK: - Editable-context probe

  private static let cutSelector = #selector(UIResponderStandardEditActions.cut(_:))
  private static let pasteSelector = #selector(UIResponderStandardEditActions.paste(_:))

  /// Whether `responder`'s current selection is inside an editable field.
  /// `canPerformAction` is a side-effect-free query, so this is safe to call
  /// while a menu is being built.
  private static func isEditableContext(_ responder: UIResponder) -> Bool {
    responder.canPerformAction(cutSelector, withSender: nil)
      || responder.canPerformAction(pasteSelector, withSender: nil)
  }

  // MARK: - iOS 16+ edit menu (the menu users see on modern iOS)

  @available(iOS 16.0, *)
  private static func installEditMenuSwizzle(on cls: AnyClass) {
    let selector = NSSelectorFromString(
      "editMenuInteraction:menuForConfiguration:suggestedActions:")
    guard let method = class_getInstanceMethod(cls, selector) else {
      logger.warning(
        "editMenuInteraction delegate method not found; iOS 16+ menu suppression disabled")
      return
    }

    // Capture the original IMP before replacing it; calls through this
    // pointer bypass the swizzle, so there is no recursion.
    typealias OriginalIMP = @convention(c) (
      AnyObject, Selector, UIEditMenuInteraction, UIEditMenuConfiguration, [UIMenuElement]
    ) -> UIMenu?
    let originalIMP = unsafeBitCast(
      method_getImplementation(method), to: OriginalIMP.self)

    // IMP-from-block receives (self, args...) — no `_cmd`.
    let block:
      @convention(block) (
        AnyObject, UIEditMenuInteraction, UIEditMenuConfiguration, [UIMenuElement]
      ) -> UIMenu? = { receiver, interaction, configuration, suggestedActions in
        let editable = (receiver as? UIResponder).map(isEditableContext) ?? false
        if editable {
          return originalIMP(receiver, selector, interaction, configuration, suggestedActions)
        }
        // Non-editable selection: an empty menu presents nothing. Text
        // selection and drag handles are unaffected.
        return UIMenu(title: "", children: [])
      }

    method_setImplementation(method, imp_implementationWithBlock(block))
  }

  // MARK: - iOS 16+ present-time backstop

  @available(iOS 16.0, *)
  private static func installPresentEditMenuSwizzle() {
    let selector = #selector(UIEditMenuInteraction.presentEditMenu(with:))
    guard let method = class_getInstanceMethod(UIEditMenuInteraction.self, selector) else {
      logger.warning(
        "presentEditMenu(with:) not found; present-time suppression disabled")
      return
    }

    typealias OriginalIMP = @convention(c) (
      AnyObject, Selector, UIEditMenuConfiguration
    ) -> Void
    let originalIMP = unsafeBitCast(
      method_getImplementation(method), to: OriginalIMP.self)

    let block: @convention(block) (AnyObject, UIEditMenuConfiguration) -> Void = {
      receiver, configuration in
      let view = (receiver as? UIEditMenuInteraction)?.view
      let editable = view.map(isEditableContext) ?? false
      if editable {
        originalIMP(receiver, selector, configuration)
      }
      // Non-editable selection: skip presentation entirely.
    }

    method_setImplementation(method, imp_implementationWithBlock(block))
  }

  // MARK: - Legacy UIMenuController (iOS 15 and earlier)

  private static func installCanPerformActionSwizzle(on cls: AnyClass) {
    let selector = #selector(UIResponder.canPerformAction(_:withSender:))
    guard let method = class_getInstanceMethod(cls, selector) else {
      logger.warning(
        "canPerformAction(_:withSender:) not found; legacy menu suppression disabled")
      return
    }

    typealias OriginalIMP =
      @convention(c) (AnyObject, Selector, Selector, Any?) -> Bool
    let originalIMP = unsafeBitCast(
      method_getImplementation(method), to: OriginalIMP.self)

    let block: @convention(block) (AnyObject, Selector, Any?) -> Bool = {
      receiver, action, sender in
      let editable =
        originalIMP(receiver, selector, cutSelector, sender)
        || originalIMP(receiver, selector, pasteSelector, sender)
      if editable {
        return originalIMP(receiver, selector, action, sender)
      }
      // Non-editable selection: report false for every action so the system
      // builds an empty edit menu and never presents it.
      return false
    }

    method_setImplementation(method, imp_implementationWithBlock(block))
  }
}
