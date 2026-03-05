// Vitest runs tests inside an iframe. Tauri injects __TAURI_INTERNALS__
// into the main frame only, so we access it via window.top.
export function getTauri(): TauriInternals {
  const top = window.top ?? window;
  const tauri = (top as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] as
    | TauriInternals
    | undefined;
  if (!tauri) {
    throw new Error(
      '__TAURI_INTERNALS__ not found. Are tests running inside a Tauri WebView? ' +
        '(checked both window and window.top)',
    );
  }
  return tauri;
}

export function invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  return getTauri().invoke(cmd, args);
}
