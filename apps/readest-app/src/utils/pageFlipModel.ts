/*
 * Page Flip physics, adapted from page-turn-core (rolled-page-strip.ts,
 * page-turn-worklet.ts) of react-native-natural-page-turn. The Android and
 * iOS native renderers carry the same model in PageFlipModel.kt/.swift.
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

export const FLIP_POINTS = 65;
const SEGMENTS = FLIP_POINTS - 1;
export const FLIP_RUNS = 4;
/** Floats `frame` writes: the profile, its runs, then the cast shadow. */
export const FLIP_FRAME_SIZE = FLIP_POINTS * 4 + FLIP_RUNS * 4 + 4;
export const FLIP_MIN_PRESSED_EDGE_X = 0.14;
const PRESSED_SURFACE_CLEARANCE = 0.015;
const INVERSE_BESSEL = [
  2.1667709839070377, -0.18629174453685354, 0.02265270180455248, -0.0037165828681793253,
  0.0007038952663799921, -0.00014500246546194032, 0.000031566578791633, -0.000007135535298704449,
  0.0000016623788064225635, -0.0000003841457726910674, 0.00000009309814723863693,
];
const INVERSE_BESSEL_MIN_CHORD = 0.035;
const MAX_PROFILE_BEND_AMPLITUDE = 2.147033481101353;
const GESTURE_LIFT_START_X = 0.36;
const GESTURE_ROLL_TILT_RATE = 0.4;
const GESTURE_HINGE_BEND_AMPLITUDE = 2.1266855842119465;
const FULL_GESTURE_START_MIN_X = 0.25;
const WEAK_GRIP_MAX_COMPRESSION = 0.04;
const WEAK_GRIP_COMPRESSION_PER_PAGE = 0.2;
const VELOCITY_TIME_CONSTANT = 0.045;
const MAX_TRACKED_VELOCITY = 6;
const MIN_REVERT_INITIAL_SPEED = 0.65;
const MAX_REVERT_INITIAL_SPEED = 6.3;
const REVERT_EASE_OUT_INITIAL_SLOPE = 3;
/** Seconds to unwind a whole released turn back to the fold. */
const UNTURN_DURATION = 0.8;
const PRESS_DURATION = 0.12;
const PROPAGATION_SPEED_SCALE = 1.15;
// Drag tuning; a tap uses the automatic-turn tuning in play().
const RELEASE_X = 0.72;
const LIFT_VELOCITY = 1.35;
const LIFT_TO_LEFT = 2;
const CURVATURE_RELAXATION = 7;
const MIN_SPEED_SCALE = 0.95;
const MAX_SPEED_SCALE = 2;
const VELOCITY_GAIN = 0.6;
const IDLE_DECAY_SECONDS = 0.09;
/** A tap plays the automatic turn this many times its natural pace. */
const TAP_PLAYBACK = 1.6;
const CAMERA_DISTANCE = 4;
const MAX_PERSPECTIVE_SCALE = 1.34;
const MIN_SHADOW_WIDTH = 0.045;
const MAX_SHADOW_WIDTH = 0.28;
const MAX_SHADOW_STRENGTH = 0.34;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Inverse of the symmetric elastica chord (Chebyshev fit of inverse J0). */
const bendAmplitudeForChord = (chord: number) => {
  if (chord >= 0.999999) return 0;
  const safe = clamp(chord, FLIP_MIN_PRESSED_EDGE_X, 0.999999);
  const x = (2 * (safe - INVERSE_BESSEL_MIN_CHORD)) / (1 - INVERSE_BESSEL_MIN_CHORD) - 1;
  let beforePrevious = 0;
  let previous = 0;
  for (let i = INVERSE_BESSEL.length - 1; i >= 1; i--) {
    const current = 2 * x * previous - beforePrevious + INVERSE_BESSEL[i]!;
    beforePrevious = previous;
    previous = current;
  }
  return (x * previous - beforePrevious + INVERSE_BESSEL[0]!) * Math.sqrt(Math.max(0, 1 - safe));
};

