# Nightly Update Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in nightly update channel (Android/Windows/macOS/Linux) with a daily R2-published build and an in-app updater whose check is isolated from Tauri's built-in updater.

**Architecture:** A base-aware version comparator (implemented identically in TS and Rust against one shared test matrix) ranks same-base nightlies above the matching stable but a higher-base stable above an older-base nightly. The JS check fetches both `nightly/latest.json` and stable `latest.json`, filters by platform eligibility, and picks the newest. Install reuses Tauri's verified updater for macOS + Windows-NSIS (via a thin Rust command driving `UpdaterBuilder` with a custom endpoint + the comparator) and the existing custom JS flows + a new minisign verify gate for Windows-portable / Linux-AppImage / Android. A scheduled GitHub Actions workflow builds nightly artifacts and assembles the manifest race-free into R2.

**Tech Stack:** Next.js + Tauri v2, `semver` (npm + Rust crate), `tauri-plugin-updater` 2.10, `minisign-verify` (Rust), Vitest, GitHub Actions, Cloudflare R2 via rclone.

**Spec:** `docs/superpowers/specs/2026-06-14-nightly-update-channel-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/version.ts` | `parseUpdateVersion`, `isUpdateNewer` (pure, TS side of the rule) | Modify |
| `src/__tests__/utils/version.test.ts` | Comparator matrix tests | Create |
| `src/types/settings.ts` | `updateChannel` field | Modify |
| `src/services/constants.ts` | default `updateChannel`, `READEST_NIGHTLY_UPDATER_FILE`, `READEST_UPDATER_PUBKEY` | Modify |
| `src/helpers/updater.ts` | channel-aware check + `resolveNightlyUpdate` + `getNightlyPlatformKey` | Modify |
| `src/__tests__/helpers/updater.test.ts` | nightly resolution + routing tests | Modify |
| `src/utils/bridge.ts` | `verifyUpdateSignature`, `installNightlyUpdate` JS wrappers | Modify |
| `src/components/UpdaterWindow.tsx` | consume resolved winner; nightly routing; verify gate; UI states; friendly version | Modify |
| `src/app/library/components/SettingsMenu.tsx` | "Nightly Builds (Unstable)" toggle | Modify |
| `src-tauri/src/nightly_update.rs` | `is_update_newer`, `verify_update_signature`, `install_nightly_update` Rust commands | Create |
| `src-tauri/src/lib.rs` | register the new commands + `mod nightly_update` | Modify |
| `src-tauri/Cargo.toml` | `semver`, `minisign-verify` deps | Modify |
| `.github/workflows/nightly.yml` | scheduled build → R2 | Create |

---

## Phase A — Version comparator (TS + Rust, shared matrix)

### Task A1: TypeScript comparator

**Files:**
- Modify: `src/utils/version.ts`
- Test: `src/__tests__/utils/version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/utils/version.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { parseUpdateVersion, isUpdateNewer } from '@/utils/version';

describe('parseUpdateVersion', () => {
  test('parses a stable version', () => {
    expect(parseUpdateVersion('0.11.4')).toEqual({ base: '0.11.4', stamp: null, isNightly: false });
  });
  test('parses a nightly stamp', () => {
    expect(parseUpdateVersion('0.11.4-2026061406')).toEqual({
      base: '0.11.4',
      stamp: 2026061406,
      isNightly: true,
    });
  });
  test('non-10-digit prerelease is not a nightly stamp', () => {
    expect(parseUpdateVersion('0.11.4-rc.1')).toEqual({ base: '0.11.4', stamp: null, isNightly: false });
    expect(parseUpdateVersion('0.11.4-2026')).toEqual({ base: '0.11.4', stamp: null, isNightly: false });
  });
  test('returns null for malformed input', () => {
    expect(parseUpdateVersion('')).toBeNull();
    expect(parseUpdateVersion('not-a-version')).toBeNull();
  });
});

describe('isUpdateNewer', () => {
  const cases: Array<[string, string, boolean]> = [
    ['0.11.5', '0.11.4-2026061406', true],
    ['0.11.4-2026061506', '0.11.4-2026061406', true],
    ['0.11.4-2026061406', '0.11.4-2026061506', false],
    ['0.11.4', '0.11.4-2026061406', false],
    ['0.11.4-2026061406', '0.11.4', true],
    ['0.11.5-2026070106', '0.11.4', true],
    ['0.11.4', '0.11.4', false],
    ['0.11.4-2026061406', '0.11.4-2026061406', false],
    ['0.11.4-rc.1', '0.11.4', false],
    ['', '0.11.4', false],
    ['0.11.4', '', false],
  ];
  test.each(cases)('isUpdateNewer(%s, %s) === %s', (candidate, current, expected) => {
    expect(isUpdateNewer(candidate, current)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/__tests__/utils/version.test.ts`
Expected: FAIL — `parseUpdateVersion`/`isUpdateNewer` are not exported.

- [ ] **Step 3: Implement the comparator**

Replace the contents of `src/utils/version.ts` with:

```typescript
import semver from 'semver';
import packageJson from '../../package.json';

export const getAppVersion = () => {
  return packageJson.version;
};

export interface ParsedUpdateVersion {
  base: string; // "X.Y.Z"
  stamp: number | null; // YYYYMMDDHH, or null when not a nightly
  isNightly: boolean;
}

// A nightly version is `<base>-<YYYYMMDDHH>`: a single, pure-10-digit
// prerelease identifier. Anything else (e.g. `-rc.1`, `-2026`) is treated as a
// non-nightly base version.
export const parseUpdateVersion = (version: string): ParsedUpdateVersion | null => {
  const parsed = semver.parse(version);
  if (!parsed) return null;
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  let stamp: number | null = null;
  if (parsed.prerelease.length === 1) {
    const id = String(parsed.prerelease[0]);
    if (/^\d{10}$/.test(id)) {
      stamp = Number(id);
    }
  }
  return { base, stamp, isNightly: stamp !== null };
};

// Base-aware "is candidate newer than current?" used by both the nightly channel
// check and (mirrored in Rust) the Tauri updater version_comparator.
// Rule: higher X.Y.Z core wins; on equal core a nightly outranks the matching
// stable (it was built after it) but never the reverse; two nightlies compare by
// stamp.
export const isUpdateNewer = (candidate: string, current: string): boolean => {
  const c = parseUpdateVersion(candidate);
  const cur = parseUpdateVersion(current);
  if (!c || !cur) return false;
  if (c.base !== cur.base) {
    return semver.compare(c.base, cur.base) > 0;
  }
  if (c.isNightly && !cur.isNightly) return true;
  if (!c.isNightly && cur.isNightly) return false;
  if (c.isNightly && cur.isNightly) return (c.stamp as number) > (cur.stamp as number);
  return false;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/__tests__/utils/version.test.ts`
