import { WebDAVSettings } from '@/types/settings';

export interface WebDAVConnectFormValues {
  serverUrl: string;
  username: string;
  password: string;
  /** Already passed through `normalizeRootPath` by the caller. */
  rootPath: string;
}

/**
 * Build the updated `webdav` block for a successful Connect submit.
 *
 * The form's Connect handler only owns the four credential/path fields the
 * user just typed. Everything else — `deviceId`, `syncBooks`, `strategy`,
 * `syncProgress`, `syncNotes`, `lastSyncedAt`, `syncLog` — was earned by
 * prior use and MUST be preserved across a disconnect/reconnect cycle.
 *
 * Spreading `previous` first lets the form fields shadow the captured
 * credentials while every bookkeeping field rides through untouched. The
 * `enabled: true` flag is set last so a previously-disabled connection
 * comes back online without otherwise mutating user preferences.
 *
 * Pulled out as a pure helper specifically to unit-test the "reconnect
 * preserves prior state" invariant: the inline version in WebDAVForm
 * regressed in PR #4204 by replacing the whole webdav block, which
 * silently rotated the deviceId and dropped the diagnostic syncLog.
 */
export const buildWebDAVConnectSettings = (
  previous: Partial<WebDAVSettings> | undefined,
  form: WebDAVConnectFormValues,
): WebDAVSettings => {
  return {
    ...(previous ?? {}),
    enabled: true,
    serverUrl: form.serverUrl.trim(),
    username: form.username,
    password: form.password,
    rootPath: form.rootPath,
  } as WebDAVSettings;
};
