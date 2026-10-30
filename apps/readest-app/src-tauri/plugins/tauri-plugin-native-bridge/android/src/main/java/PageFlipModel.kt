package com.readest.native_bridge

import kotlin.math.*

/*
 * Page Flip physics, adapted from page-turn-core (rolled-page-strip.ts,
 * page-turn-worklet.ts) of react-native-natural-page-turn:
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

/**
 * An inextensible paper sheet seen from the side, turning forward over a
 * spine at its left edge. The fold is vertical; the profile carries a pinned
 * elastica bow while held and relaxes toward a cylinder once released.
 *
 * Coordinates are in page widths: material 0 is the spine, 1 the free edge.
 * x runs right, z towards the viewer. A backward turn is the same motion
 * mirrored about the spine (see [frame]).
 */
internal class PageFlipModel {
    companion object {
        const val POINTS = 65
        private const val SEGMENTS = POINTS - 1
        const val RUNS = 4
        /** Floats [frame] writes: the profile, its runs, then the cast shadow. */
        const val FRAME_SIZE = POINTS * 4 + RUNS * 4 + 4
        const val MIN_PRESSED_EDGE_X = 0.14
        private const val PRESSED_SURFACE_CLEARANCE = 0.015
        private val INVERSE_BESSEL = doubleArrayOf(
            2.1667709839070377, -0.18629174453685354, 0.02265270180455248,
            -0.0037165828681793253, 0.0007038952663799921, -0.00014500246546194032,
            0.000031566578791633, -0.000007135535298704449, 0.0000016623788064225635,
            -0.0000003841457726910674, 0.00000009309814723863693)
        private const val INVERSE_BESSEL_MIN_CHORD = 0.035
        private const val MAX_PROFILE_BEND_AMPLITUDE = 2.147033481101353
        private const val GESTURE_LIFT_START_X = 0.36
        private const val GESTURE_ROLL_TILT_RATE = 0.4
        private const val GESTURE_HINGE_BEND_AMPLITUDE = 2.1266855842119465
        private const val FULL_GESTURE_START_MIN_X = 0.25
        private const val WEAK_GRIP_MAX_COMPRESSION = 0.04
        private const val WEAK_GRIP_COMPRESSION_PER_PAGE = 0.2
        private const val VELOCITY_TIME_CONSTANT = 0.045
        private const val MAX_TRACKED_VELOCITY = 6.0
        private const val MIN_REVERT_INITIAL_SPEED = 0.65
        private const val MAX_REVERT_INITIAL_SPEED = 6.3
        private const val REVERT_EASE_OUT_INITIAL_SLOPE = 3.0
        /** Seconds to unwind a whole released turn back to the fold. */
        private const val UNTURN_DURATION = 0.8
        private const val PRESS_DURATION = 0.12
        private const val PROPAGATION_SPEED_SCALE = 1.15
        // Drag tuning; a tap uses the automatic-turn tuning in play().
        private const val RELEASE_X = 0.72
        private const val LIFT_VELOCITY = 1.35
        private const val LIFT_TO_LEFT = 2.0
        private const val CURVATURE_RELAXATION = 7.0
        private const val MIN_SPEED_SCALE = 0.95
        private const val MAX_SPEED_SCALE = 2.0
        private const val VELOCITY_GAIN = 0.6
        private const val IDLE_DECAY_SECONDS = 0.09
        /** A tap plays the automatic turn this many times its natural pace. */
        private const val TAP_PLAYBACK = 1.6
        private const val CAMERA_DISTANCE = 4.0
        private const val MAX_PERSPECTIVE_SCALE = 1.34
        private const val MIN_SHADOW_WIDTH = 0.045
        private const val MAX_SHADOW_WIDTH = 0.28
        private const val MAX_SHADOW_STRENGTH = 0.34

        private val MAX_PRESSED_ROLL_TILT = max(0.0, PI - bendAmplitudeForChord(MIN_PRESSED_EDGE_X) - PRESSED_SURFACE_CLEARANCE)
        private val HINGE_ROTATION = MAX_PRESSED_ROLL_TILT * GESTURE_ROLL_TILT_RATE
        private val HINGE_CHORD_X = MIN_PRESSED_EDGE_X / cos(HINGE_ROTATION)
        private val QUADRATURE_OFFSET = 0.5 / sqrt(3.0)
        private val QUADRATURE = DoubleArray(SEGMENTS * 2) { i ->
            (i / 2 + 0.5 + (if (i % 2 == 0) -1 else 1) * QUADRATURE_OFFSET) / SEGMENTS
        }

        /** Inverse of the symmetric elastica chord (Chebyshev fit of inverse J0). */
        private fun bendAmplitudeForChord(chord: Double): Double {
            if (chord >= 0.999999) return 0.0
            val safe = chord.coerceIn(MIN_PRESSED_EDGE_X, 0.999999)
            val x = 2 * (safe - INVERSE_BESSEL_MIN_CHORD) / (1 - INVERSE_BESSEL_MIN_CHORD) - 1
            var beforePrevious = 0.0; var previous = 0.0
            for (i in INVERSE_BESSEL.size - 1 downTo 1) {
                val current = 2 * x * previous - beforePrevious + INVERSE_BESSEL[i]
                beforePrevious = previous; previous = current
            }
            return (x * previous - beforePrevious + INVERSE_BESSEL[0]) * sqrt(max(0.0, 1 - safe))
        }
    }

