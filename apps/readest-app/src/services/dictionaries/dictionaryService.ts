/**
 * Dictionary import / delete service.
 *
 * Takes a flat list of files chosen via `useFileSelector('dictionaries')`,
 * groups them into StarDict / MDict bundles by filename stem, writes each
 * bundle's files into `'Dictionaries'/<id>/`, and returns metadata records
 * for the {@link customDictionaryStore}.
 *
 * Mirrors the structure of `src/services/fontService.ts` but handles
 * multi-file bundles instead of single-file fonts.
 */
import type { FileSystem } from '@/types/system';
import type { SelectedFile } from '@/hooks/useFileSelector';
import { uniqueId } from '@/utils/misc';
import { getFilename } from '@/utils/path';
import type { ImportedDictionary } from './types';
import { scanEntryOffsets, serializeOffsetsSidecar } from './stardictReader';

/** GZIP magic bytes — used to detect DictZip-compressed `.dict` files. */
const GZIP_MAGIC = [0x1f, 0x8b, 0x08];

interface SourceFile {
  /** Filename including extension, e.g. `oald7.idx`. */
  name: string;
  /** Stem (lowercase, without final extension). For `.dict.dz` use the stem of `.dict`. */
  stem: string;
  /** Final extension (lowercase, no dot). For `oald7.dict.dz`, this is `dz`. */
  ext: string;
  /** True when ext is `dz` AND the next-to-last segment is `dict`. */
  isDictZip: boolean;
  /** Raw input — Tauri path or browser File. */
  source: SelectedFile;
}

interface StarDictGroup {
  kind: 'stardict';
  stem: string;
  ifo: SourceFile;
  idx: SourceFile;
  dict: SourceFile;
  syn?: SourceFile;
}

interface MDictGroup {
  kind: 'mdict';
  stem: string;
  mdx: SourceFile;
  mdd: SourceFile[];
  /**
   * Loose `.css` files sharing the bundle stem (e.g. `mydict.mdx` +
   * `mydict.css`). Optional. Applied at lookup time as scoped stylesheets
   * inside the card's shadow root.
   */
  css: SourceFile[];
}

interface DictGroup {
  kind: 'dict';
  stem: string;
  index: SourceFile;
  dict: SourceFile;
}

interface SlobGroup {
  kind: 'slob';
  stem: string;
  slob: SourceFile;
}

type Bundle = StarDictGroup | MDictGroup | DictGroup | SlobGroup;

interface GroupResult {
  bundles: Bundle[];
  /** Files that didn't form a complete bundle (e.g. `.idx` without matching `.ifo`). */
  orphans: SourceFile[];
}

/** Read the source file as a `File` (web) or via the path (Tauri filesystem). */
async function readSource(fs: FileSystem, source: SelectedFile): Promise<File> {
  if (source.file) return source.file;
  if (source.path) {
    // Open from absolute filesystem path. `'None'` keeps the path as-is.
    return fs.openFile(source.path, 'None');
  }
  throw new Error('SelectedFile has neither path nor file');
}

function classify(source: SelectedFile): SourceFile {
  const rawName = source.file?.name ?? (source.path ? getFilename(source.path) : '');
  const name = rawName;
  const lower = name.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  const ext = lastDot >= 0 ? lower.slice(lastDot + 1) : '';
  // Detect `foo.dict.dz` — final ext is `dz`, but the bundle stem is `foo`.
  const beforeLast = lastDot >= 0 ? lower.slice(0, lastDot) : lower;
  const isDictZip = ext === 'dz' && beforeLast.endsWith('.dict');
  let stem: string;
  if (isDictZip) {
    // `foo.dict.dz` → stem `foo`
    stem = beforeLast.slice(0, -'.dict'.length);
  } else if (lastDot >= 0) {
    // `foo.idx` → stem `foo`
    stem = beforeLast;
  } else {
    stem = lower;
  }
  return { name, stem, ext, isDictZip, source };
}

