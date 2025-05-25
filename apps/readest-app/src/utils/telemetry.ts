import posthog from 'posthog-js';

export const TELEMETRY_OPT_OUT_KEY = 'readest-telemetry-opt-out';

export const hasOptedOutTelemetry = () => {
  return localStorage.getItem(TELEMETRY_OPT_OUT_KEY) === 'true';
};

export const captureEvent = (event: string, properties?: Record<string, unknown>) => {
  if (!hasOptedOutTelemetry()) {
    posthog.capture(event, properties);
  }
};

export const optInTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'false');
  posthog.opt_in_capturing();
};
export const optOutTelemetry = () => {
  localStorage.setItem(TELEMETRY_OPT_OUT_KEY, 'true');
  posthog.opt_out_capturing();
};
