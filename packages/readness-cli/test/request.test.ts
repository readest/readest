import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { absoluteBookPath, buildRequest } from "../src/request.ts";

function args(parts: string[]): string[] {
  return ["readness-cli", ...parts];
}

describe("buildRequest", () => {
  it("search builds the spec JSON including the hash", () => {
    const result = buildRequest(
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
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.request, {
      cmd: "search",
      query: "黑暗森林",
      mode: "regex",
      scope: "section",
      limit: 5,
      id: "1",
      book: "abc",
    });
  });

  it("accepts --flag=value forms", () => {
    const result = buildRequest(
      args(["search", "q", "--mode=contains", "--limit=20", "--book=hash1"]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.mode, "contains");
    assert.equal(result.request.limit, 20);
    assert.equal(result.request.book, "hash1");
  });

  it("search match-case and match-diacritics and nearby-words", () => {
    const result = buildRequest(
      args([
        "search",
        "dark forest",
        "--match-case",
        "--match-diacritics",
        "--nearby-words",
        "3",
        "--mode",
        "nearby-words",
      ]),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.request.matchCase, true);
    assert.equal(result.request.matchDiacritics, true);
    assert.equal(result.request.nearbyWords, 3);
    assert.equal(result.request.mode, "nearby-words");
  });

  it("status context info selection with optional --book", () => {
    for (const cmd of ["status", "context", "info", "selection"]) {
      const plain = buildRequest(args([cmd]));
      assert.equal(plain.ok, true);
      if (!plain.ok) continue;
      assert.deepEqual(plain.request, { cmd, id: "1" });

      const withBook = buildRequest(args([cmd, "--book", "h"]));
      assert.equal(withBook.ok, true);
      if (!withBook.ok) continue;
      assert.equal(withBook.request.book, "h");
    }
  });

  it("open accepts absolute unix and windows paths", () => {
    const unix = buildRequest(args(["open", "/tmp/book.epub"]));
    assert.equal(unix.ok, true);
    if (unix.ok) {
      assert.equal(unix.request.path, "/tmp/book.epub");
    }

    const win = buildRequest(
      args(["open", "C:\\Users\\user\\Documents\\book.epub"]),
    );
    assert.equal(win.ok, true);
    if (win.ok) {
      assert.equal(win.request.path, "C:\\Users\\user\\Documents\\book.epub");
    }
  });

  it("missing search query and goto cfi fail without a request", () => {
    for (const command of [["search"], ["goto"]]) {
      const result = buildRequest(args(command));
      assert.equal(result.ok, false, String(command));
    }
  });

  it("open refuses a relative path and a file url", () => {
    for (const path of ["book.epub", "file:///C:/book.epub"]) {
      const result = buildRequest(args(["open", path]));
      assert.equal(result.ok, false, path);
      if (!result.ok) {
        assert.match(result.message, /absolute path/);
      }
    }
  });

  it("rejects unknown command and search flags on status", () => {
    assert.equal(buildRequest(args(["nope"])).ok, false);
    const bad = buildRequest(args(["status", "--mode", "contains"]));
    assert.equal(bad.ok, false);
  });

  it("goto requires non-empty cfi", () => {
    assert.equal(buildRequest(args(["goto", "   "])).ok, false);
    const ok = buildRequest(args(["goto", "epubcfi(/6/14!)"]));
    assert.equal(ok.ok, true);
  });
});

describe("absoluteBookPath", () => {
  it("refuses empty, file urls, and relative names", () => {
    assert.equal(absoluteBookPath(""), false);
    assert.equal(absoluteBookPath("book.epub"), false);
    assert.equal(absoluteBookPath("file:///C:/book.epub"), false);
    assert.equal(absoluteBookPath("FILE://x"), false);
    assert.equal(absoluteBookPath("https://example.com/a.epub"), false);
  });

  it("accepts absolute paths", () => {
    assert.equal(absoluteBookPath("/tmp/a.epub"), true);
    assert.equal(absoluteBookPath("C:/book.epub"), true);
    assert.equal(absoluteBookPath("D:\\Books\\a.epub"), true);
    assert.equal(absoluteBookPath("\\\\server\\share\\a.epub"), true);
  });
});
