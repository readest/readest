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

export const captureEvent = (_event: string, _properties?: Record<string, unknown>) => {};

export const optInTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'false');
  setTelemetryDecision('opt-in');
};
export const optOutTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'true');
  setTelemetryDecision('opt-out');
};
