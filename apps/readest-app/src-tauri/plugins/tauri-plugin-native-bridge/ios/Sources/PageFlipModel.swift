import Foundation

/*
 * Page Flip physics, adapted from page-turn-core (rolled-page-strip.ts,
 * page-turn-worklet.ts) of react-native-natural-page-turn. The Swift twin of
 * the Android `PageFlipModel.kt` and the browser `pageFlipModel.ts`.
 *
 * MIT License
 *
 * Copyright (c) 2026 yum
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

private func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
  min(high, max(low, value))
}

/// An inextensible paper sheet seen from the side, turning forward over a
/// spine at its left edge. The fold is vertical; the profile carries a pinned
/// elastica bow while held and relaxes toward a cylinder once released.
///
/// Coordinates are in page widths: material 0 is the spine, 1 the free edge.
/// x runs right, z towards the viewer. A backward turn is the same motion
/// mirrored about the spine (see `frame`).
final class PageFlipModel {
  static let points = 65
  private static let segments = points - 1
  static let runs = 4
  /// Floats `frame` writes: the profile, its runs, then the cast shadow.
  static let frameSize = points * 4 + runs * 4 + 4
  static let minPressedEdgeX = 0.14
  private static let pressedSurfaceClearance = 0.015
  private static let inverseBessel = [
    2.1667709839070377, -0.18629174453685354, 0.02265270180455248, -0.0037165828681793253,
    0.0007038952663799921, -0.00014500246546194032, 0.000031566578791633,
    -0.000007135535298704449, 0.0000016623788064225635, -0.0000003841457726910674,
    0.00000009309814723863693,
  ]
  private static let inverseBesselMinChord = 0.035
  private static let maxProfileBendAmplitude = 2.147033481101353
  private static let gestureLiftStartX = 0.36
  private static let gestureRollTiltRate = 0.4
  private static let gestureHingeBendAmplitude = 2.1266855842119465
  private static let fullGestureStartMinX = 0.25
  private static let weakGripMaxCompression = 0.04
  private static let weakGripCompressionPerPage = 0.2
  private static let velocityTimeConstant = 0.045
  private static let maxTrackedVelocity = 6.0
  private static let minRevertInitialSpeed = 0.65
  private static let maxRevertInitialSpeed = 6.3
  private static let revertEaseOutInitialSlope = 3.0
  /// Seconds to unwind a whole released turn back to the fold.
  private static let unturnDuration = 0.8
  private static let pressDuration = 0.12
  private static let propagationSpeedScale = 1.15
  // Drag tuning; a tap uses the automatic-turn tuning in play().
  private static let defaultReleaseX = 0.72
  private static let defaultLiftVelocity = 1.35
  private static let defaultLiftToLeft = 2.0
  private static let curvatureRelaxation = 7.0
  private static let minSpeedScale = 0.95
  private static let maxSpeedScale = 2.0
  private static let velocityGain = 0.6
  private static let idleDecaySeconds = 0.09
  /// A tap plays the automatic turn this many times its natural pace.
  private static let tapPlayback = 1.6
  private static let cameraDistance = 4.0
  private static let maxPerspectiveScale = 1.34
  private static let minShadowWidth = 0.045
  private static let maxShadowWidth = 0.28
  private static let maxShadowStrength = 0.34

  /// Inverse of the symmetric elastica chord (Chebyshev fit of inverse J0).
  private static func bendAmplitudeForChord(_ chord: Double) -> Double {
    if chord >= 0.999999 { return 0 }
    let safe = clamp(chord, minPressedEdgeX, 0.999999)
    let x = 2 * (safe - inverseBesselMinChord) / (1 - inverseBesselMinChord) - 1
    var beforePrevious = 0.0
    var previous = 0.0
    for i in stride(from: inverseBessel.count - 1, through: 1, by: -1) {
      let current = 2 * x * previous - beforePrevious + inverseBessel[i]
      beforePrevious = previous
      previous = current
    }
    return (x * previous - beforePrevious + inverseBessel[0]) * sqrt(max(0, 1 - safe))
  }

  private static let maxPressedRollTilt = max(
    0, Double.pi - bendAmplitudeForChord(minPressedEdgeX) - pressedSurfaceClearance)
  private static let hingeRotation = maxPressedRollTilt * gestureRollTiltRate
  private static let hingeChordX = minPressedEdgeX / cos(hingeRotation)
  private static let quadrature: [Double] = (0..<segments * 2).map { i in
    (Double(i / 2) + 0.5 + (i % 2 == 0 ? -1 : 1) * 0.5 / sqrt(3.0)) / Double(segments)
  }

  private enum Phase { case idle, drag, press, turn, unturn, revert, completed }
  private var phase = Phase.idle
  private var releaseX = defaultReleaseX
  private var liftVelocity = defaultLiftVelocity
  private var liftToLeft = defaultLiftToLeft
  private var relaxation = curvatureRelaxation
  private var playback = 1.0

  /// Physical profile: x, z, normalX, normalZ per point.
  private var profile = [Float](repeating: 0, count: points * 4)
  private var previousX = [Float](repeating: 0, count: points)
  private var previousZ = [Float](repeating: 0, count: points)

  private var startBookX = 1.0
  private var lastBookX = 1.0
  private var lastTime = 0.0
  private var velocityX = 0.0
  private var velocityY = 0.0
  private var lastBookY = 0.5
  private var fingerX = 1.0
  private var pressedEdgeX = 1.0
  private var heldRollTilt = 0.0
  private var weakGrip = false
  private var dragTurnProgress = 0.0
  private var driveElapsed = 0.0
  private var driveStartX = defaultReleaseX
  private var driveSpeedScale = 1.0
  private var driveStartProgress = 0.0
  private var driveStartRotation = 0.0
  private var revertStartX = defaultReleaseX
  private var revertCompleteness = 0.0
  private var revertStartRotation = 0.0
  private var maxLift = 0.0
  private var meanSpeed = 0.0
  private var edgeVelocityX = 0.0
  private var curvature = 0.0
  private var flatteningRate = 0.0

  init() { reset() }

  /// Lay the sheet flat and idle.
  func reset() {
    phase = .idle
    dragTurnProgress = 0
    driveElapsed = 0
    for i in 0..<Self.points {
      let material = Float(i) / Float(Self.segments)
      profile[i * 4] = material
      profile[i * 4 + 1] = 0
      profile[i * 4 + 2] = 0
      profile[i * 4 + 3] = 1
      previousX[i] = material
      previousZ[i] = 0
    }
    maxLift = 0
    meanSpeed = 0
    edgeVelocityX = 0
    curvature = 0
    flatteningRate = 0
  }

  /// A finger takes the sheet at `x`, `y` (page fractions from the spine); time in seconds.
  func beginDrag(_ x: Double, _ y: Double, _ time: Double) {
    reset()
    releaseX = Self.defaultReleaseX
    liftVelocity = Self.defaultLiftVelocity
    liftToLeft = Self.defaultLiftToLeft
    relaxation = Self.curvatureRelaxation
    playback = 1
    phase = .drag
    startBookX = x
    lastBookX = x
    lastBookY = y
    lastTime = time
    velocityX = 0
    velocityY = 0
    fingerX = 1
    pressedEdgeX = 1
    heldRollTilt = 0
    weakGrip = x < Self.fullGestureStartMinX
    applyDraggedProfile(x, 0)
  }

  /// The finger moves to `x`, `y`. Past the fold the sheet leaves it and turns.
  func moveDrag(_ x: Double, _ y: Double, _ time: Double) {
    guard phase == .drag else { return }
    let dt = max(0.001, time - lastTime)
    let limit = Self.maxTrackedVelocity
    let vx = clamp((x - lastBookX) / dt, -limit, limit)
    let vy = clamp((y - lastBookY) / dt, -limit, limit)
    let blend = 1 - exp(-dt / Self.velocityTimeConstant)
    velocityX += (vx - velocityX) * blend
    velocityY += (vy - velocityY) * blend
    lastBookX = x
    lastBookY = y
    lastTime = time
    applyDraggedProfile(x, dt)
  }

  /// End a drag with the caller's outcome, carrying the held pose into the drive. A tap plays the whole turn.
  func release(_ commit: Bool, _ time: Double) {
    guard phase == .drag else {
      if commit { play() } else { reset() }
      return
    }
    let decay = exp(-max(0, time - lastTime) / Self.idleDecaySeconds)
    let throwSpeed = throwVelocity() * decay
    driveElapsed = 0
    if commit {
      phase = .turn
      driveStartX = pressedEdgeX
      driveStartProgress = dragTurnProgress
      driveStartRotation = heldRollTilt
      driveSpeedScale = clamp(
        Self.minSpeedScale + max(0, throwSpeed) * Self.velocityGain, Self.minSpeedScale,
        Self.maxSpeedScale)
    } else if dragTurnProgress > 0 {
      // Past the fold, wind the turn back to it before relaxing.
      phase = .unturn
      driveStartProgress = dragTurnProgress
    } else {
      beginRevert(pressedEdgeX, heldRollTilt)
    }
  }

  private func play() {
    reset()
    releaseX = 0.9
    liftVelocity = 0.5
    liftToLeft = 4
    relaxation = 10
    playback = Self.tapPlayback
    phase = .press
  }

  /// Advance a driven phase; returns true while still moving.
  func advance(_ deltaTime: Double) -> Bool {
    var remaining = clamp(deltaTime * playback, 0, 0.25)
    while remaining > 0 && moving {
      let step = min(0.05, remaining)
      self.step(step)
      remaining -= step
    }
    return moving
  }

  private var moving: Bool {
    phase == .press || phase == .turn || phase == .unturn || phase == .revert
  }

  private func step(_ dt: Double) {
    driveElapsed += dt
    switch phase {
    case .press:
      let progress = min(1, driveElapsed / Self.pressDuration)
      rebuildPressed(1 + (releaseX - 1) * progress, 0, dt)
      if progress >= 1 {
        phase = .turn
        driveElapsed = 0
        driveStartX = releaseX
        driveStartProgress = 0
        driveStartRotation = 0
        driveSpeedScale = 1
      }
    case .turn:
      let propagation = liftVelocity * liftToLeft * Self.propagationSpeedScale * driveSpeedScale
      let fullDuration =
        (driveStartX + 1) * ((Double.pi - driveStartRotation) / Double.pi) / max(0.1, propagation)
      let duration = max(1e-6, (1 - driveStartProgress) * fullDuration)
      let progress = driveStartProgress + (1 - driveStartProgress) * min(1, driveElapsed / duration)
      rebuildTurn(progress, driveStartX, driveStartRotation, dt)
      if progress >= 1 {
        phase = .completed
        meanSpeed = 0
        edgeVelocityX = 0
        flatteningRate = 0
      }
    case .unturn:
      let progress = clamp(
        driveElapsed / max(1e-6, Self.unturnDuration * driveStartProgress), 0, 1)
      rebuildTurn(
        driveStartProgress * pow(1 - progress, 3), Self.hingeChordX, Self.hingeRotation, dt)
      if progress >= 1 {
        driveElapsed = 0
        beginRevert(Self.hingeChordX, Self.hingeRotation)
      }
    case .revert:
      let distance = max(0, 1 - clamp(revertStartX, 0, 1))
      let speed =
        Self.minRevertInitialSpeed
        + (Self.maxRevertInitialSpeed - Self.minRevertInitialSpeed)
        * clamp(revertCompleteness, 0, 1)
      let duration = distance <= 1e-8 ? 0 : Self.revertEaseOutInitialSlope * distance / speed
      let progress = clamp(driveElapsed / max(1e-8, duration), 0, 1)
      let eased = 1 - pow(1 - progress, 3)
      rebuildPressed(
        revertStartX + (1 - revertStartX) * eased, revertStartRotation * (1 - eased), dt)
      if driveElapsed >= duration {
        reset()
        phase = .completed
      }
    default:
      break
    }
  }

  private func beginRevert(_ edgeX: Double, _ rotation: Double) {
    let edge = clamp(edgeX, Self.minPressedEdgeX, 1)
    phase = .revert
    revertStartX = edge
    revertCompleteness = pressedRollCompleteness(edge)
    revertStartRotation = rotation
  }

  private func throwVelocity() -> Double {
    hypot(max(0, -velocityX), max(0, -velocityY) * 0.75)
  }

  private func pressedRollCompleteness(_ edgeX: Double) -> Double {
    let safe = clamp(edgeX, Self.minPressedEdgeX, 1)
    if safe >= 0.999999 { return 0 }
    return clamp(
      Self.bendAmplitudeForChord(safe) / Self.bendAmplitudeForChord(Self.minPressedEdgeX), 0, 1)
  }

  private func applyDraggedProfile(_ bookX: Double, _ dt: Double) {
    if weakGrip {
      fingerX = 1
      pressedEdgeX =
        1
        - min(
          Self.weakGripMaxCompression,
          max(0, startBookX - bookX) * Self.weakGripCompressionPerPage)
      heldRollTilt = 0
      dragTurnProgress = 0
      rebuildPressed(pressedEdgeX, 0, dt)
      return
    }
    let edge = Self.minPressedEdgeX
    fingerX = clamp(1 + bookX - startBookX, -1, 1)
    heldRollTilt =
      fingerX <= edge
      ? Self.hingeRotation
      : Self.maxPressedRollTilt * Self.gestureRollTiltRate
        * clamp((Self.gestureLiftStartX - fingerX) / (Self.gestureLiftStartX - edge), 0, 1)
    pressedEdgeX =
      fingerX <= edge
      ? Self.hingeChordX
      : clamp(clamp(fingerX, edge, 1) / max(0.000001, cos(heldRollTilt)), edge, 1)
    dragTurnProgress = postHingeTurnProgress(fingerX)
    if dragTurnProgress > 0 {
      rebuildTurn(dragTurnProgress, Self.hingeChordX, Self.hingeRotation, dt)
    } else {
      rebuildPressed(pressedEdgeX, heldRollTilt, dt)
    }
  }

  /// Past the fold, the finger position maps onto the released turn's progress.
  private func postHingeTurnProgress(_ finger: Double) -> Double {
    let safeStart = clamp(startBookX, 0, 1)
    let linear = clamp(
      (Self.minPressedEdgeX - clamp(finger, -1, 1)) / (Self.minPressedEdgeX + safeStart), 0, 1)
    if linear <= 0 || linear >= 1 { return linear }
    let desired = Self.hingeRotation + (Double.pi - Self.hingeRotation) * linear
    let rootTangent = Self.hingeRotation + Self.gestureHingeBendAmplitude
    let swingAngle = max(0, Double.pi - rootTangent)
    let swing = swingAngle / Double.pi
    let landingStart = swing / (swing + 1)
    if desired <= Double.pi - Self.gestureHingeBendAmplitude && swingAngle > 1e-9 {
      return landingStart * ((desired - Self.hingeRotation) / swingAngle)
    }
    let retention = clamp((Double.pi - desired) / Self.gestureHingeBendAmplitude, 0, 1)
    let landed = 1 - pow(retention, 1 / (1 + relaxation / 14))
    return landingStart + landed * (1 - landingStart)
  }

  private func rebuildPressed(_ edgeX: Double, _ rotation: Double, _ dt: Double) {
    rebuild(
      clamp(rotation, 0, Self.maxPressedRollTilt),
      Self.bendAmplitudeForChord(clamp(edgeX, Self.minPressedEdgeX, 1)), 0, 0, dt)
  }

  /// Swing about the spine until the sheet leaves along the landing page, then lay paper down.
  private func rebuildTurn(
    _ progress: Double, _ startX: Double, _ startRotation: Double, _ dt: Double
  ) {
    let p = clamp(progress, 0, 1)
    let startAmplitude = Self.bendAmplitudeForChord(clamp(startX, Self.minPressedEdgeX, 1))
    let rootTangent = startRotation + startAmplitude
    let swing = clamp((Double.pi - rootTangent) / Double.pi, 0, 1)
    let landingStart = swing / (swing + 1)
    let landing = p > landingStart
    let landed = landing ? (p - landingStart) / (1 - landingStart) : 0
    let retention = pow(clamp(1 - landed, 0, 1), 1 + relaxation / 14)
    let amplitude = startAmplitude * retention
    let swung =
      landingStart > 0
      ? startRotation + (Double.pi - rootTangent) * (p / landingStart) : Double.pi - amplitude
    rebuild(
      landing ? Double.pi - amplitude : swung, amplitude, 1 - retention * retention * retention,
      landed, dt)
  }

  private func tangent(
    _ material: Double, _ rotation: Double, _ amplitude: Double, _ uniformity: Double,
    _ landed: Double
  ) -> Double {
    let airborne = 1 - landed
    if landed > 0 && (material <= landed || airborne <= 1e-9) { return Double.pi }
    let curl = landed > 0 ? (material - landed) / airborne : material
    let pinned = cos(Double.pi * curl)
    return rotation + amplitude * (pinned + uniformity * (1 - 2 * curl - pinned))
  }

  private func rebuild(
    _ rotation: Double, _ bendAmplitude: Double, _ uniformity: Double, _ landedLength: Double,
    _ dt: Double
  ) {
    let segments = Self.segments
    let previousCurvature = curvature
    for i in 0..<Self.points {
      previousX[i] = profile[i * 4]
      previousZ[i] = profile[i * 4 + 1]
    }
    let amplitude = clamp(bendAmplitude, 0, Self.maxProfileBendAmplitude)
    let u = clamp(uniformity, 0, 1)
    let landed = clamp(landedLength, 0, 1)
    let weight = 0.5 / Double(segments)
    var x = 0.0
    var z = 0.0
    var lift = 0.0
    profile[0] = 0
    profile[1] = 0
    // Two-point Gauss-Legendre quadrature of the tangent along each segment.
    for segment in 0..<segments {
      let a = tangent(Self.quadrature[segment * 2], rotation, amplitude, u, landed)
      let b = tangent(Self.quadrature[segment * 2 + 1], rotation, amplitude, u, landed)
      x += (cos(a) + cos(b)) * weight
      z += (sin(a) + sin(b)) * weight
      let o = (segment + 1) * 4
      profile[o] = abs(x) < 1e-10 ? 0 : Float(x)
      profile[o + 1] = abs(z) < 1e-10 ? 0 : Float(z)
      lift = max(lift, z)
    }
    var speedSum = 0.0
    for i in 0..<Self.points {
      let before = max(0, i - 1) * 4
      let after = min(Self.points - 1, i + 1) * 4
      let tx = profile[after] - profile[before]
      let tz = profile[after + 1] - profile[before + 1]
      let length = max(1e-7, hypot(tx, tz))
      profile[i * 4 + 2] = -tz / length
      profile[i * 4 + 3] = tx / length
      if dt > 0 {
        speedSum +=
          Double(hypot(profile[i * 4] - previousX[i], profile[i * 4 + 1] - previousZ[i])) / dt
      }
    }
    maxLift = lift
    meanSpeed = dt > 0 ? speedSum / Double(Self.points) : 0
    edgeVelocityX = dt > 0 ? Double(profile[segments * 4] - previousX[segments]) / dt : 0
    curvature = abs(bendAmplitude)
    flatteningRate = dt > 0 ? max(0, (previousCurvature - curvature) / dt) : 0
  }

  /// Project the profile onto the screen page (spine at x = 0): projected x
  /// and depth per point, up to four screen-monotonic runs, and the cast
  /// shadow (roll x, width, strength). A `backward` turn mirrors the sheet
  /// about the spine, so it arrives over the page instead of leaving it.
  /// Returns whether any of the sheet or its shadow lies on the page.
  @discardableResult
  func frame(_ out: inout [Float], _ backward: Bool) -> Bool {
    let segments = Self.segments
    let camera = 0.5
    let side: Float = backward ? -1 : 1
    var maxX = -Double.infinity
    for i in 0..<Self.points {
      let depth = Double(profile[i * 4 + 1])
      let scale = min(
        Self.maxPerspectiveScale,
        Self.cameraDistance / max(0.001, Self.cameraDistance - max(0, depth)))
      let projected = camera + (Double(side * profile[i * 4]) - camera) * scale
      out[i * 4] = Float(projected)
      out[i * 4 + 1] = profile[i * 4 + 1]
      out[i * 4 + 2] = side * profile[i * 4 + 2]
      out[i * 4 + 3] = profile[i * 4 + 3]
      maxX = max(maxX, projected)
    }
    let runs = Self.points * 4
    for i in 0..<Self.runs * 4 { out[runs + i] = 0 }
    var count = 0
    var start = 0
    var direction = 0
    for segment in 0..<segments {
      let delta = out[(segment + 1) * 4] - out[segment * 4]
      if abs(delta) < 0.000001 { continue }
      let d = delta > 0 ? 1 : -1
      if direction == 0 {
        direction = d
        continue
      }
      if d != direction && count < Self.runs - 1 {
        let o = runs + count * 4
        out[o] = Float(start)
        out[o + 1] = Float(segment)
        out[o + 2] = Float(direction)
        out[o + 3] = 1
        count += 1
        start = segment
        direction = d
      }
    }
    let o = runs + count * 4
    out[o] = Float(start)
    out[o + 1] = Float(segments)
    out[o + 2] = Float(direction == 0 ? 1 : direction)
    out[o + 3] = 1

    let shadow = runs + Self.runs * 4
    let curl = clamp(curvature / Self.maxProfileBendAmplitude, 0, 1)
    let flattening = 1 - exp(-max(0, flatteningRate) / 8)
    let outwardPush = 1 - exp(-max(0, edgeVelocityX) / 1.8)
    let leftwardSpeed = max(0, -edgeVelocityX)
    // The shadow fades while the free edge is off the page.
    let edge = Double(side * profile[segments * 4])
    let reach = clamp((edge + 0.035) / 0.135, 0, 1)
    let presence = reach * reach * (3 - 2 * reach)
    let compression = curl * flattening * (0.62 + outwardPush * 0.38)
    let strength =
      phase == .completed
      ? 0
      : clamp(
        (0.018 + maxLift * 0.28 + meanSpeed * 0.011 + compression * 0.12) * presence
          / (1 + leftwardSpeed * 0.14), 0, Self.maxShadowStrength)
    out[shadow] = Float(maxX)
    out[shadow + 1] = Float(
      clamp(
        Self.minShadowWidth + maxLift * 0.12 + curl * 0.035 + compression * 0.045,
        Self.minShadowWidth, Self.maxShadowWidth))
    out[shadow + 2] = strength < 0.0005 ? 0 : Float(strength)
    out[shadow + 3] = 0
    return maxX > 0 || out[shadow + 2] > 0
  }
}
