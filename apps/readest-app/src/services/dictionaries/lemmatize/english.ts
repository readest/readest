/**
 * English lemmatizer for dictionary lookup fallback.
 *
 * Given an inflected English word it returns an ordered, de-duplicated list of
 * candidate base forms (e.g. `ran → run`, `mice → mouse`, `analyses →
 * analysis`). The list is intentionally *over-generated*: the dictionary
 * lookup itself is the validator, so a bogus stem simply misses and the caller
 * moves on. The rules therefore only need to *include* the correct base, not
 * be linguistically precise.
 *
 * Two layers, in priority order:
 *   1. an irregular-form table (common suppletive verbs, irregular plurals,
 *      and irregular comparatives) — these can't be derived by rule;
 *   2. regular suffix rules (plural / past / gerund / comparative / possessive).
 *
 * Only single ASCII-alphabetic tokens are lemmatized; phrases, numbers, and
 * accented/CJK text return `[]`.
 */

// Base form -> the irregular inflected forms that should resolve to it.
// Readable as groups; flattened to an inflected->base map at module load.
const IRREGULAR_GROUPS: Record<string, string[]> = {
  // Suppletive / highly irregular verbs.
  be: ['is', 'am', 'are', 'was', 'were', 'been', 'being'],
  have: ['has', 'had', 'having'],
  do: ['does', 'did', 'done', 'doing'],
  go: ['goes', 'went', 'gone', 'going'],
  say: ['said'],
  get: ['got', 'gotten'],
  make: ['made'],
  know: ['knew', 'known'],
  think: ['thought'],
  take: ['took', 'taken'],
  see: ['saw', 'seen'],
  come: ['came'],
  find: ['found'],
  give: ['gave', 'given'],
  tell: ['told'],
  feel: ['felt'],
  become: ['became'],
  leave: ['left'],
  mean: ['meant'],
  keep: ['kept'],
  begin: ['began', 'begun'],
  show: ['showed', 'shown'],
  hear: ['heard'],
  run: ['ran'],
  bring: ['brought'],
  write: ['wrote', 'written'],
  sit: ['sat'],
  stand: ['stood'],
  lose: ['lost'],
  pay: ['paid'],
  meet: ['met'],
  learn: ['learnt'],
  lead: ['led'],
  understand: ['understood'],
  speak: ['spoke', 'spoken'],
  spend: ['spent'],
  grow: ['grew', 'grown'],
  win: ['won'],
  teach: ['taught'],
  buy: ['bought'],
  send: ['sent'],
  build: ['built'],
  fall: ['fell', 'fallen'],
  catch: ['caught'],
  draw: ['drew', 'drawn'],
  choose: ['chose', 'chosen'],
  drive: ['drove', 'driven'],
  break: ['broke', 'broken'],
  eat: ['ate', 'eaten'],
  drink: ['drank', 'drunk'],
  sing: ['sang', 'sung'],
  swim: ['swam', 'swum'],
  ring: ['rang', 'rung'],
  fly: ['flew', 'flown'],
  throw: ['threw', 'thrown'],
  wear: ['wore', 'worn'],
  tear: ['tore', 'torn'],
  sell: ['sold'],
  hold: ['held'],
  feed: ['fed'],
  fight: ['fought'],
  hide: ['hid', 'hidden'],
  ride: ['rode', 'ridden'],
  rise: ['rose', 'risen'],
  shake: ['shook', 'shaken'],
  steal: ['stole', 'stolen'],
  freeze: ['froze', 'frozen'],
  sleep: ['slept'],
  bite: ['bit', 'bitten'],
  hang: ['hung'],
  shoot: ['shot'],
  sink: ['sank', 'sunk'],
  forget: ['forgot', 'forgotten'],
  forgive: ['forgave', 'forgiven'],
  lay: ['laid'],
  deal: ['dealt'],
  dig: ['dug'],
  shine: ['shone'],
  bend: ['bent'],
  lend: ['lent'],
  blow: ['blew', 'blown'],
  beat: ['beaten'],
  arise: ['arose', 'arisen'],
  awake: ['awoke', 'awoken'],
  // Irregular plurals.
  man: ['men'],
  woman: ['women'],
  child: ['children'],
  mouse: ['mice'],
  louse: ['lice'],
  goose: ['geese'],
  foot: ['feet'],
  tooth: ['teeth'],
  person: ['people'],
  ox: ['oxen'],
  die: ['dice'],
  criterion: ['criteria'],
  phenomenon: ['phenomena'],
  cactus: ['cacti'],
  fungus: ['fungi'],
  nucleus: ['nuclei'],
  radius: ['radii'],
  alumnus: ['alumni'],
  index: ['indices'],
  matrix: ['matrices'],
  vertex: ['vertices'],
  appendix: ['appendices'],
  // Irregular comparatives / superlatives (adjective & adverb).
  good: ['better', 'best', 'well'],
  bad: ['worse', 'worst'],
  far: ['further', 'furthest', 'farther', 'farthest'],
  little: ['less', 'least'],
};