    private enum class Phase { IDLE, DRAG, PRESS, TURN, UNTURN, REVERT, COMPLETED }
    private var phase = Phase.IDLE
    private var releaseX = RELEASE_X; private var liftVelocity = LIFT_VELOCITY
    private var liftToLeft = LIFT_TO_LEFT; private var relaxation = CURVATURE_RELAXATION
    private var playback = 1.0

    /** Physical profile: x, z, normalX, normalZ per point. */
    private val profile = FloatArray(POINTS * 4)
    private val previousX = FloatArray(POINTS)
    private val previousZ = FloatArray(POINTS)

    private var startBookX = 1.0; private var lastBookX = 1.0; private var lastTime = 0.0
    private var velocityX = 0.0; private var velocityY = 0.0; private var lastBookY = 0.5
    private var fingerX = 1.0; private var pressedEdgeX = 1.0; private var heldRollTilt = 0.0
    private var weakGrip = false; private var dragTurnProgress = 0.0
    private var driveElapsed = 0.0; private var driveStartX = RELEASE_X; private var driveSpeedScale = 1.0
    private var driveStartProgress = 0.0; private var driveStartRotation = 0.0
    private var revertStartX = RELEASE_X; private var revertCompleteness = 0.0; private var revertStartRotation = 0.0
    private var maxLift = 0.0; private var meanSpeed = 0.0; private var edgeVelocityX = 0.0
    private var curvature = 0.0; private var flatteningRate = 0.0

    init { reset() }

    /** Lay the sheet flat and idle. */
    fun reset() {
        phase = Phase.IDLE; dragTurnProgress = 0.0; driveElapsed = 0.0
        for (i in 0 until POINTS) {
            val material = i.toFloat() / SEGMENTS
            profile[i * 4] = material; profile[i * 4 + 1] = 0f; profile[i * 4 + 2] = 0f; profile[i * 4 + 3] = 1f
            previousX[i] = material; previousZ[i] = 0f
        }
        maxLift = 0.0; meanSpeed = 0.0; edgeVelocityX = 0.0; curvature = 0.0; flatteningRate = 0.0
    }

    /** A finger takes the sheet at [x], [y] (page fractions from the spine); time in seconds. */
    fun beginDrag(x: Double, y: Double, time: Double) {
        reset()
        releaseX = RELEASE_X; liftVelocity = LIFT_VELOCITY; liftToLeft = LIFT_TO_LEFT
        relaxation = CURVATURE_RELAXATION; playback = 1.0
        phase = Phase.DRAG
        startBookX = x; lastBookX = x; lastBookY = y; lastTime = time
        velocityX = 0.0; velocityY = 0.0
        fingerX = 1.0; pressedEdgeX = 1.0; heldRollTilt = 0.0
        weakGrip = x < FULL_GESTURE_START_MIN_X
        applyDraggedProfile(x, 0.0)
    }