const MAX_PRESSED_ROLL_TILT = Math.max(
  0,
  Math.PI - bendAmplitudeForChord(FLIP_MIN_PRESSED_EDGE_X) - PRESSED_SURFACE_CLEARANCE,
);
const HINGE_ROTATION = MAX_PRESSED_ROLL_TILT * GESTURE_ROLL_TILT_RATE;
const HINGE_CHORD_X = FLIP_MIN_PRESSED_EDGE_X / Math.cos(HINGE_ROTATION);
const QUADRATURE_OFFSET = 0.5 / Math.sqrt(3);
const QUADRATURE = Array.from(
  { length: SEGMENTS * 2 },
  (_, i) => (Math.floor(i / 2) + 0.5 + (i % 2 === 0 ? -1 : 1) * QUADRATURE_OFFSET) / SEGMENTS,
);

type Phase = 'idle' | 'drag' | 'press' | 'turn' | 'unturn' | 'revert' | 'completed';

/**
 * An inextensible paper sheet seen from the side, turning forward over a
 * spine at its left edge. The fold is vertical; the profile carries a pinned
 * elastica bow while held and relaxes toward a cylinder once released.
 *
 * Coordinates are in page widths: material 0 is the spine, 1 the free edge.
 * x runs right, z towards the viewer. A backward turn is the same motion
 * mirrored about the spine (see `frame`).
 */
export class PageFlipModel {
  private phase: Phase = 'idle';
  private releaseX = RELEASE_X;
  private liftVelocity = LIFT_VELOCITY;
  private liftToLeft = LIFT_TO_LEFT;
  private relaxation = CURVATURE_RELAXATION;
  private playback = 1;

  /** Physical profile: x, z, normalX, normalZ per point. */
  private profile = new Float32Array(FLIP_POINTS * 4);
  private previousX = new Float32Array(FLIP_POINTS);
  private previousZ = new Float32Array(FLIP_POINTS);

  private startBookX = 1;
  private lastBookX = 1;
  private lastTime = 0;
  private velocityX = 0;
  private velocityY = 0;
  private lastBookY = 0.5;
  private fingerX = 1;
  private pressedEdgeX = 1;
  private heldRollTilt = 0;
  private weakGrip = false;
  private dragTurnProgress = 0;
  private driveElapsed = 0;
  private driveStartX = RELEASE_X;
  private driveSpeedScale = 1;
  private driveStartProgress = 0;
  private driveStartRotation = 0;
  private revertStartX = RELEASE_X;
  private revertCompleteness = 0;
  private revertStartRotation = 0;
  private maxLift = 0;
  private meanSpeed = 0;
  private edgeVelocityX = 0;
  private curvature = 0;
  private flatteningRate = 0;

  constructor() {
    this.reset();
  }

  /** Lay the sheet flat and idle. */
  reset() {
    this.phase = 'idle';
    this.dragTurnProgress = 0;
    this.driveElapsed = 0;
    for (let i = 0; i < FLIP_POINTS; i++) {
      const material = i / SEGMENTS;
      this.profile.set([material, 0, 0, 1], i * 4);
      this.previousX[i] = material;
      this.previousZ[i] = 0;
    }
    this.maxLift = 0;
    this.meanSpeed = 0;
    this.edgeVelocityX = 0;
    this.curvature = 0;
    this.flatteningRate = 0;
  }

  /** A finger takes the sheet at `x`, `y` (page fractions from the spine); time in seconds. */
  beginDrag(x: number, y: number, time: number) {
    this.reset();
    this.releaseX = RELEASE_X;
    this.liftVelocity = LIFT_VELOCITY;
    this.liftToLeft = LIFT_TO_LEFT;
    this.relaxation = CURVATURE_RELAXATION;
    this.playback = 1;
    this.phase = 'drag';
    this.startBookX = x;
    this.lastBookX = x;
    this.lastBookY = y;
    this.lastTime = time;
    this.velocityX = 0;
    this.velocityY = 0;
    this.fingerX = 1;
    this.pressedEdgeX = 1;
    this.heldRollTilt = 0;
    this.weakGrip = x < FULL_GESTURE_START_MIN_X;
    this.applyDraggedProfile(x, 0);
  }

  /** The finger moves to `x`, `y`. Past the fold the sheet leaves it and turns. */
  moveDrag(x: number, y: number, time: number) {
    if (this.phase !== 'drag') return;
    const dt = Math.max(0.001, time - this.lastTime);
    const vx = clamp((x - this.lastBookX) / dt, -MAX_TRACKED_VELOCITY, MAX_TRACKED_VELOCITY);
    const vy = clamp((y - this.lastBookY) / dt, -MAX_TRACKED_VELOCITY, MAX_TRACKED_VELOCITY);
    const blend = 1 - Math.exp(-dt / VELOCITY_TIME_CONSTANT);
    this.velocityX += (vx - this.velocityX) * blend;
    this.velocityY += (vy - this.velocityY) * blend;
    this.lastBookX = x;
    this.lastBookY = y;
    this.lastTime = time;
    this.applyDraggedProfile(x, dt);
  }

