export type ChineseDefinition = {
  partOfSpeech: string;
  meanings: string[];
};

export type ChineseEntry = {
  word: string;
  pinyin: string | null;
  definitions: ChineseDefinition[];
};

const WIKTIONARY_API = 'https://en.wiktionary.org/w/api.php';

async function fetchWikitext(word: string): Promise<string | null> {
  const url = `${WIKTIONARY_API}?action=parse&page=${encodeURIComponent(word)}&prop=wikitext&format=json&origin=*`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const json = await response.json();
  return json?.parse?.wikitext?.['*'] ?? null;
}

export function parseRedirect(wikitext: string): string | null {
  const match = wikitext.match(/\{\{zh-see\|([^|}]+)/);
  return match?.[1] ?? null;
}

export function parsePinyin(wikitext: string): string | null {
  const pronMatch = wikitext.match(/\{\{zh-pron[\s\S]*?\}\}/);
  if (!pronMatch) return null;
  const mMatch = pronMatch[0].match(/\|m=([^|}\n]+)/);
  if (!mMatch) return null;
  return mMatch[1]!.trim();
}

export function cleanWikiMarkup(text: string): string {
  let result = text;
  // [[word|display]] → display
  result = result.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  // {{lb|zh|...|...}} → (label)
  result = result.replace(/\{\{lb\|zh\|([^}]*)\}\}/g, (_match, params: string) => {
    const labels = params
      .split('|')
      .filter((p: string) => p !== '_' && p !== 'zh')
      .join(', ');
    return labels ? `(${labels})` : '';
  });
  // {{surname|zh}} → A surname
  result = result.replace(/\{\{surname\|zh\}\}/g, 'A surname');
  // {{zh-abbrev|X}} → abbreviation of X
  result = result.replace(/\{\{zh-abbrev\|([^|}]+)(?:\|[^}]*)?\}\}/g, 'abbreviation of $1');
  // {{gloss|X}} → (X)
  result = result.replace(/\{\{gloss\|([^}]+)\}\}/g, '($1)');
  // {{qualifier|X}} → (X)
  result = result.replace(/\{\{qualifier\|([^}]+)\}\}/g, '($1)');
  // {{l|...|word}} or {{m|...|word}} → word
  result = result.replace(/\{\{[lm]\|[^|]+\|([^|}]+)(?:\|[^}]*)?\}\}/g, '$1');
  // Remove remaining templates
  result = result.replace(/\{\{[^}]*\}\}/g, '');
  // Clean up whitespace
  result = result.replace(/\s{2,}/g, ' ').trim();
  return result;
}

export function parseDefinitions(wikitext: string): ChineseDefinition[] {
  // Find the Chinese ===Definitions=== section
  const defSectionMatch = wikitext.match(
    /===Definitions===\s*\n(?:\{\{[^}]*\}\}\s*\n)?([\s\S]*?)(?=\n===|\n==(?!=))/,
  );
  if (!defSectionMatch) return [];

  const defLines = defSectionMatch[1]!
    .split('\n')
    .filter((line) => /^#[^#*:]/.test(line))
    .map((line) => cleanWikiMarkup(line.replace(/^#\s*/, '')))
    .filter((line) => line.length > 0);

  if (defLines.length === 0) return [];

  return [{ partOfSpeech: 'Definitions', meanings: defLines }];
}

export async function fetchChineseDefinition(word: string): Promise<ChineseEntry | null> {
  let wikitext = await fetchWikitext(word);
  if (!wikitext) return null;

  // Handle simplified → traditional redirect
  const redirect = parseRedirect(wikitext);
  if (redirect) {
    wikitext = await fetchWikitext(redirect);
    if (!wikitext) return null;
  }

  const pinyin = parsePinyin(wikitext);
  const definitions = parseDefinitions(wikitext);

  if (!pinyin && definitions.length === 0) return null;

  return {
    word: redirect ?? word,
    pinyin,
    definitions,
  };
}
