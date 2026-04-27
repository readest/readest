import type { AppService } from '@/types/system';
import { MAX_KNOWN_ENTRIES, OPDS_SUBSCRIPTIONS_DIR } from './types';
import type { OPDSSubscriptionState } from './types';

export function emptyState(catalogId: string): OPDSSubscriptionState {
  return {
    catalogId,
    lastCheckedAt: 0,
    knownEntryIds: [],
    failedEntries: [],
  };
}

export function pruneKnownEntryIds(ids: string[]): string[] {
  if (ids.length <= MAX_KNOWN_ENTRIES) return ids;
  return ids.slice(ids.length - MAX_KNOWN_ENTRIES);
}

function statePath(catalogId: string): string {
  return `${OPDS_SUBSCRIPTIONS_DIR}/${catalogId}.json`;
}

// Heal state files written by older versions that could append the same
// entryId to failedEntries multiple times during back-off retries. Keeps
// the entry with the highest attempts count (most recent attempt) so
// retry-eligibility is computed correctly.
function dedupeFailedEntries(entries: OPDSSubscriptionState['failedEntries']) {
  const byId = new Map<string, OPDSSubscriptionState['failedEntries'][number]>();
  for (const entry of entries) {
    const prev = byId.get(entry.entryId);
    if (!prev || entry.attempts > prev.attempts || entry.lastAttemptAt > prev.lastAttemptAt) {
      byId.set(entry.entryId, entry);
    }
  }
  return Array.from(byId.values());
}

export async function loadSubscriptionState(
  appService: AppService,
  catalogId: string,
): Promise<OPDSSubscriptionState> {
  const path = statePath(catalogId);
  try {
    const fileExists = await appService.exists(path, 'Data');
    if (!fileExists) return emptyState(catalogId);

    const content = await appService.readFile(path, 'Data', 'text');
    const parsed = JSON.parse(content as string) as OPDSSubscriptionState;
    return {
      ...parsed,
      failedEntries: dedupeFailedEntries(parsed.failedEntries ?? []),
    };
  } catch {
    console.error(`OPDS: failed to load subscription state for ${catalogId}, using empty state`);
    return emptyState(catalogId);
  }
}

export async function saveSubscriptionState(
  appService: AppService,
  state: OPDSSubscriptionState,
): Promise<void> {
  await appService.createDir(OPDS_SUBSCRIPTIONS_DIR, 'Data', true);
  const path = statePath(state.catalogId);
  const content = JSON.stringify(state, null, 2);
  await appService.writeFile(path, 'Data', content);
}

export async function deleteSubscriptionState(
  appService: AppService,
  catalogId: string,
): Promise<void> {
  try {
    await appService.deleteFile(statePath(catalogId), 'Data');
  } catch {
    // File may not exist — that's fine
  }
}