  /** End a drag with the caller's outcome, carrying the held pose into the drive. A tap plays the whole turn. */
  release(commit: boolean, time: number) {
    if (this.phase !== 'drag') {
      if (commit) this.play();
      else this.reset();
      return;
    }
    const decay = Math.exp(-Math.max(0, time - this.lastTime) / IDLE_DECAY_SECONDS);
    const throwSpeed = this.throwVelocity() * decay;
    this.driveElapsed = 0;
    if (commit) {
      this.phase = 'turn';
      this.driveStartX = this.pressedEdgeX;
      this.driveStartProgress = this.dragTurnProgress;
      this.driveStartRotation = this.heldRollTilt;
      this.driveSpeedScale = clamp(
        MIN_SPEED_SCALE + Math.max(0, throwSpeed) * VELOCITY_GAIN,
        MIN_SPEED_SCALE,
        MAX_SPEED_SCALE,
      );
    } else if (this.dragTurnProgress > 0) {
      // Past the fold, wind the turn back to it before relaxing.
      this.phase = 'unturn';
      this.driveStartProgress = this.dragTurnProgress;
    } else this.beginRevert(this.pressedEdgeX, this.heldRollTilt);
  }

  private play() {
    this.reset();
    this.releaseX = 0.9;
    this.liftVelocity = 0.5;
    this.liftToLeft = 4;
    this.relaxation = 10;
    this.playback = TAP_PLAYBACK;
    this.phase = 'press';
  }

  /** Advance a driven phase by `deltaTime` seconds; returns true while still moving. */
  advance(deltaTime: number) {
    let remaining = clamp(deltaTime * this.playback, 0, 0.25);
    while (remaining > 0 && this.moving()) {
      const step = Math.min(0.05, remaining);
      this.step(step);
      remaining -= step;
    }
    return this.moving();
  }

  private moving() {
    return (
      this.phase === 'press' ||
      this.phase === 'turn' ||
      this.phase === 'unturn' ||
      this.phase === 'revert'
    );
  }

  private step(dt: number) {
    this.driveElapsed += dt;
    switch (this.phase) {
      case 'press': {
        const progress = Math.min(1, this.driveElapsed / PRESS_DURATION);
        this.rebuildPressed(1 + (this.releaseX - 1) * progress, 0, dt);
        if (progress >= 1) {
          this.phase = 'turn';
          this.driveElapsed = 0;
          this.driveStartX = this.releaseX;
          this.driveStartProgress = 0;
          this.driveStartRotation = 0;
          this.driveSpeedScale = 1;
        }
        break;
      }
      case 'turn': {
        const propagation =
          this.liftVelocity * this.liftToLeft * PROPAGATION_SPEED_SCALE * this.driveSpeedScale;
        const fullDuration =
          ((this.driveStartX + 1) * ((Math.PI - this.driveStartRotation) / Math.PI)) /
          Math.max(0.1, propagation);
        const duration = Math.max(1e-6, (1 - this.driveStartProgress) * fullDuration);
        const progress =
          this.driveStartProgress +
          (1 - this.driveStartProgress) * Math.min(1, this.driveElapsed / duration);
        this.rebuildTurn(progress, this.driveStartX, this.driveStartRotation, dt);
        if (progress >= 1) {
          this.phase = 'completed';
          this.meanSpeed = 0;
          this.edgeVelocityX = 0;
          this.flatteningRate = 0;
        }
        break;
      }
      case 'unturn': {
        const progress = clamp(
          this.driveElapsed / Math.max(1e-6, UNTURN_DURATION * this.driveStartProgress),
          0,
          1,
        );
        this.rebuildTurn(
          this.driveStartProgress * (1 - progress) ** 3,
          HINGE_CHORD_X,
          HINGE_ROTATION,
          dt,
        );
        if (progress >= 1) {
          this.driveElapsed = 0;
          this.beginRevert(HINGE_CHORD_X, HINGE_ROTATION);
        }
        break;
      }
      case 'revert': {
        const distance = Math.max(0, 1 - clamp(this.revertStartX, 0, 1));
        const speed =
          MIN_REVERT_INITIAL_SPEED +
          (MAX_REVERT_INITIAL_SPEED - MIN_REVERT_INITIAL_SPEED) *
            clamp(this.revertCompleteness, 0, 1);
        const duration = distance <= 1e-8 ? 0 : (REVERT_EASE_OUT_INITIAL_SLOPE * distance) / speed;
        const progress = clamp(this.driveElapsed / Math.max(1e-8, duration), 0, 1);
        const eased = 1 - (1 - progress) ** 3;
        this.rebuildPressed(
          this.revertStartX + (1 - this.revertStartX) * eased,
          this.revertStartRotation * (1 - eased),
          dt,
        );
        if (this.driveElapsed >= duration) {
          this.reset();
          this.phase = 'completed';
        }
        break;
      }
    }
  }

