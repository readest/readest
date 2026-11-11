import ObjectiveC
import UIKit
import os

private let logger = Logger(
  subsystem: Bundle.main.bundleIdentifier!, category: "OrientationLock")

/// Keeps the reader's orientation lock working when the scene is resizable.
///
/// Readest doesn't require full screen, so on an iPad, or on the iPhone Duo's
/// inner display, iOS treats the app as resizable. It then ignores the
/// supported-orientations mask and refuses `requestGeometryUpdate`. In that
/// windowing mode the only lock is the iOS 26 preference
/// `prefersInterfaceOrientationLocked`, which holds the scene in its current
/// orientation. The app can't rotate itself into the locked orientation, so
/// the lock waits until the user turns the device that way, then holds it.
@available(iOS 26.0, *)
enum OrientationLock {
  private static let selector = NSSelectorFromString("prefersInterfaceOrientationLocked")
  private static var installedClasses = Set<ObjectIdentifier>()
  private static var mask: UIInterfaceOrientationMask = .all
  private static var locked = false
  private static var observation: NSKeyValueObservation?

  /// Sets the orientations to hold; `.all` releases the lock.
  static func apply(_ mask: UIInterfaceOrientationMask, in scene: UIWindowScene) {
    self.mask = mask
    for window in scene.windows {
      if let rootVC = window.rootViewController {
        installIfNeeded(on: type(of: rootVC))
      }
    }
    observation = nil
    if mask != .all {
      // Rotation, resizing and occlusion all change the effective geometry.
      observation = scene.observe(\.effectiveGeometry) { scene, _ in
        DispatchQueue.main.async { update(scene) }
      }
    }
    update(scene)
  }

  private static func update(_ scene: UIWindowScene) {
    let current = maskFor(scene.effectiveGeometry.interfaceOrientation)
    let shouldLock = mask != .all && mask.contains(current)
    guard shouldLock != locked else { return }
    locked = shouldLock
    for window in scene.windows {
      window.rootViewController?.setNeedsUpdateOfPrefersInterfaceOrientationLocked()
    }
  }

  private static func maskFor(_ orientation: UIInterfaceOrientation) -> UIInterfaceOrientationMask {
    switch orientation {
    case .portrait: return .portrait
    case .portraitUpsideDown: return .portraitUpsideDown
    case .landscapeLeft: return .landscapeLeft
    case .landscapeRight: return .landscapeRight
    default: return []
    }
  }

  /// Makes the root view controller report `locked`. The window's root view
  /// controller belongs to Tauri, so its class gets the override at runtime;
  /// every other view controller keeps the inherited answer.
  private static func installIfNeeded(on cls: AnyClass) {
    guard installedClasses.insert(ObjectIdentifier(cls)).inserted else { return }
    guard let inherited = class_getInstanceMethod(cls, selector) else {
      logger.warning("prefersInterfaceOrientationLocked not found; orientation lock disabled")
      return
    }

    typealias OriginalIMP = @convention(c) (AnyObject, Selector) -> Bool
    let originalIMP = unsafeBitCast(method_getImplementation(inherited), to: OriginalIMP.self)

    let block: @convention(block) (AnyObject) -> Bool = { receiver in
      if let vc = receiver as? UIViewController, vc.viewIfLoaded?.window?.rootViewController === vc {
        return locked
      }
      return originalIMP(receiver, selector)
    }
    let imp = imp_implementationWithBlock(block)
    // Add the override to this class only, unless it already has its own.
    if !class_addMethod(cls, selector, imp, method_getTypeEncoding(inherited)) {
      method_setImplementation(inherited, imp)
    }
  }
}
