'use client';

/**
 * Runtime polyfills for JavaScript features that landed in WebKit later than
 * the oldest macOS this app still runs on. The production bundles call these
 * directly (bundled dependencies, not transpilable syntax): on WebKit 17.3
 * (macOS 14.3) and older the missing functions throw as soon as the relevant
 * chunk executes, crashing the app to a blank window at startup.
 *
 *   Promise.withResolvers, Object.groupBy, Map.groupBy,
 *   Set union/intersection/...  — Safari/WebKit 17.4 (macOS 14.4)
 *   Promise.try                 — Safari/WebKit 17.5 (macOS 14.5)
 *   Uint8Array fromBase64/toBase64/setFromBase64/toHex/fromHex,
 *   RegExp.escape               — Safari/WebKit 18.2 (macOS 15.2)
 *
 * Everything here is feature-detected, so on current browsers this module is
 * a no-op. It must be a client module (imported by the root layout as
 * <Polyfills />): a plain import from the server-component layout would only
 * ever run in Node and never reach the browser bundle.
 */

// Safari 17.4
const PromiseC = Promise as unknown as Record<string, unknown>;
if (typeof PromiseC['withResolvers'] !== 'function') {
  PromiseC['withResolvers'] = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Safari 17.5
if (typeof PromiseC['try'] !== 'function') {
  PromiseC['try'] = function tryPromise<T, A extends unknown[]>(
    handler: (...args: A) => T | PromiseLike<T>,
    ...args: A
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      resolve(handler(...args));
    });
  };
}

// Safari 17.4
const ObjectC = Object as unknown as Record<string, unknown>;
if (typeof ObjectC['groupBy'] !== 'function') {
  ObjectC['groupBy'] = function groupBy<T, K>(
    iterable: Iterable<T>,
    callback: (value: T, index: number) => K,
  ): Record<string, T[]> {
    const groups: Record<string, T[]> = Object.create(null);
    let index = 0;
    for (const value of iterable) {
      // `String(-0)` is already `"0"`, so no -0 normalization is needed here;
      // a `.replace('-0', '0')` would corrupt legitimate keys like "-0.5".
      const key = `${callback(value, index++) as unknown}`;
      const bucket = groups[key] as T[] | undefined;
      if (bucket) bucket.push(value);
      else groups[key] = [value];
    }
    return groups;
  };
}

// Safari 17.4
const MapC = Map as unknown as Record<string, unknown>;
if (typeof MapC['groupBy'] !== 'function') {
  MapC['groupBy'] = function groupBy<T, K>(
    iterable: Iterable<T>,
    callback: (value: T, index: number) => K,
  ): Map<K, T[]> {
    const groups = new Map<K, T[]>();
    let index = 0;
    for (const value of iterable) {
      const key = callback(value, index++);
      const bucket = groups.get(key);
      if (bucket) bucket.push(value);
      else groups.set(key, [value]);
    }
    return groups;
  };
}

// Safari 17.4 — the new Set combination methods.
const SetProto = Set.prototype as unknown as Record<string, unknown>;
const asSet = <T>(value: Iterable<T>): Set<T> => (value instanceof Set ? value : new Set(value));

if (typeof SetProto['union'] !== 'function') {
  SetProto['union'] = function union<T>(this: Set<T>, other: Iterable<T>): Set<T> {
    const result = new Set(this);
    for (const item of asSet(other)) result.add(item);
    return result;
  };
}

if (typeof SetProto['intersection'] !== 'function') {
  SetProto['intersection'] = function intersection<T>(this: Set<T>, other: Iterable<T>): Set<T> {
    const result = new Set<T>();
    const otherSet = asSet(other);
    for (const item of this) {
      if (otherSet.has(item as T)) result.add(item as T);
    }
    return result;
  };
}

if (typeof SetProto['difference'] !== 'function') {
  SetProto['difference'] = function difference<T>(this: Set<T>, other: Iterable<T>): Set<T> {
    const result = new Set<T>();
    const otherSet = asSet(other);
    for (const item of this) {
      if (!otherSet.has(item as T)) result.add(item as T);
    }
    return result;
  };
}

if (typeof SetProto['symmetricDifference'] !== 'function') {
  SetProto['symmetricDifference'] = function symmetricDifference<T>(
    this: Set<T>,
    other: Iterable<T>,
  ): Set<T> {
    const result = new Set(this);
    for (const item of asSet(other)) {
      if (result.has(item)) result.delete(item);
      else result.add(item);
    }
    return result;
  };
}