  private beginRevert(edgeX: number, rotation: number) {
    const edge = clamp(edgeX, FLIP_MIN_PRESSED_EDGE_X, 1);
    this.phase = 'revert';
    this.revertStartX = edge;
    this.revertCompleteness = this.pressedRollCompleteness(edge);
    this.revertStartRotation = rotation;
  }

  private throwVelocity() {
    return Math.hypot(Math.max(0, -this.velocityX), Math.max(0, -this.velocityY) * 0.75);
  }

  private pressedRollCompleteness(edgeX: number) {
    const safe = clamp(edgeX, FLIP_MIN_PRESSED_EDGE_X, 1);
    if (safe >= 0.999999) return 0;
    return clamp(
      bendAmplitudeForChord(safe) / bendAmplitudeForChord(FLIP_MIN_PRESSED_EDGE_X),
      0,
      1,
    );
  }

  private applyDraggedProfile(bookX: number, dt: number) {
    if (this.weakGrip) {
      this.fingerX = 1;
      this.pressedEdgeX =
        1 -
        Math.min(
          WEAK_GRIP_MAX_COMPRESSION,
          Math.max(0, this.startBookX - bookX) * WEAK_GRIP_COMPRESSION_PER_PAGE,
        );
      this.heldRollTilt = 0;
      this.dragTurnProgress = 0;
      this.rebuildPressed(this.pressedEdgeX, 0, dt);
      return;
    }
    this.fingerX = clamp(1 + bookX - this.startBookX, -1, 1);
    this.heldRollTilt =
      this.fingerX <= FLIP_MIN_PRESSED_EDGE_X
        ? HINGE_ROTATION
        : MAX_PRESSED_ROLL_TILT *
          GESTURE_ROLL_TILT_RATE *
          clamp(
            (GESTURE_LIFT_START_X - this.fingerX) /
              (GESTURE_LIFT_START_X - FLIP_MIN_PRESSED_EDGE_X),
            0,
            1,
          );
    this.pressedEdgeX =
      this.fingerX <= FLIP_MIN_PRESSED_EDGE_X
        ? HINGE_CHORD_X
        : clamp(
            clamp(this.fingerX, FLIP_MIN_PRESSED_EDGE_X, 1) /
              Math.max(0.000001, Math.cos(this.heldRollTilt)),
            FLIP_MIN_PRESSED_EDGE_X,
            1,
          );
    this.dragTurnProgress = this.postHingeTurnProgress(this.fingerX);
    if (this.dragTurnProgress > 0)
      this.rebuildTurn(this.dragTurnProgress, HINGE_CHORD_X, HINGE_ROTATION, dt);
    else this.rebuildPressed(this.pressedEdgeX, this.heldRollTilt, dt);
  }

  /** Past the fold, the finger position maps onto the released turn's progress. */
  private postHingeTurnProgress(finger: number) {
    const safeStart = clamp(this.startBookX, 0, 1);
    const linear = clamp(
      (FLIP_MIN_PRESSED_EDGE_X - clamp(finger, -1, 1)) / (FLIP_MIN_PRESSED_EDGE_X + safeStart),
      0,
      1,
    );
    if (linear <= 0 || linear >= 1) return linear;
    const desired = HINGE_ROTATION + (Math.PI - HINGE_ROTATION) * linear;
    const rootTangent = HINGE_ROTATION + GESTURE_HINGE_BEND_AMPLITUDE;
    const swingAngle = Math.max(0, Math.PI - rootTangent);
    const swing = swingAngle / Math.PI;
    const landingStart = swing / (swing + 1);
    if (desired <= Math.PI - GESTURE_HINGE_BEND_AMPLITUDE && swingAngle > 1e-9)
      return landingStart * ((desired - HINGE_ROTATION) / swingAngle);
    const retention = clamp((Math.PI - desired) / GESTURE_HINGE_BEND_AMPLITUDE, 0, 1);
    const landed = 1 - retention ** (1 / (1 + this.relaxation / 14));
    return landingStart + landed * (1 - landingStart);
  }