    /** The finger moves to [x], [y]. Past [MIN_PRESSED_EDGE_X] the sheet leaves its fold and turns. */
    fun moveDrag(x: Double, y: Double, time: Double) {
        if (phase != Phase.DRAG) return
        val dt = max(0.001, time - lastTime)
        val vx = ((x - lastBookX) / dt).coerceIn(-MAX_TRACKED_VELOCITY, MAX_TRACKED_VELOCITY)
        val vy = ((y - lastBookY) / dt).coerceIn(-MAX_TRACKED_VELOCITY, MAX_TRACKED_VELOCITY)
        val blend = 1 - exp(-dt / VELOCITY_TIME_CONSTANT)
        velocityX += (vx - velocityX) * blend
        velocityY += (vy - velocityY) * blend
        lastBookX = x; lastBookY = y; lastTime = time
        applyDraggedProfile(x, dt)
    }

    /** End a drag with the caller's outcome, carrying the held pose into the drive. A tap plays the whole turn. */
    fun release(commit: Boolean, time: Double) {
        if (phase != Phase.DRAG) { if (commit) play() else reset(); return }
        val decay = exp(-max(0.0, time - lastTime) / IDLE_DECAY_SECONDS)
        val throwSpeed = throwVelocity() * decay
        driveElapsed = 0.0
        if (commit) {
            phase = Phase.TURN
            driveStartX = pressedEdgeX; driveStartProgress = dragTurnProgress; driveStartRotation = heldRollTilt
            driveSpeedScale = (MIN_SPEED_SCALE + max(0.0, throwSpeed) * VELOCITY_GAIN).coerceIn(MIN_SPEED_SCALE, MAX_SPEED_SCALE)
        } else if (dragTurnProgress > 0) {
            // Past the fold, wind the turn back to it before relaxing.
            phase = Phase.UNTURN; driveStartProgress = dragTurnProgress
        } else beginRevert(pressedEdgeX, heldRollTilt)
    }

    private fun play() {
        reset()
        releaseX = 0.9; liftVelocity = 0.5; liftToLeft = 4.0; relaxation = 10.0
        playback = TAP_PLAYBACK
        phase = Phase.PRESS
    }

    /** Advance a driven phase; returns true while still moving. */
    fun advance(deltaTime: Double): Boolean {
        var remaining = (deltaTime * playback).coerceIn(0.0, 0.25)
        while (remaining > 0 && moving()) {
            val step = min(0.05, remaining)
            step(step); remaining -= step
        }
        return moving()
    }

    private fun moving() = phase == Phase.PRESS || phase == Phase.TURN || phase == Phase.UNTURN || phase == Phase.REVERT

    private fun step(dt: Double) {
        driveElapsed += dt
        when (phase) {
            Phase.PRESS -> {
                val progress = min(1.0, driveElapsed / PRESS_DURATION)
                rebuildPressed(1 + (releaseX - 1) * progress, 0.0, dt)
                if (progress >= 1) {
                    phase = Phase.TURN; driveElapsed = 0.0
                    driveStartX = releaseX; driveStartProgress = 0.0; driveStartRotation = 0.0; driveSpeedScale = 1.0
                }
            }
            Phase.TURN -> {
                val propagation = liftVelocity * liftToLeft * PROPAGATION_SPEED_SCALE * driveSpeedScale
                val fullDuration = (driveStartX + 1) * ((PI - driveStartRotation) / PI) / max(0.1, propagation)
                val duration = max(1e-6, (1 - driveStartProgress) * fullDuration)
                val progress = driveStartProgress + (1 - driveStartProgress) * min(1.0, driveElapsed / duration)
                rebuildTurn(progress, driveStartX, driveStartRotation, dt)
                if (progress >= 1) { phase = Phase.COMPLETED; meanSpeed = 0.0; edgeVelocityX = 0.0; flatteningRate = 0.0 }
            }
            Phase.UNTURN -> {
                val progress = (driveElapsed / max(1e-6, UNTURN_DURATION * driveStartProgress)).coerceIn(0.0, 1.0)
                rebuildTurn(driveStartProgress * (1 - progress).pow(3), HINGE_CHORD_X, HINGE_ROTATION, dt)
                if (progress >= 1) { driveElapsed = 0.0; beginRevert(HINGE_CHORD_X, HINGE_ROTATION) }
            }
            Phase.REVERT -> {
                val distance = max(0.0, 1 - revertStartX.coerceIn(0.0, 1.0))
                val speed = MIN_REVERT_INITIAL_SPEED + (MAX_REVERT_INITIAL_SPEED - MIN_REVERT_INITIAL_SPEED) * revertCompleteness.coerceIn(0.0, 1.0)
                val duration = if (distance <= 1e-8) 0.0 else REVERT_EASE_OUT_INITIAL_SLOPE * distance / speed
                val progress = (driveElapsed / max(1e-8, duration)).coerceIn(0.0, 1.0)
                val eased = 1 - (1 - progress).pow(3)
                rebuildPressed(revertStartX + (1 - revertStartX) * eased, revertStartRotation * (1 - eased), dt)
                if (driveElapsed >= duration) { reset(); phase = Phase.COMPLETED }
            }
            else -> {}
        }
    }

