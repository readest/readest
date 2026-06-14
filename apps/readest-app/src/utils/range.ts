/**
 * Realm-safe check for a DOM Range.
 *
 * A Range produced by `view.resolveCFI(cfi).anchor(doc)` is created inside the
 * book iframe's realm. App-bundle code runs in the top realm, so
 * `anchor instanceof Range` compares against the *top* window's `Range`
 * constructor and is ALWAYS false for an iframe-realm Range (cross-realm
 * instanceof). That silently turns CFI resolution into `null`.
 *
 * Duck-type on `cloneRange` instead — it is unique to `Range` (a `Node` does not
 * have it), so this distinguishes a Range from a Node anchor without depending
 * on which realm created it. See the iframe-cross-realm-instanceof learning.
 */
export const isRangeLike = (value: unknown): value is Range =>
  typeof value === 'object' && value !== null && typeof (value as Range).cloneRange === 'function';
