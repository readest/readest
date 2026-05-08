import { getAccessToken } from '@/utils/access';
import { getAPIBaseUrl } from '@/services/environment';
import { SyncError } from '@/libs/errors';
import type { Hlc, ReplicaRow } from '@/types/replica';
import type { SyncErrorCode } from '@/libs/errors';

const ENDPOINT = () => `${getAPIBaseUrl()}/sync/replicas`;
const KEYS_ENDPOINT = () => `${getAPIBaseUrl()}/sync/replica-keys`;

export interface ReplicaKeyRow {
  saltId: string;
  alg: string;
  salt: string;
  createdAt: string;
}

interface ErrorBody {
  error?: string;
  code?: SyncErrorCode;
  offendingIndex?: number;
}

const statusToDefaultCode = (status: number): SyncErrorCode => {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 402 || status === 507) return 'QUOTA_EXCEEDED';
  if (status === 409) return 'CLOCK_SKEW';
  if (status === 413) return 'VALIDATION';
  if (status === 422) return 'VALIDATION';
  if (status >= 500) return 'SERVER';
  return 'VALIDATION';
};

const parseErrorBody = async (response: Response): Promise<ErrorBody> => {
  try {
    return (await response.json()) as ErrorBody;
  } catch {
    return {};
  }
};

const requireToken = async (): Promise<string> => {
  const token = await getAccessToken();
  if (!token) throw new SyncError('AUTH', 'Not authenticated');
  return token;
};

export class ReplicaSyncClient {
  async push(rows: ReplicaRow[]): Promise<ReplicaRow[]> {
    if (rows.length === 0) return [];
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(ENDPOINT(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows }),
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during push', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(code, body.error ?? `Push failed with status ${response.status}`, {
        status: response.status,
      });
    }
    const data = (await response.json()) as { rows: ReplicaRow[] };
    return data.rows ?? [];
  }

  async pull(kind: string, since: Hlc | null): Promise<ReplicaRow[]> {
    const token = await requireToken();
    const params = new URLSearchParams({ kind });
    if (since) params.set('since', since);
    const url = `${ENDPOINT()}?${params.toString()}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during pull', { cause });
    }
    if (response.status === 404) return [];
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(code, body.error ?? `Pull failed with status ${response.status}`, {
        status: response.status,
      });
    }
    const data = (await response.json()) as { rows: ReplicaRow[] };
    return data.rows ?? [];
  }

  async listReplicaKeys(): Promise<ReplicaKeyRow[]> {
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(KEYS_ENDPOINT(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during replica-keys list', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(
        code,
        body.error ?? `replica-keys list failed with status ${response.status}`,
        { status: response.status },
      );
    }
    const data = (await response.json()) as { rows: ReplicaKeyRow[] };
    return data.rows ?? [];
  }

  async forgetReplicaKeys(): Promise<void> {
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(KEYS_ENDPOINT(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during replica-keys forget', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(
        code,
        body.error ?? `replica-keys forget failed with status ${response.status}`,
        { status: response.status },
      );
    }
  }

  async createReplicaKey(alg: string): Promise<ReplicaKeyRow> {
    const token = await requireToken();
    let response: Response;
    try {
      response = await fetch(KEYS_ENDPOINT(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ alg }),
      });
    } catch (cause) {
      throw new SyncError('SERVER', 'Network failure during replica-keys create', { cause });
    }
    if (!response.ok) {
      const body = await parseErrorBody(response);
      const code = body.code ?? statusToDefaultCode(response.status);
      throw new SyncError(
        code,
        body.error ?? `replica-keys create failed with status ${response.status}`,
        { status: response.status },
      );
    }
    const data = (await response.json()) as { row: ReplicaKeyRow };
    if (!data.row) {
      throw new SyncError('SERVER', 'replica-keys create returned no row');
    }
    return data.row;
  }
}

export const replicaSyncClient = new ReplicaSyncClient();