Expected: PASS (all matrix rows green).

- [ ] **Step 5: Commit**

```bash
git add src/utils/version.ts src/__tests__/utils/version.test.ts
git commit -m "feat(updater): base-aware nightly version comparator (TS)"
```

---

### Task A2: Rust comparator mirror

**Files:**
- Create: `src-tauri/src/nightly_update.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod nightly_update;`)
- Modify: `src-tauri/Cargo.toml` (add `semver`)

- [ ] **Step 1: Add the `semver` dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]` (the cross-platform section), add:

```toml
semver = "1"
```

- [ ] **Step 2: Create the Rust module with the comparator + a unit test**

Create `src-tauri/src/nightly_update.rs`:

```rust
//! Nightly update channel: base-aware version comparator + verify/install
//! commands. The comparator mirrors `src/utils/version.ts::isUpdateNewer` and is
//! validated against the same matrix.

use semver::Version;

/// Returns the 10-digit nightly stamp if the prerelease is exactly `YYYYMMDDHH`.
fn parse_stamp(v: &Version) -> Option<u64> {
    let pre = v.pre.as_str();
    if pre.len() == 10 && pre.bytes().all(|b| b.is_ascii_digit()) {
        pre.parse::<u64>().ok()
    } else {
        None
    }
}

/// Base-aware "is `candidate` newer than `current`?" — see version.ts for the rule.
pub fn is_update_newer(candidate: &str, current: &str) -> bool {
    let (c, cur) = match (Version::parse(candidate), Version::parse(current)) {
        (Ok(c), Ok(cur)) => (c, cur),
        _ => return false,
    };
    let c_base = (c.major, c.minor, c.patch);
    let cur_base = (cur.major, cur.minor, cur.patch);
    if c_base != cur_base {
        return c_base > cur_base;
    }
    match (parse_stamp(&c), parse_stamp(&cur)) {
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (Some(cs), Some(curs)) => cs > curs,
        (None, None) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_update_newer;

    #[test]
    fn matrix() {
        let cases: &[(&str, &str, bool)] = &[
            ("0.11.5", "0.11.4-2026061406", true),
            ("0.11.4-2026061506", "0.11.4-2026061406", true),
            ("0.11.4-2026061406", "0.11.4-2026061506", false),
            ("0.11.4", "0.11.4-2026061406", false),
            ("0.11.4-2026061406", "0.11.4", true),
            ("0.11.5-2026070106", "0.11.4", true),
            ("0.11.4", "0.11.4", false),
            ("0.11.4-2026061406", "0.11.4-2026061406", false),
            ("0.11.4-rc.1", "0.11.4", false),
            ("", "0.11.4", false),
            ("0.11.4", "", false),
        ];
        for (cand, cur, want) in cases {
            assert_eq!(is_update_newer(cand, cur), *want, "is_update_newer({cand}, {cur})");
        }
    }
}
```

- [ ] **Step 3: Declare the module**

In `src-tauri/src/lib.rs`, add near the other top-level `mod` declarations (e.g. after `mod transfer_file;` — search for `mod transfer_file` or the `use transfer_file::` line at `src/lib.rs:48` and add the module declaration alongside the others):

```rust
mod nightly_update;
```

- [ ] **Step 4: Run the Rust test**

Run: `pnpm test:rust` (i.e. `cargo test -p Readest --lib nightly_update`)
Expected: PASS — `nightly_update::tests::matrix`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/nightly_update.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(updater): base-aware nightly comparator (Rust mirror)"
```

---

## Phase B — Settings + constants

### Task B1: Settings type, defaults, constants

**Files:**
- Modify: `src/types/settings.ts:283`
- Modify: `src/services/constants.ts` (default block ~line 108; updater constants ~line 794)

- [ ] **Step 1: Add the setting field**

In `src/types/settings.ts`, in the `SystemSettings` interface, immediately after `autoCheckUpdates: boolean;` (line 283), add:

```typescript
  updateChannel: 'stable' | 'nightly';
```

- [ ] **Step 2: Add the default**

In `src/services/constants.ts`, in `DEFAULT_SYSTEM_SETTINGS`, immediately after `autoCheckUpdates: true,`, add:

```typescript
  updateChannel: 'stable',
```

- [ ] **Step 3: Add the nightly endpoint + pubkey constants**

In `src/services/constants.ts`, after the existing `READEST_UPDATER_FILE` / `READEST_CHANGELOG_FILE` block (~line 798), add:

```typescript
export const READEST_NIGHTLY_UPDATER_FILE = 'https://download.readest.com/nightly/latest.json';

// Public (verification) key, identical to src-tauri/tauri.conf.json `updater.pubkey`.
// Used to verify nightly artifacts in the custom install flows (portable /
// AppImage / Android). Safe to embed — it is a public key.
export const READEST_UPDATER_PUBKEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJFMEQ1QjE2OEU1NEIzNTEKUldSUnMxU09GbHNOdmpEaWFMT1crRFpEV2VORzQ2MklxaFc0M1R0ci9xY2c1bENXS0xhM1R1L2sK';
```

- [ ] **Step 4: Type-check**

Run: `pnpm lint`
Expected: PASS (no type errors from the new field; all settings consumers compile).

- [ ] **Step 5: Commit**

```bash
git add src/types/settings.ts src/services/constants.ts
git commit -m "feat(updater): add updateChannel setting + nightly constants"
```

---

### Task B2: Settings menu toggle

**Files:**
- Modify: `src/app/library/components/SettingsMenu.tsx` (state ~line 57; handler ~line 158; JSX ~line 388)

- [ ] **Step 1: Add local state**

In `src/app/library/components/SettingsMenu.tsx`, after the `isAutoCheckUpdates` state (line 57), add:

```typescript
  const [isNightlyChannel, setIsNightlyChannel] = useState(settings.updateChannel === 'nightly');
```

- [ ] **Step 2: Add the toggle handler**

After the `toggleAutoCheckUpdates` handler (ends ~line 162), add:

```typescript
  const toggleNightlyChannel = () => {
    const newValue = !isNightlyChannel;
    saveSysSettings(envConfig, 'updateChannel', newValue ? 'nightly' : 'stable');
    setIsNightlyChannel(newValue);
  };
```

- [ ] **Step 3: Add the menu item**

In the JSX, immediately after the "Check Updates on Start" `MenuItem` block (lines 388-394), add:

```typescript
      {appService?.hasUpdater && (
        <MenuItem
          label={_('Nightly Builds (Unstable)')}
          description={isNightlyChannel ? _('Early daily builds; may be unstable') : ''}
          toggled={isNightlyChannel}
          onClick={toggleNightlyChannel}
        />
      )}
```

- [ ] **Step 4: Verify build + type-check**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/library/components/SettingsMenu.tsx
git commit -m "feat(updater): nightly channel toggle in settings menu"
```

---

## Phase C — Isolated nightly check (JS)

### Task C1: `getNightlyPlatformKey` + `resolveNightlyUpdate`

**Files:**
- Modify: `src/helpers/updater.ts`
- Test: `src/__tests__/helpers/updater.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/__tests__/helpers/updater.test.ts`, first extend the existing mocks (the `@/utils/version` mock currently only exposes `getAppVersion`, and the `@/services/constants` mock lacks the nightly endpoint). Replace those two `vi.mock` blocks with:

```typescript
let mockAppVersion = '1.0.0';
vi.mock('@/utils/version', async () => {
  const actual = await vi.importActual<typeof import('@/utils/version')>('@/utils/version');
  return {
    ...actual,
    getAppVersion: () => mockAppVersion,
  };
});

vi.mock('@/services/constants', () => ({
  CHECK_UPDATE_INTERVAL_SEC: 86400,
  READEST_UPDATER_FILE: 'https://example.com/latest.json',
  READEST_CHANGELOG_FILE: 'https://example.com/release-notes.json',
  READEST_NIGHTLY_UPDATER_FILE: 'https://example.com/nightly/latest.json',
}));
```

Then add a new describe block (after the existing `checkForAppUpdates` block) and extend the `@/helpers/updater` import to include `resolveNightlyUpdate` and `getNightlyPlatformKey`:

```typescript
import {
  checkForAppUpdates,
  checkAppReleaseNotes,
  setLastShownReleaseNotesVersion,
  getLastShownReleaseNotesVersion,
  resolveNightlyUpdate,
  getNightlyPlatformKey,
} from '@/helpers/updater';

describe('getNightlyPlatformKey', () => {
  test('android', () => {
    expect(getNightlyPlatformKey('android', 'aarch64', false, false)).toBe('android-arm64');
    expect(getNightlyPlatformKey('android', 'x86_64', false, false)).toBe('android-universal');
  });
  test('windows nsis vs portable', () => {
    expect(getNightlyPlatformKey('windows', 'x86_64', false, false)).toBe('windows-x86_64');
    expect(getNightlyPlatformKey('windows', 'x86_64', true, false)).toBe('windows-x86_64-portable');
  });
  test('linux appimage vs deb', () => {
    expect(getNightlyPlatformKey('linux', 'x86_64', false, true)).toBe('linux-x86_64-appimage');
    expect(getNightlyPlatformKey('linux', 'x86_64', false, false)).toBe('linux-x86_64');
  });
  test('macos', () => {
    expect(getNightlyPlatformKey('macos', 'aarch64', false, false)).toBe('darwin-aarch64');
  });
});

describe('resolveNightlyUpdate', () => {
  const mkRes = (body: unknown) => ({ ok: true, json: async () => body });
  const platformKey = 'darwin-aarch64';
  const entry = { url: 'https://x/app.tar.gz', signature: 'sig' };

  test('picks newer nightly over stable when stable is same-base', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('nightly')
        ? mkRes({ version: '0.11.4-2026061406', platforms: { [platformKey]: entry } })
        : mkRes({ version: '0.11.4', platforms: { [platformKey]: entry } }),
    );
    const r = await resolveNightlyUpdate('0.11.4', platformKey, fetchFn as never);
    expect(r?.version).toBe('0.11.4-2026061406');
    expect(r?.endpoint).toContain('nightly');
  });

  test('picks higher-base stable over older nightly', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('nightly')
        ? mkRes({ version: '0.11.4-2026061406', platforms: { [platformKey]: entry } })
        : mkRes({ version: '0.11.5', platforms: { [platformKey]: entry } }),
    );
    const r = await resolveNightlyUpdate('0.11.4-2026061406', platformKey, fetchFn as never);
    expect(r?.version).toBe('0.11.5');
    expect(r?.endpoint).not.toContain('nightly');
  });

  test('ignores a manifest missing the current platform key', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.includes('nightly')
        ? mkRes({ version: '0.11.4-2026061406', platforms: { [platformKey]: entry } })
        : mkRes({ version: '0.11.5', platforms: {} }),
    );
    const r = await resolveNightlyUpdate('0.11.4', platformKey, fetchFn as never);
    expect(r?.version).toBe('0.11.4-2026061406');
  });

  test('returns null when nothing is newer than installed', async () => {
    const fetchFn = vi.fn(async () => mkRes({ version: '0.11.4', platforms: { [platformKey]: entry } }));
    const r = await resolveNightlyUpdate('0.11.4', platformKey, fetchFn as never);
    expect(r).toBeNull();
  });

  test('returns null when both manifests fail to fetch', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network');
    });
    const r = await resolveNightlyUpdate('0.11.4', platformKey, fetchFn as never);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/__tests__/helpers/updater.test.ts`
Expected: FAIL — `resolveNightlyUpdate` / `getNightlyPlatformKey` not exported.

- [ ] **Step 3: Implement the helpers**

In `src/helpers/updater.ts`, update the imports at the top:

```typescript
import { getAppVersion, isUpdateNewer } from '@/utils/version';
import {
  CHECK_UPDATE_INTERVAL_SEC,
  READEST_CHANGELOG_FILE,
  READEST_UPDATER_FILE,
  READEST_NIGHTLY_UPDATER_FILE,
} from '@/services/constants';
```

Then add (above `checkForAppUpdates`):

```typescript
type FetchFn = typeof fetch;

