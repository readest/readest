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

export const optInTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'false');
  setTelemetryDecision('opt-in');
  posthog.opt_in_capturing();
};
export const optOutTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'true');
  setTelemetryDecision('opt-out');
  posthog.opt_out_capturing();
};

/**
 * Line PostHog's consent up with the saved setting. The switch can change
 * from the settings panel, the command palette, or another window, so this
 * runs on every boot and repairs any drift between the two stores.
 */
export const reconcileTelemetryConsent = (telemetryEnabled: boolean) => {
  const shouldOptOut = !telemetryEnabled;
  if (shouldOptOut !== hasOptedOutTelemetry()) {
    if (shouldOptOut) {
      optOutTelemetry();
    } else {
      optInTelemetry();
    }
  }
};