if (typeof SetProto['isSubsetOf'] !== 'function') {
  SetProto['isSubsetOf'] = function isSubsetOf<T>(this: Set<T>, other: Iterable<T>): boolean {
    const otherSet = asSet(other);
    for (const item of this) {
      if (!otherSet.has(item as T)) return false;
    }
    return true;
  };
}

if (typeof SetProto['isSupersetOf'] !== 'function') {
  SetProto['isSupersetOf'] = function isSupersetOf<T>(this: Set<T>, other: Iterable<T>): boolean {
    const otherSet = asSet(other);
    for (const item of otherSet) {
      if (!this.has(item)) return false;
    }
    return true;
  };
}

if (typeof SetProto['isDisjointFrom'] !== 'function') {
  SetProto['isDisjointFrom'] = function isDisjointFrom<T>(
    this: Set<T>,
    other: Iterable<T>,
  ): boolean {
    const otherSet = asSet(other);
    for (const item of this) {
      if (otherSet.has(item as T)) return false;
    }
    return true;
  };
}

// Safari 18.2 — Uint8Array base64/hex (used by the audiobook metadata parser).
const U8 = Uint8Array as unknown as Record<string, unknown>;
const U8Proto = Uint8Array.prototype as unknown as Record<string, unknown>;

const B64_LOOKUP: number[] = (() => {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table: number[] = new Array(128).fill(-1);
  for (let i = 0; i < alpha.length; i++) table[alpha.charCodeAt(i)] = i;
  return table;
})();

function b64DecodeToBytes(input: string): Uint8Array {
  const clean = String(input).replace(/-/g, '+').replace(/_/g, '/').replace(/[\s]/g, '');
  const len = clean.length;
  const padding = len % 4 === 0 ? 0 : 4 - (len % 4);
  const out = new Uint8Array(Math.floor(((len + padding) * 3) / 4) - padding);
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len + padding; i++) {
    const ch = i < len ? clean[i] : '=';
    if (ch === undefined || ch === '=') break;
    const value = B64_LOOKUP[ch.charCodeAt(0) & 0x7f];
    if (value === undefined || value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, outIndex);
}

function bytesToB64(bytes: Uint8Array, urlSafe: boolean): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return urlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
}

if (typeof U8['fromBase64'] !== 'function') {
  U8['fromBase64'] = function fromBase64(s: string): Uint8Array {
    return b64DecodeToBytes(s);
  };
}
if (typeof U8Proto['setFromBase64'] !== 'function') {
  U8Proto['setFromBase64'] = function setFromBase64(
    this: Uint8Array,
    s: string,
  ): { read: number; written: number } {
    const bytes = b64DecodeToBytes(s);
    const written = Math.min(bytes.length, this.length);
    this.set(bytes.subarray(0, written));
    return { read: written, written };
  };
}
if (typeof U8Proto['toBase64'] !== 'function') {
  U8Proto['toBase64'] = function toBase64(this: Uint8Array): string {
    return bytesToB64(this, false);
  };
}

const HEX_CHARS = '0123456789abcdef';
if (typeof U8Proto['toHex'] !== 'function') {
  U8Proto['toHex'] = function toHex(this: Uint8Array): string {
    let out = '';
    for (let i = 0; i < this.length; i++) {
      out += HEX_CHARS[this[i]! >> 4]! + HEX_CHARS[this[i]! & 0xf]!;
    }
    return out;
  };
}
if (typeof U8Proto['setFromHex'] !== 'function') {
  U8Proto['setFromHex'] = function setFromHex(
    this: Uint8Array,
    s: string,
  ): { read: number; written: number } {
    const clean = String(s);
    const written = Math.min(Math.floor(clean.length / 2), this.length);
    for (let i = 0; i < written; i++) {
      this[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return { read: written * 2, written };
  };
}

// Safari 18.2 — inverse of `toHex`; skips ASCII whitespace like the spec's
// forgiving hex parsing.
const U8Ctor = Uint8Array as unknown as Record<string, unknown>;
if (typeof U8Ctor['fromHex'] !== 'function') {
  U8Ctor['fromHex'] = function fromHex(s: string): Uint8Array {
    const clean = String(s).replace(/[\t\n\f\r ]/g, '');
    const out = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  };
}

// Safari 18.2
const RegExpC = RegExp as unknown as Record<string, unknown>;
if (typeof RegExpC['escape'] !== 'function') {
  RegExpC['escape'] = (s: string): string => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function Polyfills() {
  return null;
}
