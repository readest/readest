import { homedir } from "node:os";
import { join } from "node:path";

/** Must match `identifier` in Readest `tauri.conf.json`. */
export const APP_IDENTIFIER = "com.bilingify.readest";
export const BRIDGE_FILE = "agent-bridge.json";

/**
 * Platform config dir (Tauri's `config_dir`), before joining the app id.
 * Override with READNESS_CONFIG_DIR for tests.
 */
export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const override = env.READNESS_CONFIG_DIR;
  if (override) {
    return override;
  }

  if (platform === "win32") {
    return env.APPDATA;
  }

  if (platform === "darwin") {
    const home = env.HOME ?? homedir();
    return home ? join(home, "Library", "Application Support") : undefined;
  }

  // Linux and other Unix
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) {
    return xdg;
  }
  const home = env.HOME ?? homedir();
  return home ? join(home, ".config") : undefined;
}

/** Full path to `agent-bridge.json`. */
export function bridgeFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const base = configDir(env, platform);
  if (!base) {
    return undefined;
  }
  return join(base, APP_IDENTIFIER, BRIDGE_FILE);
}
