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
