import type {
  ConnectionCheck,
  ConnectorId,
  FlowDirection,
  FlowEntryInput,
  FlowKind,
  FlowState,
} from './types';

// Per-device, like the sync position of each integration: localStorage is
// shared by every window, so a reader window's syncs reach an open Settings.
const STORAGE_KEY = 'readest-data-flow';
const MAX_ENTRIES = 300;
// Page turns push on a debounce, so a reading session would otherwise fill the
// history with one book.
const MERGE_WINDOW_MS = 10 * 60 * 1000;

const EMPTY_STATE: FlowState = { totals: {}, entries: [], checks: {} };

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; state: FlowState } | null = null;

const totalKey = (connector: ConnectorId, direction: FlowDirection, kind: FlowKind) =>
  `${connector}:${direction}:${kind}`;

/** The stored state. The same object until something changes, for useSyncExternalStore. */
export const readFlowState = (): FlowState => {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return snapshot?.state ?? EMPTY_STATE;
  }
  if (snapshot && snapshot.raw === raw) return snapshot.state;
  let state = EMPTY_STATE;
  try {
    if (raw) state = { ...EMPTY_STATE, ...JSON.parse(raw) };
  } catch {
    // Unreadable history is not worth failing a sync over; start again.
  }
  snapshot = { raw, state };
  return state;
};

const writeFlowState = (state: FlowState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save the data flow log', error);
  }
  listeners.forEach((listener) => listener());
};

/** Record one sync attempt. Safe to call from any sync path: it never throws. */
export const recordFlow = (input: FlowEntryInput) => {
  const state = readFlowState();
  const at = Date.now();
  const count = input.error ? 0 : (input.count ?? 1);

  const key = totalKey(input.connector, input.direction, input.kind);
  const total = state.totals[key] ?? { count: 0 };
  const totals = {
    ...state.totals,
    [key]: input.error
      ? { ...total, lastFailureAt: at, lastError: input.error }
      : { ...total, count: total.count + count, lastSuccessAt: at },
  };

  let entries = state.entries;
  if (input.error || count > 0) {
    const last = entries[0];
    const merges =
      !!last &&
      at - last.at < MERGE_WINDOW_MS &&
      last.connector === input.connector &&
      last.direction === input.direction &&
      last.kind === input.kind &&
      last.bookTitle === input.bookTitle &&
      last.error === input.error;
    entries = merges
      ? [{ ...last, count: last.count + count, at }, ...entries.slice(1)]
      : [{ ...input, count, at }, ...entries].slice(0, MAX_ENTRIES);
  }
  writeFlowState({ ...state, totals, entries });
};

export const recordConnectionCheck = (connector: ConnectorId, check: ConnectionCheck) => {
  const state = readFlowState();
  writeFlowState({
    ...state,
    checks: { ...state.checks, [connector]: { ...check, at: Date.now() } },
  });
};

/** One two-way exchange: what moved each way, then the failure if it stopped partway. */
export const recordExchange = (
  entry: Pick<FlowEntryInput, 'connector' | 'kind' | 'bookTitle'>,
  counts: { pushed: number; pulled: number },
  error?: string,
) => {
  recordFlow({ ...entry, direction: 'push', count: counts.pushed });
  recordFlow({ ...entry, direction: 'pull', count: counts.pulled });
  if (!error) return;
  recordFlow({ ...entry, direction: 'push', error });
  recordFlow({ ...entry, direction: 'pull', error });
};

/** Zero the counts and history. Connection checks describe now, not the past, so they stay. */
export const resetFlowLog = () => {
  writeFlowState({ ...EMPTY_STATE, checks: readFlowState().checks });
};

export const subscribeFlowState = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

const connectorTotals = (state: FlowState, connector: ConnectorId, direction?: FlowDirection) =>
  Object.entries(state.totals)
    .filter(([key]) => key.startsWith(`${connector}:${direction ?? ''}`))
    .map(([key, total]) => ({ direction: key.split(':')[1] as FlowDirection, total }));

export const getConnectorTotals = (state: FlowState, connector: ConnectorId) => {
  const totals = { pulled: 0, pushed: 0 };
  for (const { direction, total } of connectorTotals(state, connector)) {
    if (direction === 'pull') totals.pulled += total.count;
    else totals.pushed += total.count;
  }
  return totals;
};

/**
 * How syncing is going, separate from whether the server answers a check.
 * Failed while any kind's latest attempt failed: a pull that works on every
 * book open must not hide a push that never does.
 */
export const getConnectorSyncStatus = (
  state: FlowState,
  connector: ConnectorId,
  direction?: FlowDirection,
) => {
  let lastSuccessAt = 0;
  let lastFailureAt = 0;
  let error: string | undefined;
  for (const { total } of connectorTotals(state, connector, direction)) {
    const failureAt = total.lastFailureAt ?? 0;
    const successAt = total.lastSuccessAt ?? 0;
    lastSuccessAt = Math.max(lastSuccessAt, successAt);
    // >= because a library pass reports its counts and failures together.
    if (failureAt >= successAt && failureAt > lastFailureAt) {
      lastFailureAt = failureAt;
      error = total.lastError;
    }
  }
  if (lastFailureAt) return { status: 'failed' as const, at: lastFailureAt, error };
  return lastSuccessAt ? { status: 'ok' as const, at: lastSuccessAt } : { status: 'idle' as const };
};

/**
 * One answer for the diagram: a failed check or a failed sync both need
 * attention. Pass a direction to judge one side of a two-way integration.
 */
export const getConnectorHealth = (
  state: FlowState,
  connector: ConnectorId,
  direction?: FlowDirection,
) => {
  const check = state.checks[connector];
  const { status } = getConnectorSyncStatus(state, connector, direction);
  if (check?.ok === false || status === 'failed') return 'failed' as const;
  return check?.ok || status === 'ok' ? ('ok' as const) : ('unknown' as const);
};
