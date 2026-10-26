import { readFile } from "node:fs/promises";
import { bridgeFilePath } from "./bridgePath.js";

export type BridgeEndpoint = {
  port: number;
  secret: string;
};

export type TransportResult =
  | { ok: true; body: Buffer }
  | { ok: false };

/**
 * Read `port` and `secret` from agent-bridge.json.
 */
export async function readEndpoint(path: string): Promise<BridgeEndpoint> {
  const text = await readFile(path, "utf8");
  const value = JSON.parse(text) as { port?: unknown; secret?: unknown };
  const portNum =
    typeof value.port === "number"
      ? value.port
      : typeof value.port === "string"
        ? Number(value.port)
        : NaN;
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error("invalid port");
  }
  if (typeof value.secret !== "string" || value.secret.length === 0) {
    throw new Error("invalid secret");
  }
  return { port: portNum, secret: value.secret };
}

/**
 * POST JSON to the loopback agent bridge. Non-200 or network failure → fail.
 */
export async function httpPost(
  port: number,
  secret: string,
  body: Buffer | string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const payload = typeof body === "string" ? body : body.toString("utf8");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Connection: "close",
      },
      body: payload,
      signal: controller.signal,
    });
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the bridge file and POST. Returns fail for missing file / bad JSON /
 * connection refused / non-200 — never throws for those cases.
 */
export async function realTransport(
  body: Buffer | string,
  options?: {
    bridgePath?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<TransportResult> {
  try {
    const path = options?.bridgePath ?? bridgeFilePath();
    if (!path) {
      return { ok: false };
    }
    const { port, secret } = await readEndpoint(path);
    const responseBody = await httpPost(
      port,
      secret,
      body,
      options?.fetchImpl,
    );
    return { ok: true, body: responseBody };
  } catch {
    return { ok: false };
  }
}
