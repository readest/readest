import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  APP_IDENTIFIER,
  BRIDGE_FILE,
  bridgeFilePath,
  configDir,
} from "../src/bridgePath.ts";

describe("bridgeFilePath", () => {
  it("uses APPDATA on Windows", () => {
    const path = bridgeFilePath(
      { APPDATA: "C:\\Users\\user\\AppData\\Roaming" },
      "win32",
    );
    assert.equal(
      path,
      join("C:\\Users\\user\\AppData\\Roaming", APP_IDENTIFIER, BRIDGE_FILE),
    );
  });

  it("uses Application Support on macOS", () => {
    const path = bridgeFilePath({ HOME: "/Users/me" }, "darwin");
    assert.equal(
      path,
      join(
        "/Users/me",
        "Library",
        "Application Support",
        APP_IDENTIFIER,
        BRIDGE_FILE,
      ),
    );
  });

  it("uses XDG_CONFIG_HOME or ~/.config on Linux", () => {
    const xdg = bridgeFilePath(
      { XDG_CONFIG_HOME: "/custom/config", HOME: "/home/me" },
      "linux",
    );
    assert.equal(xdg, join("/custom/config", APP_IDENTIFIER, BRIDGE_FILE));

    const fallback = bridgeFilePath({ HOME: "/home/me" }, "linux");
    assert.equal(
      fallback,
      join("/home/me", ".config", APP_IDENTIFIER, BRIDGE_FILE),
    );
  });

  it("honors READNESS_CONFIG_DIR override", () => {
    const path = bridgeFilePath(
      { READNESS_CONFIG_DIR: "/tmp/cfg", HOME: "/home/me" },
      "linux",
    );
    assert.equal(path, join("/tmp/cfg", APP_IDENTIFIER, BRIDGE_FILE));
  });

  it("configDir returns undefined without home on unix", () => {
    assert.equal(configDir({ HOME: "" }, "linux"), undefined);
  });
});