    private fun beginRevert(edgeX: Double, rotation: Double) {
        val edge = edgeX.coerceIn(MIN_PRESSED_EDGE_X, 1.0)
        phase = Phase.REVERT
        revertStartX = edge; revertCompleteness = pressedRollCompleteness(edge); revertStartRotation = rotation
    }

    private fun throwVelocity() = hypot(max(0.0, -velocityX), max(0.0, -velocityY) * 0.75)

    private fun pressedRollCompleteness(edgeX: Double): Double {
        val safe = edgeX.coerceIn(MIN_PRESSED_EDGE_X, 1.0)
        if (safe >= 0.999999) return 0.0
        return (bendAmplitudeForChord(safe) / bendAmplitudeForChord(MIN_PRESSED_EDGE_X)).coerceIn(0.0, 1.0)
    }

    private fun applyDraggedProfile(bookX: Double, dt: Double) {
        if (weakGrip) {
            fingerX = 1.0
            pressedEdgeX = 1 - min(WEAK_GRIP_MAX_COMPRESSION, max(0.0, startBookX - bookX) * WEAK_GRIP_COMPRESSION_PER_PAGE)
            heldRollTilt = 0.0; dragTurnProgress = 0.0
            rebuildPressed(pressedEdgeX, 0.0, dt)
            return
        }
        fingerX = (1 + bookX - startBookX).coerceIn(-1.0, 1.0)
        heldRollTilt = if (fingerX <= MIN_PRESSED_EDGE_X) HINGE_ROTATION
            else MAX_PRESSED_ROLL_TILT * GESTURE_ROLL_TILT_RATE *
                ((GESTURE_LIFT_START_X - fingerX) / (GESTURE_LIFT_START_X - MIN_PRESSED_EDGE_X)).coerceIn(0.0, 1.0)
        pressedEdgeX = if (fingerX <= MIN_PRESSED_EDGE_X) HINGE_CHORD_X
            else (fingerX.coerceIn(MIN_PRESSED_EDGE_X, 1.0) / max(0.000001, cos(heldRollTilt))).coerceIn(MIN_PRESSED_EDGE_X, 1.0)
        dragTurnProgress = postHingeTurnProgress(fingerX)
        if (dragTurnProgress > 0) rebuildTurn(dragTurnProgress, HINGE_CHORD_X, HINGE_ROTATION, dt)
        else rebuildPressed(pressedEdgeX, heldRollTilt, dt)
    }

    /** Past the fold, the finger position maps onto the released turn's progress. */
    private fun postHingeTurnProgress(finger: Double): Double {
        val safeStart = startBookX.coerceIn(0.0, 1.0)
        val linear = ((MIN_PRESSED_EDGE_X - finger.coerceIn(-1.0, 1.0)) / (MIN_PRESSED_EDGE_X + safeStart)).coerceIn(0.0, 1.0)
        if (linear <= 0 || linear >= 1) return linear
        val desired = HINGE_ROTATION + (PI - HINGE_ROTATION) * linear
        val rootTangent = HINGE_ROTATION + GESTURE_HINGE_BEND_AMPLITUDE
        val swingAngle = max(0.0, PI - rootTangent)
        val swing = swingAngle / PI
        val landingStart = swing / (swing + 1)
        if (desired <= PI - GESTURE_HINGE_BEND_AMPLITUDE && swingAngle > 1e-9)
            return landingStart * ((desired - HINGE_ROTATION) / swingAngle)
        val retention = ((PI - desired) / GESTURE_HINGE_BEND_AMPLITUDE).coerceIn(0.0, 1.0)
        val landed = 1 - retention.pow(1 / (1 + relaxation / 14))
        return landingStart + landed * (1 - landingStart)
    }

