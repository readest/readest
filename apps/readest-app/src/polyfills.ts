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
      const key = `${callback(value, index++) as unknown}`.replace('-0', '0');
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

export default function Polyfills() {
  return null;
}