/**
 * Group a flat list of selected files into StarDict and MDict bundles by
 * stem. Files that don't belong to any complete bundle land in `orphans`.
 *
 * Rules:
 *  - StarDict bundle = exactly one `.ifo` + one `.idx` + one `.dict` or
 *    `.dict.dz` (sharing a stem). `.syn` is optional.
 *  - MDict bundle = one `.mdx` + zero or more `.mdd` (sharing a stem).
 *  - DICT (dictd) bundle = one `.index` + one `.dict` or `.dict.dz`
 *    (sharing a stem). Note: `.idx` (StarDict) and `.index` (DICT) differ
 *    only by spelling — the StarDict branch wins when both are present.
 *  - Slob bundle = one `.slob` file.
 *  - A stem with multiple format markers is treated as multiple bundles.
 */
export function groupBundlesByStem(files: SelectedFile[]): GroupResult {
  const classified = files.map(classify);
  // `.css` files don't have to share a stem with the `.mdx` (e.g. an MDX
  // entry may reference `mwa.css` while the dictionary is `MW11sound.mdx`).
  // Pool them globally and attach to every MDict bundle in this import.
  const cssFiles = classified.filter((f) => f.ext === 'css');
  const byStem = new Map<string, SourceFile[]>();
  for (const f of classified) {
    if (f.ext === 'css') continue;
    if (!byStem.has(f.stem)) byStem.set(f.stem, []);
    byStem.get(f.stem)!.push(f);
  }

  const bundles: Bundle[] = [];
  const orphans: SourceFile[] = [];
  for (const [stem, group] of byStem) {
    const ifo = group.find((f) => f.ext === 'ifo');
    const idx = group.find((f) => f.ext === 'idx');
    const indexFile = group.find((f) => f.ext === 'index');
    const dict = group.find((f) => f.ext === 'dict' || f.isDictZip);
    const syn = group.find((f) => f.ext === 'syn');
    const mdx = group.find((f) => f.ext === 'mdx');
    const mdd = group.filter((f) => f.ext === 'mdd');
    const slob = group.find((f) => f.ext === 'slob');

    if (ifo && idx && dict) {
      bundles.push({ kind: 'stardict', stem, ifo, idx, dict, syn });
    } else if (indexFile && dict) {
      bundles.push({ kind: 'dict', stem, index: indexFile, dict });
    } else if (mdx) {
      // `css` is filled in below once we know which MDict bundles exist.
      bundles.push({ kind: 'mdict', stem, mdx, mdd, css: [] });
    } else if (slob) {
      bundles.push({ kind: 'slob', stem, slob });
    } else {
      orphans.push(...group);
    }
  }

  // Distribute all loose `.css` files across the MDict bundles in this
  // import. With one dictionary at a time (the common case) every selected
  // `.css` ends up applied; with multiple, each gets the full set — benign
  // because the per-card shadow root scopes the styles anyway.
  const mdictBundles = bundles.filter((b): b is MDictGroup => b.kind === 'mdict');
  if (mdictBundles.length > 0) {
    for (const b of mdictBundles) b.css = cssFiles;
  } else {
    orphans.push(...cssFiles);
  }

  return { bundles, orphans };
}

/** Parse a StarDict `.ifo` (key=value, one per line) into a record. */
function parseIfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Detect the GZIP magic at the start of a Blob. */
async function isGzip(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  return head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1] && head[2] === GZIP_MAGIC[2];
}

async function writeBundleFile(
  fs: FileSystem,
  bundleDir: string,
  filename: string,
  source: File,
): Promise<void> {
  const dst = `${bundleDir}/${filename}`;
  await fs.writeFile(dst, 'Dictionaries', source);
}

/** Build a fresh bundle directory `'Dictionaries'/<id>/`. */
async function createBundleDir(fs: FileSystem): Promise<string> {
  const id = uniqueId();
  await fs.createDir(id, 'Dictionaries', true);
  return id;
}

