interface TauriInternals {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

interface Window {
  __TAURI_INTERNALS__: TauriInternals;
}
