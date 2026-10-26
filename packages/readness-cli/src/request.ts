/**
 * Build the agent-bridge JSON request from argv (port of Rust build_request).
 */

export type RequestResult =
  | { ok: true; request: Record<string, unknown> }
  | { ok: false; message: string };

const SEARCH_MODES = new Set([
  "contains",
  "whole-words",
  "regex",
  "nearby-words",
]);
const SEARCH_SCOPES = new Set(["book", "section"]);

/**
 * Absolute filesystem path. `file://` URLs and bare names are refused here so
 * they never reach the app. Accepts Unix `/…` and Windows `C:\…` / UNC so the
 * CLI works when an agent runs on either platform.
 */
export function absoluteBookPath(path: string): boolean {
  if (!path) {
    return false;
  }
  if (path.length >= 5 && path.slice(0, 5).toLowerCase() === "file:") {
    return false;
  }
  if (path.includes("://")) {
    return false;
  }
  if (path.startsWith("/")) {
    return true;
  }
  // Windows drive letter: C:\ or C:/
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return true;
  }
  // Windows UNC: \\server\share
  if (path.startsWith("\\\\")) {
    return true;
  }
  return false;
}

function parseCount(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    String(parsed) !== value.trim()
  ) {
    throw new Error(`--${flag} needs a positive number`);
  }
  return parsed;
}

function onePositional(command: string, positional: string[]): string {
  if (positional.length === 0) {
    throw new Error(`${command} requires a value`);
  }
  if (positional.length > 1) {
    throw new Error(`${command} takes one value`);
  }
  return positional[0]!;
}

/**
 * @param args Full process.argv (including node and script path), or a
 *   synthetic list whose first element is the program name.
 */
export function buildRequest(args: readonly string[]): RequestResult {
  try {
    return { ok: true, request: buildRequestOrThrow(args) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message };
  }
}

function buildRequestOrThrow(args: readonly string[]): Record<string, unknown> {
  const positional: string[] = [];
  let command: string | undefined;
  let book: string | undefined;
  let mode: string | undefined;
  let scope: string | undefined;
  let matchCase = false;
  let matchDiacritics = false;
  let nearbyWords: number | undefined;
  let limit: number | undefined;

  const rest = args.slice(1);
  let i = 0;

  while (i < rest.length) {
    const arg = rest[i]!;
    if (arg === "--") {
      positional.push(...rest.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      let name = arg.slice(2);
      let inline: string | undefined;
      const eq = name.indexOf("=");
      if (eq !== -1) {
        inline = name.slice(eq + 1);
        name = name.slice(0, eq);
      }

      const needValue = (): string => {
        if (inline !== undefined) {
          return inline;
        }
        i += 1;
        const next = rest[i];
        if (next === undefined) {
          throw new Error(`--${name} needs a value`);
        }
        return next;
      };

      switch (name) {
        case "book":
          book = needValue();
          break;
        case "mode":
          mode = needValue();
          break;
        case "scope":
          scope = needValue();
          break;
        case "nearby-words":
          nearbyWords = parseCount(needValue(), "nearby-words");
          break;
        case "limit":
          limit = parseCount(needValue(), "limit");
          break;
        case "match-case":
          matchCase = true;
          break;
        case "match-diacritics":
          matchDiacritics = true;
          break;
        default:
          throw new Error(`unknown flag --${name}`);
      }
      i += 1;
      continue;
    }

    if (command === undefined) {
      command = arg;
    } else {
      positional.push(arg);
    }
    i += 1;
  }

  if (command === undefined) {
    throw new Error("missing command");
  }

  const searchFlags =
    mode !== undefined ||
    scope !== undefined ||
    matchCase ||
    matchDiacritics ||
    nearbyWords !== undefined ||
    limit !== undefined;
  if (command !== "search" && searchFlags) {
    throw new Error(`${command} does not take search flags`);
  }

  let request: Record<string, unknown>;

  switch (command) {
    case "status":
    case "context":
    case "info":
    case "selection": {
      if (positional.length > 0) {
        throw new Error(`${command} does not take a value`);
      }
      request = { cmd: command };
      break;
    }
    case "open": {
      const path = onePositional(command, positional);
      if (!absoluteBookPath(path)) {
        throw new Error("open requires an absolute path");
      }
      request = { cmd: "open", path };
      break;
    }
    case "search": {
      let query: string;
      try {
        query = onePositional("search", positional);
      } catch {
        throw new Error("search requires a query");
      }
      request = { cmd: "search", query };
      if (mode !== undefined) {
        if (!SEARCH_MODES.has(mode)) {
          throw new Error(`unknown search mode ${mode}`);
        }
        request.mode = mode;
      }
      if (scope !== undefined) {
        if (!SEARCH_SCOPES.has(scope)) {
          throw new Error(`unknown search scope ${scope}`);
        }
        request.scope = scope;
      }
      if (matchCase) {
        request.matchCase = true;
      }
      if (matchDiacritics) {
        request.matchDiacritics = true;
      }
      if (nearbyWords !== undefined) {
        request.nearbyWords = nearbyWords;
      }
      if (limit !== undefined) {
        request.limit = limit;
      }
      break;
    }
    case "goto": {
      let cfi: string;
      try {
        cfi = onePositional("goto", positional);
      } catch {
        throw new Error("goto requires a cfi");
      }
      if (cfi.trim() === "") {
        throw new Error("goto requires a cfi");
      }
      request = { cmd: "goto", cfi };
      break;
    }
    default:
      throw new Error(`unknown command ${command}`);
  }

  request.id = "1";
  if (book !== undefined) {
    if (book === "") {
      throw new Error("--book needs a value");
    }
    request.book = book;
  }
  return request;
}