    private fun rebuildPressed(edgeX: Double, rotation: Double, dt: Double) =
        rebuild(rotation.coerceIn(0.0, MAX_PRESSED_ROLL_TILT), bendAmplitudeForChord(edgeX.coerceIn(MIN_PRESSED_EDGE_X, 1.0)), 0.0, 0.0, dt)

    /** Swing about the spine until the sheet leaves along the landing page, then lay paper down. */
    private fun rebuildTurn(progress: Double, startX: Double, startRotation: Double, dt: Double) {
        val p = progress.coerceIn(0.0, 1.0)
        val startAmplitude = bendAmplitudeForChord(startX.coerceIn(MIN_PRESSED_EDGE_X, 1.0))
        val rootTangent = startRotation + startAmplitude
        val swing = ((PI - rootTangent) / PI).coerceIn(0.0, 1.0)
        val landingStart = swing / (swing + 1)
        val landing = p > landingStart
        val landed = if (landing) (p - landingStart) / (1 - landingStart) else 0.0
        val retention = (1 - landed).coerceIn(0.0, 1.0).pow(1 + relaxation / 14)
        val amplitude = startAmplitude * retention
        val swung = if (landingStart > 0) startRotation + (PI - rootTangent) * (p / landingStart) else PI - amplitude
        rebuild(if (landing) PI - amplitude else swung, amplitude, 1 - retention * retention * retention, landed, dt)
    }

    private fun tangent(material: Double, rotation: Double, amplitude: Double, uniformity: Double, landed: Double): Double {
        val airborne = 1 - landed
        if (landed > 0 && (material <= landed || airborne <= 1e-9)) return PI
        val curl = if (landed > 0) (material - landed) / airborne else material
        val pinned = cos(PI * curl)
        return rotation + amplitude * (pinned + uniformity * (1 - 2 * curl - pinned))
    }

    private fun rebuild(rotation: Double, bendAmplitude: Double, uniformity: Double, landedLength: Double, dt: Double) {
        val previousCurvature = curvature
        for (i in 0 until POINTS) { previousX[i] = profile[i * 4]; previousZ[i] = profile[i * 4 + 1] }
        val amplitude = bendAmplitude.coerceIn(0.0, MAX_PROFILE_BEND_AMPLITUDE)
        val u = uniformity.coerceIn(0.0, 1.0); val landed = landedLength.coerceIn(0.0, 1.0)
        val weight = 0.5 / SEGMENTS
        var x = 0.0; var z = 0.0; var lift = 0.0
        profile[0] = 0f; profile[1] = 0f
        // Two-point Gauss-Legendre quadrature of the tangent along each segment.
        for (segment in 0 until SEGMENTS) {
            val a = tangent(QUADRATURE[segment * 2], rotation, amplitude, u, landed)
            val b = tangent(QUADRATURE[segment * 2 + 1], rotation, amplitude, u, landed)
            x += (cos(a) + cos(b)) * weight; z += (sin(a) + sin(b)) * weight
            val o = (segment + 1) * 4
            profile[o] = if (abs(x) < 1e-10) 0f else x.toFloat()
            profile[o + 1] = if (abs(z) < 1e-10) 0f else z.toFloat()
            lift = max(lift, z)
        }
        var speedSum = 0.0
        for (i in 0 until POINTS) {
            val before = max(0, i - 1) * 4; val after = min(POINTS - 1, i + 1) * 4
            val tx = profile[after] - profile[before]; val tz = profile[after + 1] - profile[before + 1]
            val length = max(1e-7f, hypot(tx, tz))
            profile[i * 4 + 2] = -tz / length; profile[i * 4 + 3] = tx / length
            if (dt > 0) speedSum += hypot(profile[i * 4] - previousX[i], profile[i * 4 + 1] - previousZ[i]) / dt
        }
        maxLift = lift
        meanSpeed = if (dt > 0) speedSum / POINTS else 0.0
        edgeVelocityX = if (dt > 0) (profile[SEGMENTS * 4] - previousX[SEGMENTS]) / dt else 0.0
        curvature = abs(bendAmplitude)
        flatteningRate = if (dt > 0) max(0.0, (previousCurvature - curvature) / dt) else 0.0
    }

