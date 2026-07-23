export type TurnGestureDirection = -1 | 0 | 1;

export interface TurnGestureIntent {
  edgeDirection: TurnGestureDirection;
  earlyClaimBlocked: boolean;
  lastDeltaX: number;
  lastDeltaY: number;
  lastSampleTime: number;
  horizontalSign: TurnGestureDirection;
  horizontalStreak: number;
  verticalLocked: boolean;
}

export interface TurnGestureSample {
  deltaX: number;
  deltaY: number;
  deltaT: number;
}

export const NATIVE_CAPTURED_TURN_ATTRIBUTE = 'captured-turn-style';
export const NATIVE_PROGRAMMATIC_TURN_ATTRIBUTE = 'captured-turn-programmatic';
export const TURN_EDGE_ZONE_RATIO = 0.18;
export const TURN_FAST_CLAIM_DISTANCE_PX = 6;
export const TURN_FAST_CLAIM_MAX_SAMPLE_GAP_MS = 80;
export const TURN_RESERVED_INSET_FALLBACK_PX = 24;
export const TURN_VERTICAL_LOCK_DISTANCE_PX = 8;
export const TURN_DIRECTION_DOMINANCE = 1.5;

export const createTurnGestureIntent = (
  edgeDirection: TurnGestureDirection,
  earlyClaimBlocked: boolean,
  startTime: number,
): TurnGestureIntent => ({
  edgeDirection,
  earlyClaimBlocked,
  lastDeltaX: 0,
  lastDeltaY: 0,
  lastSampleTime: startTime,
  horizontalSign: 0,
  horizontalStreak: 0,
  verticalLocked: false,
});

/**
 * Advances the native captured-turn arena and returns true exactly once its
 * horizontal intent is strong enough to own the current touch sequence.
 */
export const shouldClaimTurnGesture = (
  intent: TurnGestureIntent,
  sample: TurnGestureSample,
  fallbackDistance: number,
) => {
  if (intent.verticalLocked) return false;

  const { deltaX, deltaY, deltaT } = sample;
  const stepX = deltaX - intent.lastDeltaX;
  const stepY = deltaY - intent.lastDeltaY;
  const sampleGap = deltaT - intent.lastSampleTime;
  intent.lastDeltaX = deltaX;
  intent.lastDeltaY = deltaY;
  intent.lastSampleTime = deltaT;

  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absY >= TURN_VERTICAL_LOCK_DISTANCE_PX && absY > absX) {
    intent.verticalLocked = true;
    intent.horizontalStreak = 0;
    intent.horizontalSign = 0;
    return false;
  }

  const stepSign = Math.sign(stepX) as TurnGestureDirection;
  const timelySample = sampleGap >= 0 && sampleGap <= TURN_FAST_CLAIM_MAX_SAMPLE_GAP_MS;
  const horizontalSample =
    Math.abs(stepX) >= 1 && Math.abs(stepX) > Math.abs(stepY) * TURN_DIRECTION_DOMINANCE;
  if (horizontalSample) {
    intent.horizontalStreak =
      timelySample && stepSign === intent.horizontalSign ? intent.horizontalStreak + 1 : 1;
    intent.horizontalSign = stepSign;
  } else {
    intent.horizontalStreak = 0;
    intent.horizontalSign = 0;
  }

  const edgeFastPath =
    !intent.earlyClaimBlocked &&
    intent.edgeDirection !== 0 &&
    Math.sign(deltaX) === intent.edgeDirection &&
    absX > absY * TURN_DIRECTION_DOMINANCE;
  const coherentFastPath =
    !intent.earlyClaimBlocked &&
    intent.edgeDirection === 0 &&
    absX >= TURN_FAST_CLAIM_DISTANCE_PX &&
    intent.horizontalStreak >= 2 &&
    absX > absY * TURN_DIRECTION_DOMINANCE;
  const requiredFallbackDistance = intent.earlyClaimBlocked
    ? TURN_RESERVED_INSET_FALLBACK_PX
    : fallbackDistance;
  const fallback = absX >= requiredFallbackDistance && absX > absY;
  return edgeFastPath || coherentFastPath || fallback;
};