async function importStarDictBundle(
  fs: FileSystem,
  group: StarDictGroup,
): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const ifoFile = await readSource(fs, group.ifo.source);
  const idxFile = await readSource(fs, group.idx.source);
  const dictFile = await readSource(fs, group.dict.source);
  const synFile = group.syn ? await readSource(fs, group.syn.source) : undefined;

  await writeBundleFile(fs, bundleDir, group.ifo.name, ifoFile);
  await writeBundleFile(fs, bundleDir, group.idx.name, idxFile);
  await writeBundleFile(fs, bundleDir, group.dict.name, dictFile);
  if (synFile && group.syn) {
    await writeBundleFile(fs, bundleDir, group.syn.name, synFile);
  }

  // Pre-compute offsets sidecars at import time. Subsequent provider inits
  // skip the full `.idx` (and `.syn`) scan — the only reads are the small
  // sidecar plus per-lookup probes. Net effect on cmudict-class bundles:
  // ~62% init IO reduction.
  const idxOffsetsName = `${group.idx.stem}.idx.offsets`;
  {
    const idxBytes = new Uint8Array(await idxFile.arrayBuffer());
    const offsets = scanEntryOffsets(idxBytes, /* payloadBytes */ 8);
    const sidecar = serializeOffsetsSidecar(offsets);
    // Wrap as a File so writeFile's `string | ArrayBuffer | File` signature
    // accepts it without an unsafe ArrayBuffer cast (Uint8Array.buffer is
    // typed `ArrayBufferLike` in TS strict mode).
    const sidecarFile = new File([new Uint8Array(sidecar)], idxOffsetsName);
    await fs.writeFile(`${bundleDir}/${idxOffsetsName}`, 'Dictionaries', sidecarFile);
  }
  let synOffsetsName: string | undefined;
  if (synFile && group.syn) {
    synOffsetsName = `${group.syn.stem}.syn.offsets`;
    const synBytes = new Uint8Array(await synFile.arrayBuffer());
    const offsets = scanEntryOffsets(synBytes, /* payloadBytes */ 4);
    const sidecar = serializeOffsetsSidecar(offsets);
    const sidecarFile = new File([new Uint8Array(sidecar)], synOffsetsName);
    await fs.writeFile(`${bundleDir}/${synOffsetsName}`, 'Dictionaries', sidecarFile);
  }

  const ifoText = await ifoFile.text();
  const ifo = parseIfo(ifoText);
  const name = ifo['bookname'] || group.stem;
  const lang = ifo['lang'] || ifo['idxoffsetlang'] || undefined;

  // v1 scope: only DictZip-compressed `.dict.dz` and single-type sametypesequence ∈ {m, h, x, t}.
  // Bundles outside this surface as `unsupported` so the popup hides them
  // and the settings UI shows a clear reason; the import itself still succeeds.
  let unsupported = false;
  let unsupportedReason: string | undefined;
  if (!(await isGzip(dictFile))) {
    unsupported = true;
    unsupportedReason = 'Raw .dict files are not supported in v1; please use .dict.dz format.';
  } else {
    const seq = ifo['sametypesequence'];
    if (!seq || seq.length !== 1) {
      unsupported = true;
      unsupportedReason = seq
        ? `Multi-type sametypesequence "${seq}" is not supported in v1.`
        : 'StarDict bundles without sametypesequence are not supported in v1.';
    } else if (!'mhxt'.includes(seq)) {
      unsupported = true;
      unsupportedReason = `StarDict entry type "${seq}" is not supported in v1.`;
    }
  }

  return {
    id: bundleDir,
    kind: 'stardict',
    name,
    bundleDir,
    files: {
      ifo: group.ifo.name,
      idx: group.idx.name,
      dict: group.dict.name,
      syn: group.syn?.name,
      idxOffsets: idxOffsetsName,
      synOffsets: synOffsetsName,
    },
    lang,
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

async function importMdictBundle(fs: FileSystem, group: MDictGroup): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const mdxFile = await readSource(fs, group.mdx.source);
  const mddFiles = await Promise.all(group.mdd.map((m) => readSource(fs, m.source)));
  const cssFiles = await Promise.all(group.css.map((c) => readSource(fs, c.source)));

  await writeBundleFile(fs, bundleDir, group.mdx.name, mdxFile);
  for (let i = 0; i < group.mdd.length; i++) {
    await writeBundleFile(fs, bundleDir, group.mdd[i]!.name, mddFiles[i]!);
  }
  for (let i = 0; i < group.css.length; i++) {
    await writeBundleFile(fs, bundleDir, group.css[i]!.name, cssFiles[i]!);
  }

  // Parse the MDX header via the forked js-mdict (browser-friendly path).
  // Loaded lazily so users without MDict imports never pull in the parser.
  let name = group.stem;
  let lang: string | undefined;
  let unsupported = false;
  let unsupportedReason: string | undefined;
  try {
    const { MDX } = await import('js-mdict');
    const mdx = await MDX.create(mdxFile);
    const header = mdx.header as Record<string, unknown>;
    if (typeof header['Title'] === 'string' && (header['Title'] as string).trim()) {
      name = (header['Title'] as string).trim();
    }
    if (typeof header['Encoding'] === 'string') {
      lang = (header['Encoding'] as string).toLowerCase();
    }
    // `meta.encrypt` is a bitmap: 0x01 = record block encrypted (needs a
    // user-supplied passcode/regcode — js-mdict doesn't implement that path),
    // 0x02 = key info block encrypted (handled transparently via the
    // ripemd128-based `mdxDecrypt`, no passcode needed). Only bit 0 is
    // genuinely unsupported.
    if ((mdx.meta.encrypt & 1) !== 0) {
      unsupported = true;
      unsupportedReason =
        'This MDX is registered to a specific user (record-block encryption); passcode-protected dictionaries are not supported.';
    }
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    unsupported = true;
    if (/encrypted file|user identification/i.test(message)) {
      unsupportedReason =
        'This MDX is registered to a specific user (record-block encryption); passcode-protected dictionaries are not supported.';
    } else {
      unsupportedReason = `Failed to parse MDX header: ${message}`;
    }
  }

  return {
    id: bundleDir,
    kind: 'mdict',
    name,
    bundleDir,
    files: {
      mdx: group.mdx.name,
      mdd: group.mdd.map((m) => m.name),
      css: group.css.length ? group.css.map((c) => c.name) : undefined,
    },
    lang,
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

async function importDictBundle(fs: FileSystem, group: DictGroup): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const indexFile = await readSource(fs, group.index.source);
  const dictFile = await readSource(fs, group.dict.source);
  await writeBundleFile(fs, bundleDir, group.index.name, indexFile);
  await writeBundleFile(fs, bundleDir, group.dict.name, dictFile);

  // Try to read the `00databaseshort` body for a friendly bundle name. The
  // index lists it; the body lives in the dict. We do this best-effort: any
  // failure falls back to the stem.
  let name = group.stem;
  let unsupported = false;
  let unsupportedReason: string | undefined;
  try {
    const indexText = await indexFile.text();
    // Find the "00databaseshort\t<offset>\t<size>" line.
    const m = indexText.match(/^00databaseshort\t([^\t]+)\t([^\t\r\n]+)/m);
    if (m) {
      const decode = (s: string): number => {
        let n = 0;
        const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        for (const ch of s) {
          const v = A.indexOf(ch);
          if (v < 0) throw new Error('bad b64');
          n = n * 64 + v;
        }
        return n;
      };
      const off = decode(m[1]!);
      const size = decode(m[2]!);
      // Read the dict body. If gzipped we need the whole thing — but for
      // the friendly-name read, that's still cheap (the freedict bundles
      // are <300 KB compressed).
      const buf = await dictFile.arrayBuffer();
      const u8 = new Uint8Array(buf);
      let body: Uint8Array;
      if (u8[0] === 0x1f && u8[1] === 0x8b) {
        const { gunzipSync } = await import('fflate');
        body = gunzipSync(u8);
      } else {
        body = u8;
      }
      name = new TextDecoder('utf-8').decode(body.subarray(off, off + size)).trim() || group.stem;
    }
  } catch {
    // Best-effort label; the bundle is still importable.
  }
  if (!(await isGzip(dictFile))) {
    // Plain `.dict` is technically supported by the reader, but we keep
    // v1 scope identical to StarDict for consistency.
    unsupported = true;
    unsupportedReason = 'Raw .dict files are not supported in v1; please use .dict.dz format.';
  }

  return {
    id: bundleDir,
    kind: 'dict',
    name,
    bundleDir,
    files: {
      index: group.index.name,
      dict: group.dict.name,
    },
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

async function importSlobBundle(fs: FileSystem, group: SlobGroup): Promise<ImportedDictionary> {
  const bundleDir = await createBundleDir(fs);
  const slobFile = await readSource(fs, group.slob.source);
  await writeBundleFile(fs, bundleDir, group.slob.name, slobFile);

  // Read header bytes to derive the friendly name + sanity-check compression.
  let name = group.stem;
  let unsupported = false;
  let unsupportedReason: string | undefined;
  try {
    const { SlobReader } = await import('./slobReader');
    const reader = new SlobReader();
    await reader.load({ slob: slobFile });
    const labelTag = reader.header.tags['label'];
    if (labelTag) name = labelTag.replace(/\0+$/u, '') || group.stem;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    unsupported = true;
    if (/Unsupported Slob compression/i.test(message)) {
      unsupportedReason = message;
    } else if (/Unsupported Slob encoding/i.test(message)) {
      unsupportedReason = message;
    } else {
      unsupportedReason = `Failed to parse Slob header: ${message}`;
    }
  }

  return {
    id: bundleDir,
    kind: 'slob',
    name,
    bundleDir,
    files: { slob: group.slob.name },
    addedAt: Date.now(),
    unsupported: unsupported || undefined,
    unsupportedReason,
  };
}

export interface ImportDictionariesResult {
  imported: ImportedDictionary[];
  /**
   * Bundles whose name matched one or more existing dictionaries in the
   * user's library. The duplicate's old bundle dir has been removed from
   * disk; the caller still needs to update the store — drop `oldIds`,
   * insert `newDict` in the first old entry's `providerOrder` slot, and
   * inherit the first old entry's enabled flag.
   */
  replacements: { oldIds: string[]; newDict: ImportedDictionary }[];
  /** Filenames that didn't form a valid bundle. */
  orphanFiles: string[];
}

/**
 * Top-level import entry point. Groups the selected files into bundles and
 * imports each one. When a freshly-imported bundle's name matches an
 * existing (non-deleted) dictionary, the existing on-disk bundle dirs are
 * removed and the new dict is reported in `replacements` so the caller can
 * swap the store entry in place (preserving the position in
 * `providerOrder` and the enabled flag).
 */
export async function importDictionaries(
  fs: FileSystem,
  files: SelectedFile[],
  existingDictionaries: ImportedDictionary[] = [],
): Promise<ImportDictionariesResult> {
  const { bundles, orphans } = groupBundlesByStem(files);
  // Index existing entries by name. Multiple entries can share a name when
  // the user previously imported the same dict more than once — we replace
  // them all with the single new bundle.
  const existingByName = new Map<string, ImportedDictionary[]>();
  for (const d of existingDictionaries) {
    if (d.deletedAt) continue;
    const list = existingByName.get(d.name);
    if (list) list.push(d);
    else existingByName.set(d.name, [d]);
  }

  const imported: ImportedDictionary[] = [];
  const replacements: { oldIds: string[]; newDict: ImportedDictionary }[] = [];
  // Names already added during this single import call. A second bundle in
  // the same selection that shares a name with an earlier one is dropped
  // (the first wins) so we don't end up with intra-call duplicates.
  const seenNames = new Set<string>();

  for (const bundle of bundles) {
    let dict: ImportedDictionary;
    if (bundle.kind === 'stardict') {
      dict = await importStarDictBundle(fs, bundle);
    } else if (bundle.kind === 'mdict') {
      dict = await importMdictBundle(fs, bundle);
    } else if (bundle.kind === 'dict') {
      dict = await importDictBundle(fs, bundle);
    } else {
      dict = await importSlobBundle(fs, bundle);
    }

    if (seenNames.has(dict.name)) {
      try {
        await fs.removeDir(dict.bundleDir, 'Dictionaries', true);
      } catch (err) {
        console.warn('Failed to clean up duplicate bundle dir', dict.bundleDir, err);
      }
      continue;
    }
    seenNames.add(dict.name);

    const olds = existingByName.get(dict.name);
    if (olds && olds.length > 0) {
      for (const old of olds) {
        try {
          await fs.removeDir(old.bundleDir, 'Dictionaries', true);
        } catch (err) {
          console.warn('Failed to remove replaced bundle dir', old.bundleDir, err);
        }
      }
      replacements.push({ oldIds: olds.map((o) => o.id), newDict: dict });
    } else {
      imported.push(dict);
    }
  }

  return {
    imported,
    replacements,
    orphanFiles: orphans.map((o) => o.name),
  };
}

/** Remove a dictionary's bundle directory. The metadata is dropped by the caller. */
export async function deleteDictionary(fs: FileSystem, dict: ImportedDictionary): Promise<void> {
  if (await fs.exists(dict.bundleDir, 'Dictionaries')) {
    await fs.removeDir(dict.bundleDir, 'Dictionaries', true);
  }
}
