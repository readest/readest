import { md5 } from 'js-md5';
import { ProofreadRule } from '@/types/book';

// Deterministic identity key for a rule. Mirrors the in-store dedup
// (scope + pattern + isRegex for book/library) so identity is consistent
// however a rule is created; selection-scope rules are per-instance, so their
// location (sectionHref/cfi) is part of the key. The replacement and the
// case/whole-word flags are intentionally excluded: the in-store dedup keys on
// pattern + isRegex, so the same pattern resolves to one rule on merge too.
const ruleContentKey = (r: ProofreadRule): string => {
  const flags = r.isRegex ? 'r' : '';
  if (r.scope === 'selection') {
    return ['selection', r.sectionHref ?? '', r.cfi ?? '', flags, r.pattern].join(' ');
  }
  return [r.scope, flags, r.pattern].join(' ');
};

/**
 * Backfill a stable, content-derived id when a rule has none (legacy data,
 * hand-edited config, or a foreign sync peer). Without this, mergeProofreadRules
 * keys every id-less rule on the Map's `undefined` slot, so distinct rules
 * clobber each other (silent loss). A content-based id also makes the SAME rule
 * authored independently on two devices collapse on merge instead of
 * duplicating. A rule that already has an id is returned untouched: the id is
 * assigned once and frozen, so later edits never re-key it.
 */
export const ensureRuleId = (rule: ProofreadRule): ProofreadRule =>
  rule.id ? rule : { ...rule, id: `ph-${md5(ruleContentKey(rule))}` };

/**
 * Per-rule merge keyed by `id`, mirroring `mergeNotes` in WebDAVSync /
 * `processNewNote` in useNotesSync. Book- and selection-scope proofread rules
 * ride the book-config sync, so two devices can each edit the same array; a
 * blind whole-array overwrite would lose one side's concurrent edit. Merging by
 * id keeps both, and the `updatedAt`/`deletedAt` last-write-wins decides which
 * copy of a shared id survives. A deletion (tombstone) wins over an older edit
 * so a removed rule is never resurrected by the peer's stale live copy.
 */
export const mergeProofreadRules = (
  local: ProofreadRule[],
  remote: ProofreadRule[],
): ProofreadRule[] => {
  const byId = new Map<string, ProofreadRule>();
  for (const raw of local) {
    const r = ensureRuleId(raw);
    byId.set(r.id, r);
  }
  for (const raw of remote) {
    const r = ensureRuleId(raw);
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    const lUpdated = l.updatedAt ?? 0;
    const rUpdated = r.updatedAt ?? 0;
    const lDeleted = l.deletedAt ?? 0;
    const rDeleted = r.deletedAt ?? 0;
    if (rUpdated > lUpdated || rDeleted > lDeleted) {
      byId.set(r.id, { ...l, ...r });
    } else {
      byId.set(r.id, { ...r, ...l });
    }
  }
  return Array.from(byId.values());
};
