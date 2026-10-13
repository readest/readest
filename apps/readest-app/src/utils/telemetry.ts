import posthog from 'posthog-js';

export const TELEMETRY_OPT_OUT_KEY = 'readest-telemetry-opt-out';
export const TELEMETRY_DECISION_KEY = 'readest-telemetry-decision';

export type TelemetryDecision = 'opt-in' | 'opt-out' | 'pending';

/** Fraction of new users shown the consent prompt; the rest are opted out silently. */
export const TELEMETRY_PROMPT_BUCKET_RATE = 0.1;

export const hasOptedOutTelemetry = () => {
  return localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === 'true';
};

export const getTelemetryDecision = (): TelemetryDecision | null => {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(TELEMETRY_DECISION_KEY);
  if (value === 'opt-in' || value === 'opt-out' || value === 'pending') return value;
  return null;
};

export const setTelemetryDecision = (decision: TelemetryDecision) => {
  localStorage.setItem(TELEMETRY_DECISION_KEY, decision);
};

/** Returns true with probability TELEMETRY_PROMPT_BUCKET_RATE. */
export const rollIntoTelemetryPromptBucket = (rng: () => number = Math.random) => {
  return rng() < TELEMETRY_PROMPT_BUCKET_RATE;
};

export const captureEvent = (event: string, properties?: Record<string, unknown>) => {
  if (!hasOptedOutTelemetry()) {
    posthog.capture(event, properties);
  }
};

// Boot records the decision before PostHog starts; `applyPostHogConsent`
// hands it to the SDK once init has set the project token. A consent call
// before init would be stored under a token-less key that nothing reads.
export const optInTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'false');
  setTelemetryDecision('opt-in');
  if (posthog.__loaded) posthog.opt_in_capturing();
};
export const optOutTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'true');
  setTelemetryDecision('opt-out');
  if (posthog.__loaded) posthog.opt_out_capturing();
};

/**
 * Apply the recorded decision to PostHog right after init. This runs on every
 * boot, so an opt-in is restored without the SDK's default `$opt_in` event.
 */
export const applyPostHogConsent = () => {
  if (getTelemetryDecision() === 'opt-in') {
    posthog.opt_in_capturing({ captureEventName: false });
  } else {
    posthog.opt_out_capturing();
  }
};

/**
 * Line PostHog's consent up with the saved setting. The switch can change
 * from the settings panel, the command palette, or another window, so this
 * runs on every boot. It enforces an opt-out only: a recorded opt-out stays
 * even when the settings file says enabled, because a failed or interrupted
 * settings save must not re-enable capture. Turning telemetry back on goes
 * through the explicit controls, which update both stores.
 *
 * Returns the effective setting, so the caller can switch a stale `true` in
 * the settings file off and the settings panel shows what is in effect.
 */
export const reconcileTelemetryConsent = (telemetryEnabled: boolean) => {
  if (!telemetryEnabled && !hasOptedOutTelemetry()) {
    optOutTelemetry();
  }
  return !hasOptedOutTelemetry();
};