export interface UpdateManifestEntry {
  url?: string;
  signature?: string;
}
export interface UpdateManifest {
  version: string;
  pub_date?: string;
  notes?: string;
  platforms: Record<string, UpdateManifestEntry>;
}
export interface ResolvedNightlyUpdate {
  endpoint: string; // manifest URL (for the Tauri UpdaterBuilder path)
  version: string;
  notes?: string;
  pubDate?: string;
  platformKey: string;
  url: string; // artifact URL (for the custom install flows)
  signature: string; // artifact signature
}

export const getNightlyPlatformKey = (
  osTypeVal: string,
  osArchVal: string,
  isPortable: boolean,
  isAppImage: boolean,
): string | null => {
  const is64 = osArchVal === 'x86_64';
  if (osTypeVal === 'android') return osArchVal === 'aarch64' ? 'android-arm64' : 'android-universal';
  if (osTypeVal === 'macos') return osArchVal === 'aarch64' ? 'darwin-aarch64' : 'darwin-x86_64';
  if (osTypeVal === 'windows') {
    if (isPortable) return is64 ? 'windows-x86_64-portable' : 'windows-aarch64-portable';
    return is64 ? 'windows-x86_64' : 'windows-aarch64';
  }
  if (osTypeVal === 'linux') {
    if (isAppImage) return is64 ? 'linux-x86_64-appimage' : 'linux-aarch64-appimage';
    return is64 ? 'linux-x86_64' : 'linux-aarch64';
  }
  return null;
};