  private rebuildPressed(edgeX: number, rotation: number, dt: number) {
    this.rebuild(
      clamp(rotation, 0, MAX_PRESSED_ROLL_TILT),
      bendAmplitudeForChord(clamp(edgeX, FLIP_MIN_PRESSED_EDGE_X, 1)),
      0,
      0,
      dt,
    );
  }

  /** Swing about the spine until the sheet leaves along the landing page, then lay paper down. */
  private rebuildTurn(progress: number, startX: number, startRotation: number, dt: number) {
    const p = clamp(progress, 0, 1);
    const startAmplitude = bendAmplitudeForChord(clamp(startX, FLIP_MIN_PRESSED_EDGE_X, 1));
    const rootTangent = startRotation + startAmplitude;
    const swing = clamp((Math.PI - rootTangent) / Math.PI, 0, 1);
    const landingStart = swing / (swing + 1);
    const landing = p > landingStart;
    const landed = landing ? (p - landingStart) / (1 - landingStart) : 0;
    const retention = clamp(1 - landed, 0, 1) ** (1 + this.relaxation / 14);
    const amplitude = startAmplitude * retention;
    const swung =
      landingStart > 0
        ? startRotation + (Math.PI - rootTangent) * (p / landingStart)
        : Math.PI - amplitude;
    this.rebuild(
      landing ? Math.PI - amplitude : swung,
      amplitude,
      1 - retention * retention * retention,
      landed,
      dt,
    );
  }

  private tangent(
    material: number,
    rotation: number,
    amplitude: number,
    uniformity: number,
    landed: number,
  ) {
    const airborne = 1 - landed;
    if (landed > 0 && (material <= landed || airborne <= 1e-9)) return Math.PI;
    const curl = landed > 0 ? (material - landed) / airborne : material;
    const pinned = Math.cos(Math.PI * curl);
    return rotation + amplitude * (pinned + uniformity * (1 - 2 * curl - pinned));
  }

