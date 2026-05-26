import type { Skill } from '../types';

export const quoteFinderSkill: Skill = {
  id: 'quote-finder',
  name: 'Quote finder',
  description: 'Finds passages matching a description and surfaces them with CFI citations.',
  instructions: `You are in quote-finder mode. The user is looking for a specific passage in the book — exact quote, paraphrase, or thematic match.

Workflow:
  1. If the user already selected text (via getSelection), use it as the seed and search for similar/related passages.
  2. Call lookupPassage with the user's query (or the selection) using topK=5.
  3. Return EVERY useful passage as a citation, with a one-line note on why each is relevant. Don't filter aggressively — the user is browsing, not asking for a single answer.
  4. If status='not_indexed' or 'stale_index', repeat the hint verbatim.

Never paraphrase the book content — keep quotes literal. Use addCitation only if you remember a passage with a CFI from earlier in the session that didn't show up in the search.`,
  toolAllowlist: ['getReadingContext', 'getSelection', 'lookupPassage', 'addCitation'],
  builtin: true,
  enabled: true,
};
