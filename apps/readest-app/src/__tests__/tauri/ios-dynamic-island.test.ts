// @vitest-environment node
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, it } from 'vitest';

// iOS empties the Dynamic Island, and every app's Live Activity with it, while
// the foreground app hides the status bar or the home indicator (#7471).
// Readest hides the status bar for immersive reading, so the home indicator
// may hide only then: wherever the status bar shows (the library, the reader's
// toolbar, Always Show Status Bar) the home indicator and the island show too.
it('hides the home indicator exactly when it hides the status bar', () => {
  const swift = readFileSync(
    resolve(
      process.cwd(),
      'src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift',
    ),
    'utf-8',
  );
  const start = swift.indexOf('func set_system_ui_visibility(');
  expect(start).toBeGreaterThan(-1);
  const body = swift.slice(start, swift.indexOf('\n  @objc public func', start + 1));
  expect(body).toMatch(/"setPrefersHomeIndicatorAutoHidden:"[^)]*!visible/);
  expect(body).toMatch(/"setPrefersStatusBarHidden:"[^)]*!visible/);
});