  private rebuild(
    rotation: number,
    bendAmplitude: number,
    uniformity: number,
    landedLength: number,
    dt: number,
  ) {
    const profile = this.profile;
    const previousCurvature = this.curvature;
    for (let i = 0; i < FLIP_POINTS; i++) {
      this.previousX[i] = profile[i * 4]!;
      this.previousZ[i] = profile[i * 4 + 1]!;
    }
    const amplitude = clamp(bendAmplitude, 0, MAX_PROFILE_BEND_AMPLITUDE);
    const u = clamp(uniformity, 0, 1);
    const landed = clamp(landedLength, 0, 1);
    const weight = 0.5 / SEGMENTS;
    let x = 0;
    let z = 0;
    let lift = 0;
    profile[0] = 0;
    profile[1] = 0;
    // Two-point Gauss-Legendre quadrature of the tangent along each segment.
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const a = this.tangent(QUADRATURE[segment * 2]!, rotation, amplitude, u, landed);
      const b = this.tangent(QUADRATURE[segment * 2 + 1]!, rotation, amplitude, u, landed);
      x += (Math.cos(a) + Math.cos(b)) * weight;
      z += (Math.sin(a) + Math.sin(b)) * weight;
      const o = (segment + 1) * 4;
      profile[o] = Math.abs(x) < 1e-10 ? 0 : x;
      profile[o + 1] = Math.abs(z) < 1e-10 ? 0 : z;
      lift = Math.max(lift, z);
    }
    let speedSum = 0;
    for (let i = 0; i < FLIP_POINTS; i++) {
      const before = Math.max(0, i - 1) * 4;
      const after = Math.min(FLIP_POINTS - 1, i + 1) * 4;
      const tx = profile[after]! - profile[before]!;
      const tz = profile[after + 1]! - profile[before + 1]!;
      const length = Math.max(1e-7, Math.hypot(tx, tz));
      profile[i * 4 + 2] = -tz / length;
      profile[i * 4 + 3] = tx / length;
      if (dt > 0)
        speedSum +=
          Math.hypot(
            profile[i * 4]! - this.previousX[i]!,
            profile[i * 4 + 1]! - this.previousZ[i]!,
          ) / dt;
    }
    this.maxLift = lift;
    this.meanSpeed = dt > 0 ? speedSum / FLIP_POINTS : 0;
    this.edgeVelocityX = dt > 0 ? (profile[SEGMENTS * 4]! - this.previousX[SEGMENTS]!) / dt : 0;
    this.curvature = Math.abs(bendAmplitude);
    this.flatteningRate = dt > 0 ? Math.max(0, (previousCurvature - this.curvature) / dt) : 0;
  }

  /**
   * Project the profile onto the screen page (spine at x = 0): projected x
   * and depth per point, up to four screen-monotonic runs, and the cast
   * shadow (roll x, width, strength). A `backward` turn mirrors the sheet
   * about the spine, so it arrives over the page instead of leaving it.
   * Returns whether any of the sheet or its shadow lies on the page.
   */
  frame(out: Float32Array, backward: boolean) {
    const profile = this.profile;
    const camera = 0.5;
    const side = backward ? -1 : 1;
    let maxX = -Infinity;
    for (let i = 0; i < FLIP_POINTS; i++) {
      const depth = profile[i * 4 + 1]!;
      const scale = Math.min(
        MAX_PERSPECTIVE_SCALE,
        CAMERA_DISTANCE / Math.max(0.001, CAMERA_DISTANCE - Math.max(0, depth)),
      );
      const projected = camera + (side * profile[i * 4]! - camera) * scale;
      out[i * 4] = projected;
      out[i * 4 + 1] = depth;
      out[i * 4 + 2] = side * profile[i * 4 + 2]!;
      out[i * 4 + 3] = profile[i * 4 + 3]!;
      maxX = Math.max(maxX, projected);
    }
    const runs = FLIP_POINTS * 4;
    out.fill(0, runs, runs + FLIP_RUNS * 4);
    let count = 0;
    let start = 0;
    let direction = 0;
    for (let segment = 0; segment < SEGMENTS; segment++) {
      const delta = out[(segment + 1) * 4]! - out[segment * 4]!;
      if (Math.abs(delta) < 0.000001) continue;
      const d = delta > 0 ? 1 : -1;
      if (direction === 0) {
        direction = d;
        continue;
      }
      if (d !== direction && count < FLIP_RUNS - 1) {
        out.set([start, segment, direction, 1], runs + count * 4);
        count++;
        start = segment;
        direction = d;
      }
    }
    out.set([start, SEGMENTS, direction === 0 ? 1 : direction, 1], runs + count * 4);

    const shadow = runs + FLIP_RUNS * 4;
    const curl = clamp(this.curvature / MAX_PROFILE_BEND_AMPLITUDE, 0, 1);
    const flattening = 1 - Math.exp(-Math.max(0, this.flatteningRate) / 8);
    const outwardPush = 1 - Math.exp(-Math.max(0, this.edgeVelocityX) / 1.8);
    const leftwardSpeed = Math.max(0, -this.edgeVelocityX);
    // The shadow fades while the free edge is off the page.
    const edge = side * profile[SEGMENTS * 4]!;
    const reach = clamp((edge + 0.035) / 0.135, 0, 1);
    const presence = reach * reach * (3 - 2 * reach);
    const compression = curl * flattening * (0.62 + outwardPush * 0.38);
    const strength =
      this.phase === 'completed'
        ? 0
        : clamp(
            ((0.018 + this.maxLift * 0.28 + this.meanSpeed * 0.011 + compression * 0.12) *
              presence) /
              (1 + leftwardSpeed * 0.14),
            0,
            MAX_SHADOW_STRENGTH,
          );
    out[shadow] = maxX;
    out[shadow + 1] = clamp(
      MIN_SHADOW_WIDTH + this.maxLift * 0.12 + curl * 0.035 + compression * 0.045,
      MIN_SHADOW_WIDTH,
      MAX_SHADOW_WIDTH,
    );
    out[shadow + 2] = strength < 0.0005 ? 0 : strength;
    out[shadow + 3] = 0;
    return maxX > 0 || out[shadow + 2]! > 0;
  }
}