const fetchManifest = async (fetchFn: FetchFn, url: string): Promise<UpdateManifest | null> => {
  try {
    const res = await fetchFn(url, { connectTimeout: 5000 } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as UpdateManifest;
  } catch (err) {
    console.warn('Failed to fetch update manifest', url, err);
    return null;
  }
};

// Nightly channel resolution: fetch the nightly + stable manifests, keep only
// candidates that (a) have a usable artifact for this platform and (b) are newer
// than the installed version, then return the newest by the base-aware rule.
export const resolveNightlyUpdate = async (
  currentVersion: string,
  platformKey: string,
  fetchFn: FetchFn,
): Promise<ResolvedNightlyUpdate | null> => {
  const [nightly, stable] = await Promise.all([
    fetchManifest(fetchFn, READEST_NIGHTLY_UPDATER_FILE),
    fetchManifest(fetchFn, READEST_UPDATER_FILE),
  ]);
  const sources: Array<[UpdateManifest | null, string]> = [
    [nightly, READEST_NIGHTLY_UPDATER_FILE],
    [stable, READEST_UPDATER_FILE],
  ];
  const candidates: ResolvedNightlyUpdate[] = [];
  for (const [manifest, endpoint] of sources) {
    if (!manifest?.version) continue;
    const entry = manifest.platforms?.[platformKey];
    if (!entry?.url || !entry?.signature) continue; // platform-eligibility filter
    if (!isUpdateNewer(manifest.version, currentVersion)) continue;
    candidates.push({
      endpoint,
      version: manifest.version,
      notes: manifest.notes,
      pubDate: manifest.pub_date,
      platformKey,
      url: entry.url,
      signature: entry.signature,
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (isUpdateNewer(a.version, b.version) ? -1 : 1));
  return candidates[0]!;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/__tests__/helpers/updater.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/updater.ts src/__tests__/helpers/updater.test.ts
git commit -m "feat(updater): nightly manifest resolution (filter-then-compare)"
```

---

### Task C2: Channel-aware `checkForAppUpdates`

**Files:**
- Modify: `src/helpers/updater.ts` (`checkForAppUpdates`, ~line 37)
- Modify: `src/components/UpdaterWindow.tsx` (`setUpdaterWindowVisible` payload — extended in Task D4)
- Test: `src/__tests__/helpers/updater.test.ts`

The channel comes from settings. `checkForAppUpdates` already takes `(_, isAutoCheck)`. Add an optional `updateChannel` parameter (the callers in `page.tsx` pass `settings.updateChannel`) so the helper stays pure/testable.

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/helpers/updater.test.ts` (inside the `checkForAppUpdates` describe), and add `arch` to the os mock at the top:

```typescript
// add near the other mocks:
const mockOsArch = vi.fn();
vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => mockOsType(),
  arch: () => mockOsArch(),
}));
```

```typescript
  test('nightly channel resolves and opens the updater window', async () => {
    const past = Date.now() - 86400 * 1000 - 1000;
    localStorage.setItem('lastAppUpdateCheck', past.toString());
    mockOsType.mockReturnValue('macos');
    mockOsArch.mockReturnValue('aarch64');
    mockAppVersion = '0.11.4';
    mockTauriFetch.mockImplementation(async (url: string) =>
      url.includes('nightly')
        ? { ok: true, json: async () => ({ version: '0.11.4-2026061406', platforms: { 'darwin-aarch64': { url: 'u', signature: 's' } } }) }
        : { ok: true, json: async () => ({ version: '0.11.4', platforms: { 'darwin-aarch64': { url: 'u', signature: 's' } } }) },
    );
    mockIsTauriAppPlatform = true;

    const result = await checkForAppUpdates(dummyTranslate, false, 'nightly');

    expect(result).toBe(true);
    expect(mockCheck).not.toHaveBeenCalled(); // isolated from Tauri check()
    expect(mockSetUpdaterWindowVisible).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/__tests__/helpers/updater.test.ts`
Expected: FAIL — `checkForAppUpdates` ignores the 3rd arg / still calls Tauri path.

- [ ] **Step 3: Implement the channel branch**

In `src/helpers/updater.ts`, change the signature and add the nightly branch. Update imports to add the tauri http fetch and os arch:

```typescript
import { type as osType, arch as osArch } from '@tauri-apps/plugin-os';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
```

Change the function:

```typescript
export const checkForAppUpdates = async (
  _: TranslationFunc,
  isAutoCheck = true,
  updateChannel: 'stable' | 'nightly' = 'stable',
): Promise<boolean> => {
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const now = Date.now();
  if (isAutoCheck && lastCheck && now - parseInt(lastCheck, 10) < CHECK_UPDATE_INTERVAL_SEC * 1000)
    return false;
  localStorage.setItem(LAST_CHECK_KEY, now.toString());

  console.log('Checking for updates', { updateChannel });
  const OS_TYPE = osType();

  if (updateChannel === 'nightly') {
    const platformKey = getNightlyPlatformKey(
      OS_TYPE,
      osArch(),
      Boolean((window as { __READEST_IS_PORTABLE?: boolean }).__READEST_IS_PORTABLE),
      Boolean((window as { __READEST_IS_APPIMAGE?: boolean }).__READEST_IS_APPIMAGE),
    );
    if (!platformKey) return false;
    const resolved = await resolveNightlyUpdate(getAppVersion(), platformKey, tauriFetch as never);
    if (resolved) {
      setUpdaterWindowVisible(true, resolved.version, getAppVersion(), true, resolved);
      return true;
    }
    return false;
  }

  if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
    // ...existing stable desktop branch unchanged...
```

Keep the rest of the stable branch (`macos/windows/linux` + `android`) exactly as it is today.

Note on the portable flag: confirm the global used to detect the portable build (search `__READEST_IS_PORTABLE` / `isPortableApp` in `src/services/nativeAppService.ts`). If the portable build is detected via a different global, use that one. The AppImage global `__READEST_IS_APPIMAGE` is confirmed in `nativeAppService.ts:554`.

- [ ] **Step 4: Update the callers**

In `src/app/library/page.tsx` (~line 374) and `src/app/reader/page.tsx` (~line 30), pass the channel. Change:

```typescript
if (appService?.hasUpdater && settings.autoCheckUpdates) {
  checkForAppUpdates(_, true);
}
```

to:

```typescript
if (appService?.hasUpdater && settings.autoCheckUpdates) {
  checkForAppUpdates(_, true, settings.updateChannel);
}
```

Also update the manual-check caller in `src/components/AboutWindow.tsx` (the `handleCheckUpdate` → `checkForAppUpdates(_, false)`) to `checkForAppUpdates(_, false, settings.updateChannel)` (obtain `settings` from `useSettingsStore` if not already in scope).

- [ ] **Step 5: Run tests + lint**

Run: `pnpm test src/__tests__/helpers/updater.test.ts && pnpm lint`
Expected: PASS. (The `setUpdaterWindowVisible` 5th argument is added in Task D4; until then TS may flag the extra arg — implement Task D4 before the final `pnpm lint`, or land C2+D4 together.)

- [ ] **Step 6: Commit**

```bash
git add src/helpers/updater.ts src/__tests__/helpers/updater.test.ts src/app/library/page.tsx src/app/reader/page.tsx src/components/AboutWindow.tsx
git commit -m "feat(updater): channel-aware checkForAppUpdates (isolated nightly check)"
```

---

## Phase D — Install

### Task D1: Rust `verify_update_signature` command

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `minisign-verify`)
- Modify: `src-tauri/src/nightly_update.rs` (add the command)
- Modify: `src-tauri/src/lib.rs` (register)

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml` `[dependencies]`:

```toml
minisign-verify = "0.2"
```

- [ ] **Step 2: Implement the command**

Append to `src-tauri/src/nightly_update.rs`:

```rust
use minisign_verify::{PublicKey, Signature};
use std::fs;
use tauri::command;

/// Verify a downloaded artifact against a minisign signature using the embedded
/// updater public key. `pub_key` is the base64 blob from tauri.conf.json
/// `updater.pubkey` (the same format the Tauri updater consumes). `signature` is
/// the contents of the artifact's `.sig` file.
#[command]
pub async fn verify_update_signature(path: String, signature: String, pub_key: String) -> bool {
    let decoded_key = match String::from_utf8(
        base64_decode(&pub_key).unwrap_or_default(),
    ) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let public_key = match PublicKey::from_base64(decoded_key.lines().last().unwrap_or("")) {
        Ok(k) => k,
        Err(_) => return false,
    };
    let sig = match Signature::decode(&signature) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let data = match fs::read(&path) {
        Ok(d) => d,
        Err(_) => return false,
    };
    public_key.verify(&data, &sig, false).is_ok()
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).ok()
}
```

Note: `base64` is already an indirect dependency via Tauri; if `cargo build` reports it is not a direct dependency, add `base64 = "0.22"` to `[dependencies]`. The Tauri `updater.pubkey` is a base64 of the minisign public-key file text (a 2-line `untrusted comment` + key), which is why we base64-decode then take the last line. Verify this matches `verify_signature` in `tauri-plugin-updater-2.10.1/src/updater.rs:1453` during implementation and adjust the decode if the installed crate version differs.

- [ ] **Step 3: Register the command**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]` (after `clip_url::clip_url,` at line 292), add:

```rust
            nightly_update::verify_update_signature,
```

- [ ] **Step 4: Build to verify it compiles**

Run: `pnpm clippy:check`
Expected: PASS (no clippy errors in `nightly_update.rs`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/nightly_update.rs src-tauri/src/lib.rs
git commit -m "feat(updater): verify_update_signature Rust command (minisign)"
```

---

### Task D2: Rust `install_nightly_update` command (desktop)

**Files:**
- Modify: `src-tauri/src/nightly_update.rs`
- Modify: `src-tauri/src/lib.rs` (register, desktop-gated)

- [ ] **Step 1: Implement the command**

Append to `src-tauri/src/nightly_update.rs`:

```rust
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightlyProgress {
    pub event: String, // "started" | "progress" | "finished"
    pub downloaded: u64,
    pub content_length: u64,
}

/// Drives the Tauri updater against a single nightly/stable manifest endpoint
/// with the base-aware comparator, then downloads + installs + relaunches.
/// Reuses Tauri's minisign verification and native installers (.app.tar.gz on
/// macOS, NSIS on Windows). Progress is streamed to the JS dialog over `channel`.
#[cfg(desktop)]
#[command]
pub async fn install_nightly_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    endpoint: String,
    channel: tauri::ipc::Channel<NightlyProgress>,
) -> std::result::Result<(), String> {
    use tauri::Url;
    use tauri_plugin_updater::UpdaterExt;

    let url = Url::parse(&endpoint).map_err(|e| e.to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .version_comparator(|current, release| {
            is_update_newer(&release.version.to_string(), &current.to_string())
        })
        .build()
        .map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Err("no update available".into());
    };

    let mut downloaded: u64 = 0;
    let ch = channel.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = ch.send(NightlyProgress {
                    event: "progress".into(),
                    downloaded,
                    content_length: total.unwrap_or(0),
                });
            },
            move || {
                let _ = channel.send(NightlyProgress {
                    event: "finished".into(),
                    downloaded: 0,
                    content_length: 0,
                });
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
```

Note: confirm the `UpdaterBuilder` method names (`endpoints`, `version_comparator`, `build`), the `version_comparator` closure signature `(Version, RemoteRelease) -> bool`, and `download_and_install(on_chunk: Fn(usize, Option<u64>), on_finish: Fn())` against `tauri-plugin-updater-2.10.1` (paths surfaced in the spec review: `updater.rs:184,197`, `commands.rs:67`). `app.restart()` diverges (never returns).

- [ ] **Step 2: Register the command (desktop only)**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![ ... ]`, add:

```rust
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            nightly_update::install_nightly_update,
```

- [ ] **Step 3: Build**

Run: `pnpm clippy:check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/nightly_update.rs src-tauri/src/lib.rs
git commit -m "feat(updater): install_nightly_update Rust command (Tauri updater, custom endpoint)"
```

---

### Task D3: JS bridge wrappers

**Files:**
- Modify: `src/utils/bridge.ts`

- [ ] **Step 1: Add the wrappers**

In `src/utils/bridge.ts`, add (these call MAIN-APP commands — no `plugin:native-bridge|` prefix — like `download_file`):

```typescript
import { Channel } from '@tauri-apps/api/core';

export async function verifyUpdateSignature(
  path: string,
  signature: string,
  pubKey: string,
): Promise<boolean> {
  return invoke<boolean>('verify_update_signature', { path, signature, pubKey });
}

export interface NightlyProgress {
  event: 'started' | 'progress' | 'finished';
  downloaded: number;
  contentLength: number;
}

export async function installNightlyUpdate(
  endpoint: string,
  onProgress?: (p: NightlyProgress) => void,
): Promise<void> {
  const channel = new Channel<NightlyProgress>();
  if (onProgress) channel.onmessage = onProgress;
  await invoke<void>('install_nightly_update', { endpoint, channel });
}
```

(`invoke` is already imported at the top of `bridge.ts`. Confirm `Channel` import path — `@tauri-apps/api/core` — matches the version used elsewhere, e.g. `src/utils/transfer.ts`.)

- [ ] **Step 2: Type-check**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/bridge.ts
git commit -m "feat(updater): JS bridge wrappers for verify + install nightly"
```

---

### Task D4: UpdaterWindow nightly routing + UI states

**Files:**
- Modify: `src/components/UpdaterWindow.tsx`

This task wires the resolved winner through the window, routes install per platform, adds the signature-verify gate to the custom flows, and improves UI states.

- [ ] **Step 1: Extend the event payload + signature**

In `src/components/UpdaterWindow.tsx`, change `setUpdaterWindowVisible` to accept the resolved update and forward it:

```typescript
import type { ResolvedNightlyUpdate } from '@/helpers/updater';
import { verifyUpdateSignature, installNightlyUpdate, installPackage } from '@/utils/bridge';
import { READEST_UPDATER_PUBKEY } from '@/services/constants';

export const setUpdaterWindowVisible = (
  visible: boolean,
  latestVersion: string,
  lastVersion?: string,
  checkUpdate = true,
  nightlyUpdate?: ResolvedNightlyUpdate,
) => {
  const dialog = document.getElementById('updater_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible, latestVersion, lastVersion, checkUpdate, nightlyUpdate },
    });
    dialog.dispatchEvent(event);
  }
};
```

Thread `nightlyUpdate` through the `UpdaterWindow` component's event handler and pass it into `UpdaterContent` as a prop (mirror the existing `latestVersion`/`lastVersion` wiring in the `handleCustomEvent` / `useState` / JSX at lines 568-617).

- [ ] **Step 2: Build the nightly `GenericUpdate` when a resolved winner is present**

In `UpdaterContent`, add a `nightlyUpdate?: ResolvedNightlyUpdate` prop and a helper. The platform keys that Tauri's updater installs (macOS, Windows-NSIS) route to `installNightlyUpdate`; the rest verify + use the existing custom install. Add this builder and call it from the `checkForUpdates` effect when `nightlyUpdate` is set:

```typescript
const TAURI_UPDATER_KEYS = new Set([
  'darwin-aarch64',
  'darwin-x86_64',
  'windows-x86_64',
  'windows-aarch64',
  'linux-x86_64',
  'linux-aarch64',
]);

const buildNightlyUpdate = (n: ResolvedNightlyUpdate): GenericUpdate => ({
  currentVersion,
  version: n.version,
  date: n.pubDate,
  body: n.notes,
  downloadAndInstall: async (onEvent) => {
    if (TAURI_UPDATER_KEYS.has(n.platformKey)) {
      // macOS / Windows-NSIS: Tauri updater (verify + install + relaunch).
      let total = 0;
      await installNightlyUpdate(n.endpoint, (p) => {
        if (p.event === 'progress') {
          if (!total && p.contentLength) {
            total = p.contentLength;
            onEvent?.({ event: 'Started', data: { contentLength: total } });
          }
          onEvent?.({ event: 'Progress', data: { chunkLength: p.downloaded } });
        } else if (p.event === 'finished') {
          onEvent?.({ event: 'Finished' });
        }
      });
      return;
    }
    // Windows-portable / Linux-AppImage / Android: download, verify, install.
    const fileName = n.url.split('/').pop() || `Readest_${n.version}`;
    const filePath = await appService!.resolveFilePath(fileName, 'Cache');
    await downloadWithProgress(n.url, filePath, onEvent);
    const ok = await verifyUpdateSignature(filePath, n.signature, READEST_UPDATER_PUBKEY);
    if (!ok) {
      console.error('Nightly signature verification failed; aborting install');
      throw new Error('Signature verification failed');
    }
    if (n.platformKey.startsWith('android')) {
      const res = await installPackage({ path: filePath });
      if (!res.success) console.error('Failed to install APK:', res.error);
    } else if (n.platformKey.includes('appimage')) {
      const chmod = Command.create('chmod-appimage', ['+x', filePath]);
      await chmod.execute();
      const launch = Command.create('launch-appimage', [filePath]);
      await launch.spawn();
      setTimeout(async () => { await exit(0); }, 500);
    } else {
      // windows portable
      const command = Command.create('start-readest', ['/C', 'start', '', filePath]);
      await command.spawn();
      setTimeout(async () => { await exit(0); }, 500);
    }
  },
});
```

Note: `downloadWithProgress` already exists in this file (lines 174-208). `resolveFilePath`, `Command`, `exit`, `installPackage` are already imported/used. For Windows-portable the existing code writes into the executable dir (lines 220-222); reuse that exact path logic if the portable updater requires replacing the running exe in place rather than Cache.

- [ ] **Step 3: Route the effect**

In the `checkForUpdates` effect (lines 286-300), add a nightly branch at the top:

```typescript
    const checkForUpdates = async () => {
      if (nightlyUpdate) {
        setUpdate(buildNightlyUpdate(nightlyUpdate));
        return;
      }
      const OS_TYPE = osType();
      // ...existing stable routing unchanged...
    };
```

- [ ] **Step 4: Friendly nightly version + error state**

Where the dialog renders the version (lines 440-444, the "Readest {{newVersion}} is available" copy), render a nightly stamp in a human form. Add a helper and use it for `newVersion` display:

```typescript
const formatVersionLabel = (v: string): string => {
  const m = v.match(/^(\d+\.\d+\.\d+)-(\d{4})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return v;
  const [, base, y, mo, d, h] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return `Nightly · ${base} (${date.toLocaleDateString()}, ${h}:00)`;
};
```

Use `formatVersionLabel(newVersion)` in the displayed strings (keep the raw value for `semver`/logic). Also add a simple error state: when `checkUpdate` is true, `nightlyUpdate` is undefined, and a fetch failed, show `_('Failed to check for updates')` instead of leaving the dialog blank (set an `error` state in the relevant effect and render it in place of the skeleton).

- [ ] **Step 5: Verify + lint**

Run: `pnpm lint && pnpm test src/__tests__/helpers/updater.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/UpdaterWindow.tsx
git commit -m "feat(updater): nightly install routing, verify gate, UI states"
```

---

## Phase E — CI

### Task E1: `.github/workflows/nightly.yml`

**Files:**
- Create: `.github/workflows/nightly.yml` (repo root, NOT under apps/)

- [ ] **Step 1: Create the workflow**

This mirrors `release.yml`'s build matrix but (1) stamps a nightly version, (2) patches `package.json` AFTER the Android `git checkout .`, (3) publishes to R2 only via per-platform fragments + a final assemble job. Create `.github/workflows/nightly.yml`:

```yaml
# Nightly builds. Mirrors the build matrix of release.yml (keep cert/NDK/toolchain
# bumps in sync between the two). Publishes to R2 only — no GitHub release.
name: Nightly Readest

on:
  schedule:
    - cron: '0 22 * * *' # 22:00 UTC = 06:00 GMT+8
  workflow_dispatch:

permissions:
  contents: read

jobs:
  compute-version:
    runs-on: ubuntu-latest
    outputs:
      nightly_version: ${{ steps.v.outputs.nightly_version }}
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          ref: main
      - id: v
        run: |
          BASE=$(node -p "require('./apps/readest-app/package.json').version")
          STAMP=$(TZ=Asia/Shanghai date +%Y%m%d%H)
          echo "nightly_version=${BASE}-${STAMP}" >> "$GITHUB_OUTPUT"

  build:
    needs: compute-version
    strategy:
      fail-fast: false
      matrix:
        config:
          - { os: ubuntu-latest, release: android, rust_target: 'aarch64-linux-android,armv7-linux-androideabi,i686-linux-android,x86_64-linux-android' }
          - { os: ubuntu-22.04, release: linux, arch: x86_64, rust_target: x86_64-unknown-linux-gnu }
          - { os: ubuntu-22.04-arm, release: linux, arch: aarch64, rust_target: aarch64-unknown-linux-gnu }
          - { os: macos-latest, release: macos, arch: aarch64, rust_target: 'x86_64-apple-darwin,aarch64-apple-darwin', args: '--target universal-apple-darwin' }
          - { os: windows-latest, release: windows, arch: x86_64, rust_target: x86_64-pc-windows-msvc, args: '--target x86_64-pc-windows-msvc --bundles nsis' }
          - { os: windows-latest, release: windows, arch: aarch64, rust_target: aarch64-pc-windows-msvc, args: '--target aarch64-pc-windows-msvc --bundles nsis' }
    runs-on: ${{ matrix.config.os }}
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          ref: main

      - name: initialize git submodules
        run: git submodule update --init --recursive

      - name: setup pnpm
        uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6
      - name: setup node
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6
        with:
          node-version: 24
          cache: pnpm

      - name: setup Java (android)
        if: matrix.config.release == 'android'
        uses: actions/setup-java@be666c2fcd27ec809703dec50e508c2fdc7f6654 # v5
        with: { distribution: 'zulu', java-version: '17' }
      - name: setup Android SDK (android)
        if: matrix.config.release == 'android'
        uses: android-actions/setup-android@40fd30fb8d7440372e1316f5d1809ec01dcd3699 # v4
      - name: install NDK (android)
        if: matrix.config.release == 'android'
        run: sdkmanager "ndk;28.2.13676358"

      - name: install dependencies
        run: pnpm install --frozen-lockfile --prefer-offline
      - name: setup vendors
        run: pnpm --filter @readest/readest-app setup-vendors

      - name: install Rust stable
        uses: dtolnay/rust-toolchain@29eef336d9b2848a0b548edc03f92a220660cdb8 # stable
        with: { targets: '${{ matrix.config.rust_target }}' }
      - uses: Swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32 # v2
        with: { key: 'nightly-${{ matrix.config.os }}-${{ matrix.config.release }}-${{ matrix.config.arch }}' }

      - name: install ubuntu deps
        if: contains(matrix.config.os, 'ubuntu') && matrix.config.release != 'android'
        run: |
          sudo apt-get update
          sudo apt-get install -y pkg-config libfontconfig-dev libgtk-3-dev libwebkit2gtk-4.1 libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1 libjavascriptcoregtk-4.1-dev gir1.2-javascriptcoregtk-4.1 gir1.2-webkit2-4.1 libappindicator3-dev librsvg2-dev patchelf xdg-utils

      - name: create .env.local
        run: |
          echo "NEXT_PUBLIC_POSTHOG_KEY=${{ secrets.NEXT_PUBLIC_POSTHOG_KEY }}" >> .env.local
          echo "NEXT_PUBLIC_POSTHOG_HOST=${{ secrets.NEXT_PUBLIC_POSTHOG_HOST }}" >> .env.local
          echo "NEXT_PUBLIC_SUPABASE_URL=${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}" >> .env.local
          echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}" >> .env.local
          echo "NEXT_PUBLIC_APP_PLATFORM=tauri" >> .env.local
          cp .env.local apps/readest-app/.env.local

      - name: install rclone
        run: |
          sudo apt-get update && sudo apt-get install -y rclone || choco install rclone -y || brew install rclone
        shell: bash
      - name: configure rclone
        shell: bash
        run: |
          mkdir -p ~/.config/rclone
          cat > ~/.config/rclone/rclone.conf <<EOF
          [r2]
          type = s3
          provider = Cloudflare
          access_key_id = ${{ secrets.RELEASE_R2_ACCESS_KEY_ID }}
          secret_access_key = ${{ secrets.RELEASE_R2_SECRET_ACCESS_KEY }}
          endpoint = https://${{ secrets.RELEASE_R2_ACCOUNT_ID }}.r2.cloudflarestorage.com
          EOF

      # ANDROID: patch version AFTER `git checkout .` (the android init reverts tracked files)
      - name: build android
        if: matrix.config.release == 'android'
        shell: bash
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NDK_HOME: ${{ env.ANDROID_HOME }}/ndk/28.2.13676358
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          version="${{ needs.compute-version.outputs.nightly_version }}"
          cd apps/readest-app/
          rm -rf src-tauri/gen/android
          pnpm tauri android init
          pnpm tauri icon ../../data/icons/readest-book.png
          git checkout .
          # Patch AFTER checkout so the version stamp survives.
          node -e "const f='package.json';const j=require('./'+f);j.version='${version}';require('fs').writeFileSync(f, JSON.stringify(j,null,2)+'\n')"
          pushd src-tauri/gen/android
          echo "keyAlias=${{ secrets.ANDROID_KEY_ALIAS }}" > keystore.properties
          echo "password=${{ secrets.ANDROID_KEY_PASSWORD }}" >> keystore.properties
          base64 -d <<< "${{ secrets.ANDROID_KEY_BASE64 }}" > $RUNNER_TEMP/keystore.jks
          echo "storeFile=$RUNNER_TEMP/keystore.jks" >> keystore.properties
          popd
          apk_path=src-tauri/gen/android/app/build/outputs/apk/universal/release
          pnpm tauri android build
          cp ${apk_path}/app-universal-release.apk Readest_${version}_universal.apk
          pnpm tauri android build -t aarch64
          cp ${apk_path}/app-universal-release.apk Readest_${version}_arm64.apk
          pnpm tauri signer sign Readest_${version}_universal.apk
          pnpm tauri signer sign Readest_${version}_arm64.apk

      - name: build desktop
        if: matrix.config.release != 'android'
        shell: bash
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          NODE_OPTIONS: '--max-old-space-size=8192'
        run: |
          version="${{ needs.compute-version.outputs.nightly_version }}"
          node -e "const f='apps/readest-app/package.json';const j=require('./'+f);j.version='${version}';require('fs').writeFileSync(f, JSON.stringify(j,null,2)+'\n')"
          cd apps/readest-app
          pnpm tauri build ${{ matrix.config.args }}

      - name: upload artifacts + fragment to R2
        shell: bash
        run: |
          version="${{ needs.compute-version.outputs.nightly_version }}"
          base="r2:readest-releases/nightly/${version}"
          dest="./nightly-out"; mkdir -p "$dest/frag"
          # Collect this leg's artifacts (.apk/.dmg/.app.tar.gz/.AppImage/nsis + .sig)
          # into $dest, then build a JSON fragment of {platforms{key:{url,signature}}}
          # for the keys this leg produced. (Implementer: glob the produced bundle
          # paths under apps/readest-app/src-tauri/target/**/bundle/ and the android
          # apks; compute the download.readest.com URLs as
          # https://download.readest.com/nightly/${version}/<filename>.)
          # ... assemble $dest/frag/${{ matrix.config.release }}-${{ matrix.config.arch }}.json ...
          rclone copy "$dest" "$base/" --exclude "frag/**"
          rclone copy "$dest/frag" "$base/manifest-fragments/"

  assemble-manifest:
    needs: [compute-version, build]
    if: ${{ always() && needs.build.result != 'cancelled' }}
    runs-on: ubuntu-latest
    steps:
      - name: install rclone
        run: sudo apt-get update && sudo apt-get install -y rclone jq
      - name: configure rclone
        run: |
          mkdir -p ~/.config/rclone
          cat > ~/.config/rclone/rclone.conf <<EOF
          [r2]
          type = s3
          provider = Cloudflare
          access_key_id = ${{ secrets.RELEASE_R2_ACCESS_KEY_ID }}
          secret_access_key = ${{ secrets.RELEASE_R2_SECRET_ACCESS_KEY }}
          endpoint = https://${{ secrets.RELEASE_R2_ACCOUNT_ID }}.r2.cloudflarestorage.com
          EOF
      - name: assemble + atomically promote latest.json
        run: |
          version="${{ needs.compute-version.outputs.nightly_version }}"
          base="r2:readest-releases/nightly"
          rclone copy "$base/${version}/manifest-fragments" ./frag || true
          if [ -z "$(ls -A ./frag 2>/dev/null)" ]; then
            echo "::error::no manifest fragments — all build legs failed"; exit 1
          fi
          # Merge fragment .platforms into one manifest from the SUCCEEDED legs.
          jq -s "{version: \"${version}\", pub_date: (now | todate), notes: \"Nightly build\", platforms: (map(.platforms) | add)}" ./frag/*.json > latest.json
          # Atomic promote: upload to a temp key, then server-side move.
          rclone copyto latest.json "$base/latest.json.tmp"
          rclone moveto "$base/latest.json.tmp" "$base/latest.json"
      - name: prune old nightly folders (keep newest 7)
        run: |
          base="r2:readest-releases/nightly"
          mapfile -t dirs < <(rclone lsf "$base/" --dirs-only | sed 's:/$::' | sort)
          count=${#dirs[@]}
          if [ "$count" -gt 7 ]; then
            for d in "${dirs[@]:0:$((count-7))}"; do
              echo "pruning $d"; rclone purge "$base/$d"
            done
          fi
      - name: notify on failure
        if: failure()
        run: echo "::error::Nightly assemble failed — manifest not promoted."
```

Note: the per-leg "collect artifacts + build fragment" shell is intentionally sketched — during implementation, glob the exact bundle output paths (`apps/readest-app/src-tauri/target/${rust_target}/release/bundle/...` for macnsis/appimage, `target/.../*.app.tar.gz` for the macOS updater bundle) and the Android `.apk`/`.sig`, then emit a fragment JSON keyed by the Tauri platform keys (`darwin-aarch64`, `windows-x86_64`, `linux-x86_64-appimage`, `android-arm64`, …) whose `signature` is the `.sig` contents and `url` is `https://download.readest.com/nightly/${version}/<filename>`. Cross-check the produced filenames against `release.yml` and `UpdaterWindow.tsx`'s expected keys.

- [ ] **Step 2: Validate workflow syntax**

Run: `node -e "require('js-yaml')" 2>/dev/null && npx --yes js-yaml .github/workflows/nightly.yml >/dev/null && echo OK || echo "validate YAML manually"`
Expected: OK (or validate via the GitHub Actions UI / `act`).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/nightly.yml
git commit -m "ci: nightly build workflow (R2-only, fragment-assembled manifest)"
```

- [ ] **Step 4: Dry-run via workflow_dispatch**

After merge, trigger the workflow manually (Actions → Nightly Readest → Run workflow on `main`) and confirm: a `nightly/<version>/` folder + `nightly/latest.json` appear in R2 with all platform keys, and that on a same-base day the in-app nightly check offers the build. (This is a post-merge validation, not a local step.)

---

## Phase F — Final verification

- [ ] **Step 1: Full unit suite**

Run: `pnpm test`
Expected: PASS (including the new `version.test.ts` and updated `updater.test.ts`).

- [ ] **Step 2: Lint + types**

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 3: Rust checks**

Run: `pnpm fmt:check && pnpm clippy:check && pnpm test:rust`
Expected: PASS (including `nightly_update::tests::matrix`).

- [ ] **Step 4: Manual smoke (desktop dev)**

Run: `pnpm tauri dev`, enable Settings → "Nightly Builds (Unstable)", trigger a manual check. With no nightly manifest published yet, confirm it reports up-to-date / handles the fetch gracefully (no blank dialog). Full end-to-end install is validated post-merge via the workflow dry-run (Task E1 Step 4).

---

## Self-review notes

- **Spec coverage:** comparator (A1/A2), setting + toggle (B1/B2), isolated dual-manifest check with filter-then-compare (C1/C2), single-source decision passed to the window (C2/D4), sig verification everywhere — Tauri-built-in for mac/NSIS + minisign command for portable/AppImage/Android (D1/D2/D4), macOS `.app.tar.gz` auto-replace via Tauri updater (D2/D4), CI R2-only with version-patch-after-checkout + fragment assembly + atomic promote + prune + failure alert (E1), friendly version + error UI states (D4). Android versionCode left Tauri-derived per the owner's correction (no task needed).
- **Known verification points** (flagged inline, not placeholders): the `tauri-plugin-updater` 2.10.1 `UpdaterBuilder`/`download_and_install` signatures (D2), the `updater.pubkey` base64 decode shape for minisign (D1), the exact portable-build global (`__READEST_IS_PORTABLE`) in C2, and the per-leg artifact glob/fragment shell in E1.
