import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyResponse, EXIT_OK, EXIT_APP_ERROR, EXIT_TRANSPORT } from "../src/exit.ts";

describe("classifyResponse", () => {
  it("maps ok true to 0 and ok false to 2", () => {
    assert.deepEqual(classifyResponse('{"ok": true}'), {
      kind: "ok",
      code: EXIT_OK,
    });
    assert.deepEqual(classifyResponse(Buffer.from('{"ok": false, "error": "x"}')), {
      kind: "app-error",
      code: EXIT_APP_ERROR,
    });
  });

  it("maps unreadable bodies to transport", () => {
    assert.equal(classifyResponse("not-json").code, EXIT_TRANSPORT);
    assert.equal(classifyResponse("{}").code, EXIT_TRANSPORT);
    assert.equal(classifyResponse('{"ok": 1}').code, EXIT_TRANSPORT);
  });
});
