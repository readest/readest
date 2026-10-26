import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execute } from "../src/cli.ts";
import type { TransportResult } from "../src/transport.ts";

function args(parts: string[]): string[] {
  return ["readness-cli", ...parts];
}

describe("execute", () => {
  it("search builds the spec JSON including the hash", async () => {
    let sent: Buffer | undefined;
    const outcome = await execute(
      args([
        "search",
        "黑暗森林",
        "--mode",
        "regex",
        "--scope",
        "section",
        "--limit",
        "5",
        "--book",
        "abc",
      ]),
      async (body) => {
        sent = body;
        return { ok: true, body: Buffer.from('{"ok": true}') };
      },
    );
    assert.equal(outcome.code, 0);
    assert.ok(sent);
    const value = JSON.parse(sent!.toString("utf8"));
    assert.equal(value.cmd, "search");
    assert.equal(value.query, "黑暗森林");
    assert.equal(value.mode, "regex");
    assert.equal(value.scope, "section");
    assert.equal(value.limit, 5);
    assert.equal(value.book, "abc");
    assert.equal(value.id, "1");
  });

  it("missing search query and goto cfi exit 4 without a socket", async () => {
    for (const command of [["search"], ["goto"]]) {
      let called = false;
      const outcome = await execute(args(command), async () => {
        called = true;
        return { ok: true, body: Buffer.from('{"ok": true}') };
      });
      assert.equal(outcome.code, 4, String(command));
      assert.equal(called, false, String(command));
      assert.equal(outcome.stdout.length, 0, String(command));
      assert.ok(outcome.stderr.length > 0, String(command));
    }
  });

  it("open refuses a relative path and a file url", async () => {
    for (const path of ["book.epub", "file:///C:/book.epub"]) {
      let called = false;
      const outcome = await execute(args(["open", path]), async () => {
        called = true;
        return { ok: true, body: Buffer.from('{"ok": true}') };
      });
      assert.equal(outcome.code, 4, path);
      assert.equal(called, false, path);
    }
  });

  it("maps ok transport and app errors", async () => {
    const ok = await execute(args(["status"]), async () => ({
      ok: true,
      body: Buffer.from('{"ok": true}'),
    }));
    assert.equal(ok.code, 0);

    const appError = await execute(args(["status"]), async () => ({
      ok: true,
      body: Buffer.from('{"ok": false}'),
    }));
    assert.equal(appError.code, 2);

    const transport = await execute(args(["status"]), async () => ({
      ok: false,
    }));
    assert.equal(transport.code, 3);
    assert.equal(transport.stdout.length, 0);
  });

  it("success stdout is the response plus a newline and stderr is empty", async () => {
    const fixture = Buffer.from('{"ok": true}');
    const outcome = await execute(args(["status"]), async () => ({
      ok: true,
      body: fixture,
    }));
    const expected = Buffer.concat([fixture, Buffer.from("\n")]);
    assert.deepEqual(outcome.stdout, expected);
    assert.equal(outcome.stderr, "");
  });

  it("unreadable response is exit 3", async () => {
    const outcome = await execute(args(["status"]), async (): Promise<TransportResult> => ({
      ok: true,
      body: Buffer.from("not-json"),
    }));
    assert.equal(outcome.code, 3);
    assert.match(outcome.stderr, /unreadable/);
  });
});
