/**
 * Pluggable dictionary provider model.
 *
 * Built-in providers (Wiktionary, Wikipedia) and importable providers
 * (StarDict, MDict) all implement {@link DictionaryProvider}. The
 * {@link DictionaryPopup} renders one tab per enabled provider in user-defined
 * order; each provider writes lookup output into a per-tab container.
 */

export type DictionaryProviderKind = 'builtin' | 'stardict' | 'mdict';

export interface DictionaryLookupContext {
  /** Source language hint, e.g. book primary language code (`en`, `zh`). */
  lang?: string;
  /** Cancel signal for in-flight network/IO. */
  signal: AbortSignal;
  /** Tab pane to render into. Provider populates this; never touch `document` selectors. */
  container: HTMLElement;
  /**
   * Called when the provider intercepts an in-popup link click and wants the
   * shell to navigate (push to per-tab history). Optional — providers without
   * cross-link navigation can ignore it.
   */
  onNavigate?(word: string): void;
}

export type DictionaryLookupOutcome =
  | { ok: true; headword?: string; sourceLabel?: string }
  | { ok: false; reason: 'empty' | 'unsupported' | 'error'; message?: string };

export interface DictionaryProvider {
  /** Stable id, e.g. `builtin:wiktionary`, `stardict:abc123`, `mdict:xyz`. */
  id: string;
  kind: DictionaryProviderKind;
  /** Localized label shown in the tab strip. */
  label: string;
  /** Optional eager init (parse index/keylist). Called once on first activation. */
  init?(): Promise<void>;
  /** Look up a word; populate `ctx.container`; return outcome. */
  lookup(word: string, ctx: DictionaryLookupContext): Promise<DictionaryLookupOutcome>;
  /** Release object URLs / caches. Called when the provider is removed or replaced. */
  dispose?(): void;
}

/**
 * Persisted metadata for an imported dictionary. The binary files live on disk
 * under {@link BaseDir} `'Dictionaries'`/<id>/; only this metadata syncs.
 */
export interface ImportedDictionary {
  id: string;
  kind: 'stardict' | 'mdict';
  /** Display name, derived from `.ifo` `bookname` or `.mdx` header `Title`. */
  name: string;
  /** Subdirectory under `'Dictionaries'` containing this bundle's files. */
  bundleDir: string;
  /** Filenames inside `bundleDir`. The exact set varies by `kind`. */
  files: {
    ifo?: string;
    idx?: string;
    dict?: string;
    syn?: string;
    /**
     * Pre-computed offsets sidecar for `.idx`. Generated at import time;
     * lets `StarDictReader.load` skip the full `.idx` scan. Optional —
     * existing imports without it fall back to the in-init scan path.
     */
    idxOffsets?: string;
    /** Same idea for `.syn`. */
    synOffsets?: string;
    mdx?: string;
    mdd?: string[];
  };
  /** Source language code if known. */
  lang?: string;
  /** Wall-clock time of import (ms since epoch). */
  addedAt: number;
  /** Soft-delete marker; `undefined` while available. */
  deletedAt?: number;
  /**
   * True when metadata is present (e.g. synced from another device) but the
   * binary bundle is missing on this device. The settings UI surfaces a
   * "Re-import" affordance; the popup hides the provider.
   */
  unavailable?: boolean;
  /**
   * True when the bundle imports cleanly but the dictionary format is outside
   * v1 scope (e.g. multi-type StarDict, raw `.dict` instead of `.dict.dz`,
   * encrypted MDX). Provider returns `{ ok: false, reason: 'unsupported' }`.
   */
  unsupported?: boolean;
  /** Human-readable reason when `unsupported` is true. */
  unsupportedReason?: string;
}

export interface DictionarySettings {
  /** Provider id order shown in the popup tab strip. Includes builtin ids. */
  providerOrder: string[];
  /** Per-id enable flag. Builtins seeded `true`. */
  providerEnabled: Record<string, boolean>;
  /** Last-used tab id; `undefined` falls back to first enabled provider. */
  defaultProviderId?: string;
}

/** Stable ids for the built-in providers. */
export const BUILTIN_PROVIDER_IDS = {
  wiktionary: 'builtin:wiktionary',
  wikipedia: 'builtin:wikipedia',
} as const;

export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[keyof typeof BUILTIN_PROVIDER_IDS];
