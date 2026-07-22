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
 * `syncProgress`, `syncNotes`, `lastSyncedAt` — was earned by prior use
 * and MUST be preserved across a disconnect/reconnect cycle.
 *
 * Spreading `previous` first lets the form fields shadow the captured
 * credentials while every bookkeeping field rides through untouched.
 *
 * Deliberately does NOT touch `enabled`: activation belongs to
 * `withCloudProviderEnabled`, which the connect flow applies on top. If the
 * builder pre-set `enabled`, activation would never see the
 * disabled -> enabled transition and its side effects (the syncBooks
 * auto-flip, the providerSelectedAt stamp) would silently skip the most
 * common path.
 *
 * Pulled out as a pure helper specifically to unit-test the "reconnect
 * preserves prior state" invariant: the inline version in WebDAVForm
 * regressed in PR #4204 by replacing the whole webdav block, which
 * silently rotated the deviceId.
 */
export const buildWebDAVConnectSettings = (
  previous: Partial<WebDAVSettings> | undefined,
  form: WebDAVConnectFormValues,
): WebDAVSettings => {
  return {
    ...(previous ?? {}),
    serverUrl: form.serverUrl.trim(),
    username: form.username,
    password: form.password,
    rootPath: form.rootPath,
  } as WebDAVSettings;
};
