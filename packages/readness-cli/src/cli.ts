#!/usr/bin/env node
/**
 * Console client for the running Readest desktop app (readness-cli).
 *
 * One command, one JSON request, one JSON document on stdout.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRequest } from "./request.js";
import { realTransport, type TransportResult } from "./transport.js";
import {
  EXIT_TRANSPORT,
  EXIT_USAGE,
  classifyResponse,
} from "./exit.js";

export type Outcome = {
  code: number;
  stdout: Buffer;
  stderr: string;
};

export type TransportFn = (body: Buffer) => Promise<TransportResult>;

/**
 * Parse argv, send one request, map the response to exit codes.
 * Injectable transport for unit tests (no live app).
 */
export async function execute(
  args: readonly string[],
  transport: TransportFn = defaultTransport,
): Promise<Outcome> {
  const built = buildRequest(args);
  if (!built.ok) {
    return {
      code: EXIT_USAGE,
      stdout: Buffer.alloc(0),
      stderr: `readness-cli: ${built.message}\n`,
    };
  }

  const body = Buffer.from(JSON.stringify(built.request), "utf8");
  const result = await transport(body);

  if (!result.ok) {
    return {
      code: EXIT_TRANSPORT,
      stdout: Buffer.alloc(0),
      stderr: "readness-cli: the app is not listening\n",
    };
  }

  const classified = classifyResponse(result.body);
  if (classified.kind === "unreadable") {
    return {
      code: EXIT_TRANSPORT,
      stdout: Buffer.alloc(0),
      stderr: "readness-cli: the app sent an unreadable response\n",
    };
  }

  const stdout = Buffer.concat([result.body, Buffer.from("\n")]);
  return {
    code: classified.code,
    stdout,
    stderr: "",
  };
}

async function defaultTransport(body: Buffer): Promise<TransportResult> {
  return realTransport(body);
}

async function main(): Promise<void> {
  // process.argv: [node, script, ...userArgs] — buildRequest skips argv[0]
  const outcome = await execute(process.argv.slice(1));
  if (outcome.stdout.length > 0) {
    process.stdout.write(outcome.stdout);
  }
  if (outcome.stderr.length > 0) {
    process.stderr.write(outcome.stderr);
  }
  process.exit(outcome.code);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err) => {
    process.stderr.write(
      `readness-cli: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(EXIT_TRANSPORT);
  });
}