const IRREGULARS: Record<string, string> = {};
for (const [base, forms] of Object.entries(IRREGULAR_GROUPS)) {
  for (const form of forms) IRREGULARS[form] = base;
}

const DOUBLED_CONSONANT = /[bcdfgklmnprstvz]/;

// "runn" -> "run", "bigg" -> "big"; only collapses a doubled final consonant.
const undouble = (stem: string): string | null => {
  const last = stem[stem.length - 1];
  if (stem.length >= 2 && last === stem[stem.length - 2] && last && DOUBLED_CONSONANT.test(last)) {
    return stem.slice(0, -1);
  }
  return null;
};

const applySuffixRules = (word: string, push: (candidate: string) => void): void => {
  // --- plural / third-person present ---
  if (word.endsWith('ies') && word.length > 4) push(word.slice(0, -3) + 'y'); // cities -> city
  if (word.endsWith('ves') && word.length > 3) {
    push(word.slice(0, -3) + 'f'); // wolves -> wolf
    push(word.slice(0, -3) + 'fe'); // knives -> knife
  }
  // Greek/Latin -ses plural; tried before generic -es so the noun wins.
  if (word.endsWith('ses') && word.length > 3) push(word.slice(0, -3) + 'sis'); // analyses -> analysis
  if (/(s|x|z|ch|sh)es$/.test(word)) push(word.slice(0, -2)); // boxes -> box, dishes -> dish
  if (word.endsWith('es') && word.length > 2) push(word.slice(0, -1)); // houses -> house
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 1) push(word.slice(0, -1)); // cats -> cat

  // --- past tense / past participle ---
  if (word.endsWith('ied') && word.length > 3) push(word.slice(0, -3) + 'y'); // studied -> study
  if (word.endsWith('ed') && word.length > 2) {
    push(word.slice(0, -2)); // walked -> walk
    push(word.slice(0, -1)); // realised -> realise, used -> use
    const undoubled = undouble(word.slice(0, -2));
    if (undoubled) push(undoubled); // stopped -> stop
  }

  // --- present participle / gerund ---
  if (word.endsWith('ying') && word.length > 4) push(word.slice(0, -4) + 'ie'); // lying -> lie
  if (word.endsWith('ing') && word.length > 3) {
    push(word.slice(0, -3)); // walking -> walk
    push(word.slice(0, -3) + 'e'); // making -> make
    const undoubled = undouble(word.slice(0, -3));
    if (undoubled) push(undoubled); // running -> run
  }

  // --- comparative / superlative ---
  if (word.endsWith('iest') && word.length > 4) push(word.slice(0, -4) + 'y'); // happiest -> happy
  if (word.endsWith('ier') && word.length > 3) push(word.slice(0, -3) + 'y'); // happier -> happy
  if (word.endsWith('est') && word.length > 3) {
    push(word.slice(0, -3)); // fastest -> fast
    push(word.slice(0, -2)); // largest -> large
    const undoubled = undouble(word.slice(0, -3));
    if (undoubled) push(undoubled); // biggest -> big
  }
  if (word.endsWith('er') && word.length > 2) {
    push(word.slice(0, -2)); // faster -> fast
    push(word.slice(0, -1)); // larger -> large
    const undoubled = undouble(word.slice(0, -2));
    if (undoubled) push(undoubled); // bigger -> big
  }

  // --- adverb ---
  if (word.endsWith('ly') && word.length > 2) push(word.slice(0, -2)); // quickly -> quick
};

export const lemmatizeEnglish = (word: string): string[] => {
  const lower = word.toLowerCase();
  if (!/^[a-z][a-z'’-]*$/.test(lower)) return [];

  const out: string[] = [];
  const push = (candidate: string): void => {
    // Skip empties, single letters, the input itself, and duplicates.
    if (candidate.length > 1 && candidate !== lower && !out.includes(candidate)) {
      out.push(candidate);
    }
  };

  // Possessive: "cat's" / "dogs'" -> drop the clitic and lemmatize the noun.
  const stripped = lower.replace(/['’]s?$/, '');
  const root = stripped !== lower ? stripped : lower;
  if (stripped !== lower) push(stripped);

  if (IRREGULARS[root]) push(IRREGULARS[root]);
  applySuffixRules(root, push);

  return out;
};
