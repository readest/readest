import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const COMMAND = 'optimize_cover_thumbnails';
const PERMISSION = 'allow-optimize-cover-thumbnails';

const buildScript = readFileSync(resolve(process.cwd(), 'src-tauri/build.rs'), 'utf-8');
const rustCommandRegistry = readFileSync(resolve(process.cwd(), 'src-tauri/src/lib.rs'), 'utf-8');
const manifestCommandBlock =
  buildScript.match(/AppManifest::new\(\)\.commands\(&\[(?<commands>[\s\S]*?)\]\)/)?.groups?.[
    'commands'
  ] ?? '';
const manifestCommands = Array.from(
  manifestCommandBlock.matchAll(/"(?<command>[a-z0-9_]+)"/g),
  (match) => match.groups?.['command'],
).filter((command): command is string => command !== undefined);

const readCapabilityPermissions = (file: string): string[] => {
  const capability = JSON.parse(
    readFileSync(resolve(process.cwd(), `src-tauri/capabilities/${file}`), 'utf-8'),
  ) as { permissions: Array<string | { identifier: string }> };

  return capability.permissions.map((entry) =>
    typeof entry === 'string' ? entry : entry.identifier,
  );
};

// Every command in lib.rs's generate_handler! list. `#[cfg(...)]` attribute
// lines are skipped; the entries themselves are `module::path::command,`.
const registeredCommands = Array.from(
  (rustCommandRegistry.match(/generate_handler!\[(?<body>[\s\S]*?)\]\)/)?.groups?.['body'] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#[') && !line.startsWith('//'))
    .map((line) => line.replace(/,$/, ''))
    .map((entry) => entry.split('::').at(-1)),
).filter((command): command is string => command !== undefined);

// A command registered in Rust but missing from the manifest or the default
// capability is rejected at runtime with "not allowed. Command not found"
// (#6253's set_window_title shipped that way).
describe('every registered app command is declared and granted', () => {
  it('finds the registered commands', () => {
    expect(registeredCommands.length).toBeGreaterThan(20);
  });

  it('declares each command in the Tauri app manifest', () => {
    const missing = registeredCommands.filter((command) => !manifestCommands.includes(command));
    expect(missing).toEqual([]);
  });

  it('grants each command to local app windows', () => {
    const granted = readCapabilityPermissions('default.json');
    const missing = registeredCommands.filter(
      (command) => !granted.includes(`allow-${command.replaceAll('_', '-')}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('cover thumbnail app-command ACL (#5632)', () => {
  it('declares the command in the Tauri app manifest', () => {
    expect(manifestCommands).toContain(COMMAND);
    expect(rustCommandRegistry).toContain('cover_thumbnail::optimize_cover_thumbnails');
  });

  it('grants the command to local app windows', () => {
    expect(readCapabilityPermissions('default.json')).toContain(PERMISSION);
  });

  it('grants the command to the webdriver Tauri test window', () => {
    expect(readCapabilityPermissions('webdriver-remote.json')).toContain(PERMISSION);
  });
});

it('allows browser-session requests only in local app windows', () => {
  expect(manifestCommands).toContain('fetch_web_browser_resource');
  expect(readCapabilityPermissions('default.json')).toContain('allow-fetch-web-browser-resource');
  expect(readCapabilityPermissions('webdriver-remote.json')).not.toContain(
    'allow-fetch-web-browser-resource',
  );
  const capability = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf-8'),
  ) as { windows: string[] };
  expect(capability.windows).not.toContain('browser-*');
  expect(capability.windows).not.toContain('*');
});
