import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('custom reader release boundary', () => {
  test('does not ship the upstream update client or endpoints', () => {
    const packageJson = read('apps/readest-app/package.json');
    const cargoToml = read('apps/readest-app/src-tauri/Cargo.toml');
    const cefCargoToml = read('apps/readest-app/src-tauri/.cargo/cef.toml');
    const cargoLock = read('Cargo.lock');
    const tauriConfig = read('apps/readest-app/src-tauri/tauri.conf.json');
    const upstreamUpdater = ['tauri', 'plugin', 'updater'].join('-');
    const upstreamReleaseHost = ['download', 'readest', 'com'].join('.');

    expect(packageJson).not.toContain(`@tauri-apps/${upstreamUpdater}`);
    expect(cargoToml).not.toContain(upstreamUpdater);
    expect(cefCargoToml).not.toContain(upstreamUpdater);
    expect(cargoLock).not.toContain(upstreamUpdater);
    expect(tauriConfig).not.toContain(upstreamReleaseHost);
    expect(existsSync(resolve(root, 'apps/readest-app/src/app/updater/page.tsx'))).toBe(false);
    expect(existsSync(resolve(root, 'apps/readest-app/src/components/UpdaterWindow.tsx'))).toBe(
      false,
    );
  });

  test('keeps updater artifacts disabled in the installer config', () => {
    const tauriConfig = JSON.parse(read('apps/readest-app/src-tauri/tauri.conf.json')) as {
      bundle: { createUpdaterArtifacts?: boolean };
      plugins: Record<string, unknown>;
    };

    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(false);
    expect(tauriConfig.plugins).not.toHaveProperty('updater');
  });
});
