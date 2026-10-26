/**
 * Exit codes from the readness-cli / agent-bridge spec.
 * 0 = ok true, 2 = ok false, 3 = transport, 4 = bad argv
 */
export const EXIT_OK = 0;
export const EXIT_APP_ERROR = 2;
export const EXIT_TRANSPORT = 3;
export const EXIT_USAGE = 4;

export type ClassifyResult =
  | { kind: "ok"; code: 0 }
  | { kind: "app-error"; code: 2 }
  | { kind: "unreadable"; code: 3 };

/**
 * `ok: true` → 0, `ok: false` → 2, missing/invalid `ok` → unreadable (3).
 */
export function classifyResponse(body: string | Buffer | Uint8Array): ClassifyResult {
  let value: unknown;
  try {
    const text =
      typeof body === "string"
        ? body
        : Buffer.isBuffer(body)
          ? body.toString("utf8")
          : Buffer.from(body).toString("utf8");
    value = JSON.parse(text);
  } catch {
    return { kind: "unreadable", code: EXIT_TRANSPORT };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "unreadable", code: EXIT_TRANSPORT };
  }

  const ok = (value as { ok?: unknown }).ok;
  if (ok === true) {
    return { kind: "ok", code: EXIT_OK };
  }
  if (ok === false) {
    return { kind: "app-error", code: EXIT_APP_ERROR };
  }
  return { kind: "unreadable", code: EXIT_TRANSPORT };
}
