import { readFileSync } from 'fs';
import { resolve } from 'path';
import { expect, it } from 'vitest';

// Apps built with the iOS 27 SDK can no longer hide the status bar through
// UIApplication.setStatusBarHidden; the native bridge hides it through the root
// view controller's prefersStatusBarHidden instead, which iOS only consults
// when the status bar appearance is view-controller based. With it off, the
// reader never hides the status bar (and iPhone Duo's side strip keeps its
// 84pt inset) on Xcode 27 builds.
// tauri-cli merges the generated Info.plist, then src-tauri/Info.plist, then
// bundle.iOS.infoPlist last, so the iOS override file wins when it sets the key.
const readPlistBool = (path: string, key: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf-8').match(
    new RegExp(`<key>${key}</key>\\s*<(?<value>true|false)\\s*/>`),
  )?.groups?.['value'];

it('keeps the effective iOS status bar appearance view-controller based', () => {
  const conf = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf-8'),
  );
  const iosPlist: string | undefined = conf.bundle?.iOS?.infoPlist;
  const key = 'UIViewControllerBasedStatusBarAppearance';
  const value =
    (iosPlist ? readPlistBool(resolve('src-tauri', iosPlist), key) : undefined) ??
    readPlistBool('src-tauri/Info.plist', key);
  expect(value).toBe('true');
});

it('hides the status bar through the view controller, not UIApplication', () => {
  const swift = readFileSync(
    resolve(
      process.cwd(),
      'src-tauri/plugins/tauri-plugin-native-bridge/ios/Sources/NativeBridgePlugin.swift',
    ),
    'utf-8',
  );
  expect(swift).toContain('setPrefersStatusBarHidden:');
  expect(swift).not.toMatch(/UIApplication\.shared\.setStatusBarHidden/);
});
