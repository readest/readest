import { getCloudflareContext } from '@opennextjs/cloudflare';

// Minimal local typing for the Analytics Engine binding (the project does not
// depend on @cloudflare/workers-types). Mirrors the pattern in
// `src/pages/api/deepl/translate.ts` for the KV binding.
interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    indexes?: string[];
    blobs?: (string | null)[];
    doubles?: number[];
  }): void;
}

interface CloudflareEnv {
  IAP_WEBHOOK_AE?: AnalyticsEngineDataset;
}

const TELEMETRY_TAG = 'iap-webhook';

export type IapWebhookOutcome = 'handled' | 'skipped' | 'rejected' | 'error';

export interface IapWebhookEvent {
  provider: 'apple' | 'google';
  outcome: IapWebhookOutcome;
  notificationType?: string | number;
  status?: string;
  reason?: string;
  durationMs: number;
}

export interface IapReconcileEvent {
  appleDrift: number;
  googleDrift: number;
  durationMs: number;
}

const getAnalyticsEngine = (): AnalyticsEngineDataset | undefined => {
  try {
    const env = getCloudflareContext().env as Partial<CloudflareEnv> | undefined;
    return env?.IAP_WEBHOOK_AE;
  } catch {
    // getCloudflareContext throws outside the Worker runtime (local dev / tests).
    return undefined;
  }
};

/**
 * Record the outcome of an App Store / Google Play webhook invocation.
 *
 * Emits two signals:
 *  - a structured log line, streamed in full by `wrangler tail` (stored Workers
 *    Logs are head-sampled, so they are unreliable for low-volume webhooks);
 *  - a Cloudflare Analytics Engine data point for 100% capture and dashboards,
 *    which no-ops when the binding is absent (local dev / preview).
 */
export function recordIapWebhook(event: IapWebhookEvent): void {
  console.log(JSON.stringify({ tag: TELEMETRY_TAG, kind: 'webhook', ...event }));

  getAnalyticsEngine()?.writeDataPoint({
    indexes: [event.provider],
    blobs: [
      'webhook',
      event.provider,
      event.outcome,
      String(event.notificationType ?? ''),
      event.status ?? '',
      event.reason ?? '',
    ],
    doubles: [event.durationMs],
  });
}

/** Record the result of a reconciliation sweep (drift = subscriptions still
 *  marked active in our DB whose store expiry has passed = a missed webhook). */
export function recordIapReconcile(event: IapReconcileEvent): void {
  console.log(JSON.stringify({ tag: TELEMETRY_TAG, kind: 'reconcile', ...event }));

  getAnalyticsEngine()?.writeDataPoint({
    indexes: ['reconcile'],
    blobs: ['reconcile', event.appleDrift + event.googleDrift > 0 ? 'drift' : 'ok'],
    doubles: [event.appleDrift, event.googleDrift, event.durationMs],
  });
}
