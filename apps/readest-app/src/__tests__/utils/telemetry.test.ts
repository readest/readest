import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('posthog-js', () => ({
  default: {
    __loaded: true,
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  },
}));

import posthog from 'posthog-js';
import {
  applyPostHogConsent,
  getTelemetryDecision,
  hasOptedOutTelemetry,
  optInTelemetry,
  optOutTelemetry,
  reconcileTelemetryConsent,
  rollIntoTelemetryPromptBucket,
  setTelemetryDecision,
  TELEMETRY_DECISION_KEY,
  TELEMETRY_OPT_OUT_KEY,
  TELEMETRY_PROMPT_BUCKET_RATE,
} from '@/utils/telemetry';

describe('telemetry decision storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('returns null when no decision is stored', () => {
    expect(getTelemetryDecision()).toBeNull();
  });

  it('round-trips the three valid decisions', () => {
    setTelemetryDecision('opt-in');
    expect(getTelemetryDecision()).toBe('opt-in');
    setTelemetryDecision('opt-out');
    expect(getTelemetryDecision()).toBe('opt-out');
    setTelemetryDecision('pending');
    expect(getTelemetryDecision()).toBe('pending');
  });

  it('ignores garbage values written directly to the key', () => {
    localStorage.setItem(TELEMETRY_DECISION_KEY, 'something-else');
    expect(getTelemetryDecision()).toBeNull();
  });
});

describe('optInTelemetry / optOutTelemetry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('opt-in records opt-in decision, clears opt-out flag, and calls posthog', () => {
    optInTelemetry();
    expect(localStorage.getItem(TELEMETRY_OPT_OUT_KEY)).toBe('false');
    expect(getTelemetryDecision()).toBe('opt-in');
    expect(hasOptedOutTelemetry()).toBe(false);
    expect(posthog.opt_in_capturing).toHaveBeenCalledOnce();
  });

  it('opt-out records opt-out decision, sets opt-out flag, and calls posthog', () => {
    optOutTelemetry();
    expect(localStorage.getItem(TELEMETRY_OPT_OUT_KEY)).toBe('true');
    expect(getTelemetryDecision()).toBe('opt-out');
    expect(hasOptedOutTelemetry()).toBe(true);
    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
  });
});

describe('rollIntoTelemetryPromptBucket', () => {
  it('is true when the rng falls under the bucket rate', () => {
    expect(rollIntoTelemetryPromptBucket(() => 0)).toBe(true);
    expect(rollIntoTelemetryPromptBucket(() => TELEMETRY_PROMPT_BUCKET_RATE - 1e-9)).toBe(true);
  });

  it('is false at or above the bucket rate', () => {
    expect(rollIntoTelemetryPromptBucket(() => TELEMETRY_PROMPT_BUCKET_RATE)).toBe(false);
    expect(rollIntoTelemetryPromptBucket(() => 0.99)).toBe(false);
  });

  it('places roughly 10% of uniform draws into the bucket', () => {
    const n = 10000;
    let inBucket = 0;
    for (let i = 0; i < n; i++) {
      if (rollIntoTelemetryPromptBucket(() => i / n)) inBucket++;
    }
    // Deterministic uniform sweep: floor(n * rate) = 1000.
    expect(inBucket).toBe(Math.floor(n * TELEMETRY_PROMPT_BUCKET_RATE));
  });
});

describe('reconcileTelemetryConsent', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('opts out when the saved settings have telemetry disabled', () => {
    optInTelemetry();
    vi.clearAllMocks();

    expect(reconcileTelemetryConsent(false)).toBe(false);

    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
    expect(hasOptedOutTelemetry()).toBe(true);
    expect(getTelemetryDecision()).toBe('opt-out');
  });

  it('keeps a recorded opt-out when the settings file says telemetry is on', () => {
    optOutTelemetry();
    vi.clearAllMocks();

    // Returns false so the boot code can turn the settings switch off too.
    expect(reconcileTelemetryConsent(true)).toBe(false);

    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
    expect(hasOptedOutTelemetry()).toBe(true);
    expect(getTelemetryDecision()).toBe('opt-out');
  });

  it('leaves the consent alone when it already matches the settings', () => {
    optOutTelemetry();
    vi.clearAllMocks();

    reconcileTelemetryConsent(false);

    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it('reports telemetry as enabled when the consent is opt-in', () => {
    optInTelemetry();

    expect(reconcileTelemetryConsent(true)).toBe(true);
  });
});

describe('applyPostHogConsent', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('restores an opt-in without sending an $opt_in event', () => {
    setTelemetryDecision('opt-in');

    applyPostHogConsent();

    expect(posthog.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  it('opts out for any other decision', () => {
    setTelemetryDecision('pending');

    applyPostHogConsent();

    expect(posthog.opt_out_capturing).toHaveBeenCalledOnce();
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
  });
});

describe('consent calls before PostHog starts', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    posthog.__loaded = false;
  });

  afterEach(() => {
    posthog.__loaded = true;
  });

  it('records the decision but leaves PostHog alone until init', () => {
    optOutTelemetry();
    optInTelemetry();

    expect(getTelemetryDecision()).toBe('opt-in');
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });
});
