---
name: dict-lemmatization-4574
description: "Dictionary lookup lemmatizes inflected words (ran→run, mice→mouse) before lookup; pluggable per-language registry, English impl, candidate-chain integration"
metadata: 
  node_type: memory
  type: project
  originSessionId: d4206b72-47da-4c3d-adab-04df32c1137a
---

#4574 FR: dictionary lookup should normalize inflected forms before lookup. Dicts that store only base headwords (Oxford Dictionary of English, Cambridge, Longman) miss `ran`/`mice`/`children`/`analyses`/`realised` even though `run`/`mouse`/`child`/`analysis`/`realise` exist.

**Integration point** (single, central): `src/services/dictionaries/lookupCandidates.ts` `buildLookupCandidates(word, lang?)` — appends `getLemmaCandidates(lower, lang)` to the tail of `[trimmed, lower, title, upper]`. Lemmas sit AFTER exact/case so exact match always wins. The pre-existing lookup loop in `DictionaryResultsView.tsx` (`useDictionaryResults`, shared by desktop popup + mobile sheet) tries each candidate and breaks on first non-empty hit; wiring was a one-liner passing `langCode` (already in effect scope) as the 2nd arg. Applies to ALL definition providers (mdict/stardict/dict/slob + online builtins).

**New module** `src/services/dictionaries/lemmatize/`:
- `index.ts` — `getLemmaCandidates(word, lang)` + `Record<string, Lemmatizer>` registry (`Lemmatizer = (word)=>string[]`). Lang normalized via `normalizedLangCode` (utils/lang.ts) to primary subtag. **Missing/empty lang defaults to `'en'`** (`normalizedLangCode(lang) || 'en'`); **explicit non-English with no registered lemmatizer → `[]`** (we never force English onto e.g. `fr`/`zh`). Add a language = register one fn, no caller changes.
- `english.ts` — `lemmatizeEnglish(word)`: `IRREGULAR_GROUPS` (base→[forms], flattened to inflected→base at load) for suppletive verbs / irregular plurals / irregular comparatives, + regular suffix rules (plural -s/-es/-ies→y/-ves→f,fe/-ses→sis; past -ed/-d/-ied→y + de-double; -ing + e-restore + de-double + -ying→ie; comparative -er/-est/-ier→y; possessive `'s`; adverb -ly). ASCII-single-token guard `/^[a-z][a-z'’-]*$/` (no-op on phrases/numbers/CJK/accented). Lowercases input; never returns the input itself or single letters.

**Key design insight: over-generate, let the dictionary validate.** The lemmatizer need not be linguistically precise — a bogus stem just misses and the loop moves on. So rules can be liberal. Cost is bounded: lemmas only fire AFTER exact+case all return empty (genuine "not a headword"), and the English rules produce ~2–5 candidates.

**Ordering gotcha**: `-ses→-sis` rule must come BEFORE generic `-es`/`-s` so `analyses`→`analysis` (the issue's expected noun) is tried ahead of `analyse` (the verb). Both are linguistically valid for `analyses`; issue wants the noun.

Tests: `__tests__/services/dictionaries/lemmatize/{english,index}.test.ts` + extended `lookupCandidates.test.ts` (all 8 issue cases asserted). Existing trim test's `spaced` sample swapped to `planet` (non-inflecting) since no-lang path now defaults to English lemmatization. Pure functions, fully deterministic — no live MDX needed. Related: [[dict-lookup-browser-hijack-4559]], [[wordwise-feature]].