    /**
     * Project the profile onto the screen page (spine at x = 0): projected x
     * and depth per point, up to four screen-monotonic runs, and the cast
     * shadow (roll x, width, strength). A [backward] turn mirrors the sheet
     * about the spine, so it arrives over the page instead of leaving it.
     * Returns whether any of the sheet or its shadow lies on the page.
     */
    fun frame(out: FloatArray, backward: Boolean): Boolean {
        val camera = 0.5
        val side = if (backward) -1f else 1f
        var maxX = Double.NEGATIVE_INFINITY
        for (i in 0 until POINTS) {
            val depth = profile[i * 4 + 1].toDouble()
            val scale = min(MAX_PERSPECTIVE_SCALE, CAMERA_DISTANCE / max(0.001, CAMERA_DISTANCE - max(0.0, depth)))
            val projected = camera + (side * profile[i * 4] - camera) * scale
            out[i * 4] = projected.toFloat(); out[i * 4 + 1] = profile[i * 4 + 1]
            out[i * 4 + 2] = side * profile[i * 4 + 2]; out[i * 4 + 3] = profile[i * 4 + 3]
            maxX = max(maxX, projected)
        }
        val runs = POINTS * 4
        for (i in 0 until RUNS * 4) out[runs + i] = 0f
        var count = 0; var start = 0; var direction = 0
        for (segment in 0 until SEGMENTS) {
            val delta = out[(segment + 1) * 4] - out[segment * 4]
            if (abs(delta) < 0.000001f) continue
            val d = if (delta > 0) 1 else -1
            if (direction == 0) { direction = d; continue }
            if (d != direction && count < RUNS - 1) {
                val o = runs + count * 4
                out[o] = start.toFloat(); out[o + 1] = segment.toFloat(); out[o + 2] = direction.toFloat(); out[o + 3] = 1f
                count++; start = segment; direction = d
            }
        }
        val o = runs + count * 4
        out[o] = start.toFloat(); out[o + 1] = SEGMENTS.toFloat(); out[o + 2] = (if (direction == 0) 1 else direction).toFloat(); out[o + 3] = 1f

        val shadow = runs + RUNS * 4
        val curl = (curvature / MAX_PROFILE_BEND_AMPLITUDE).coerceIn(0.0, 1.0)
        val flattening = 1 - exp(-max(0.0, flatteningRate) / 8)
        val outwardPush = 1 - exp(-max(0.0, edgeVelocityX) / 1.8)
        val leftwardSpeed = max(0.0, -edgeVelocityX)
        // The shadow fades while the free edge is off the page.
        val edge = side * profile[SEGMENTS * 4].toDouble()
        val presence = ((edge + 0.035) / 0.135).coerceIn(0.0, 1.0).let { it * it * (3 - 2 * it) }
        val compression = curl * flattening * (0.62 + outwardPush * 0.38)
        val strength = if (phase == Phase.COMPLETED) 0.0 else
            ((0.018 + maxLift * 0.28 + meanSpeed * 0.011 + compression * 0.12) * presence / (1 + leftwardSpeed * 0.14))
                .coerceIn(0.0, MAX_SHADOW_STRENGTH)
        out[shadow] = maxX.toFloat()
        out[shadow + 1] = (MIN_SHADOW_WIDTH + maxLift * 0.12 + curl * 0.035 + compression * 0.045)
            .coerceIn(MIN_SHADOW_WIDTH, MAX_SHADOW_WIDTH).toFloat()
        out[shadow + 2] = if (strength < 0.0005) 0f else strength.toFloat()
        out[shadow + 3] = 0f
        return maxX > 0 || out[shadow + 2] > 0f
    }
}
