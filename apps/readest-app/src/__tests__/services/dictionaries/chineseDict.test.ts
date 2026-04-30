import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseRedirect,
  parsePinyin,
  cleanWikiMarkup,
  parseDefinitions,
  fetchChineseDefinition,
} from '@/services/dictionaries/chineseDict';

// Sample wikitext for 書 (traditional, full entry)
const WIKITEXT_SHU_TRADITIONAL = `
==Chinese==

===Glyph origin===
Some origin text.

===Pronunciation===
{{zh-pron
|m=shū
|c=syu1
|cat=n,v,pn
}}

===Definitions===
{{head|zh|hanzi}}

# [[book]]; [[codex]]
# [[letter]]; [[document]]
# form of a written or printed [[Chinese character]]; [[style]]
# {{lb|zh|literary}} [[Chinese character]]; [[writing]]; [[script]]
# {{lb|zh|historical}} ancient government [[post]]
# [[storytelling]]
# to [[write]]
# {{surname|zh}}

===Compounds===
* {{zh-l|書法}}
`;

// Sample wikitext for 书 (simplified, redirect)
const WIKITEXT_SHU_SIMPLIFIED = `
{{also|書}}
{{character info}}
==Translingual==

===Han character===
{{Han char|rn=5|rad=乙|as=3|sn=4}}

==Chinese==

===Glyph origin===
{{Han simp|書}}

===Definitions===
{{zh-see|書}}
`;

// Sample wikitext for 你好 (multi-character word)
const WIKITEXT_NI_HAO = `
==Chinese==

===Pronunciation===
{{zh-pron
|m=nǐ hǎo
|c=nei5 hou2
|cat=intj
}}

===Definitions===
{{head|zh|interjection}}

# [[hello]]; [[hi]]

====Usage notes====
Often used as a polite greeting.

===See also===
* {{zh-l|您好}}
`;

describe('parseRedirect', () => {
  it('detects zh-see redirect', () => {
    expect(parseRedirect(WIKITEXT_SHU_SIMPLIFIED)).toBe('書');
  });

  it('returns null when no redirect', () => {
    expect(parseRedirect(WIKITEXT_SHU_TRADITIONAL)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRedirect('')).toBeNull();
  });
});

describe('parsePinyin', () => {
  it('extracts pinyin from zh-pron template', () => {
    expect(parsePinyin(WIKITEXT_SHU_TRADITIONAL)).toBe('shū');
  });

  it('extracts multi-syllable pinyin', () => {
    expect(parsePinyin(WIKITEXT_NI_HAO)).toBe('nǐ hǎo');
  });

  it('returns null when no zh-pron template', () => {
    expect(parsePinyin('no pronunciation here')).toBeNull();
  });

  it('returns null when zh-pron has no mandarin entry', () => {
    const wikitext = '{{zh-pron\n|c=syu1\n}}';
    expect(parsePinyin(wikitext)).toBeNull();
  });
});

describe('cleanWikiMarkup', () => {
  it('cleans simple wiki links', () => {
    expect(cleanWikiMarkup('[[book]]')).toBe('book');
  });

  it('cleans piped wiki links', () => {
    expect(cleanWikiMarkup('[[Chinese character|character]]')).toBe('character');
  });

  it('cleans language label templates', () => {
    expect(cleanWikiMarkup('{{lb|zh|literary}} text')).toBe('(literary) text');
  });

  it('cleans multiple labels', () => {
    expect(cleanWikiMarkup('{{lb|zh|historical|archaic}} text')).toBe('(historical, archaic) text');
  });

  it('cleans surname template', () => {
    expect(cleanWikiMarkup('{{surname|zh}}')).toBe('A surname');
  });

  it('cleans zh-abbrev template', () => {
    expect(cleanWikiMarkup('{{zh-abbrev|书经}}')).toBe('abbreviation of 书经');
  });

  it('cleans l template', () => {
    expect(cleanWikiMarkup('{{l|zh|書}}')).toBe('書');
  });

  it('removes unknown templates', () => {
    expect(cleanWikiMarkup('{{unknown|template}}')).toBe('');
  });

  it('handles mixed content', () => {
    const input = '{{lb|zh|literary}} [[Chinese character]]; [[writing]]';
    expect(cleanWikiMarkup(input)).toBe('(literary) Chinese character; writing');
  });
});

describe('parseDefinitions', () => {
  it('parses definitions from traditional character entry', () => {
    const result = parseDefinitions(WIKITEXT_SHU_TRADITIONAL);
    expect(result).toHaveLength(1);
    expect(result[0]!.meanings).toContain('book; codex');
    expect(result[0]!.meanings).toContain('letter; document');
    expect(result[0]!.meanings).toContain('to write');
    expect(result[0]!.meanings).toContain('A surname');
  });

  it('parses definitions from multi-character word', () => {
    const result = parseDefinitions(WIKITEXT_NI_HAO);
    expect(result).toHaveLength(1);
    expect(result[0]!.meanings).toContain('hello; hi');
  });

  it('returns empty for redirect entries', () => {
    const result = parseDefinitions(WIKITEXT_SHU_SIMPLIFIED);
    expect(result).toHaveLength(0);
  });

  it('returns empty for text without definitions', () => {
    expect(parseDefinitions('no definitions here')).toHaveLength(0);
  });

  it('skips sub-definition lines (## lines)', () => {
    const wikitext = `===Definitions===
{{head|zh|hanzi}}

# main definition
## sub definition
# another main

===Other===`;
    const result = parseDefinitions(wikitext);
    expect(result[0]!.meanings).toHaveLength(2);
    expect(result[0]!.meanings).toContain('main definition');
    expect(result[0]!.meanings).toContain('another main');
  });
});

describe('fetchChineseDefinition', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and parses a traditional character', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: { wikitext: { '*': WIKITEXT_SHU_TRADITIONAL } },
        }),
      ),
    );

    const result = await fetchChineseDefinition('書');
    expect(result).not.toBeNull();
    expect(result!.pinyin).toBe('shū');
    expect(result!.word).toBe('書');
    expect(result!.definitions[0]!.meanings).toContain('book; codex');
  });

  it('follows simplified → traditional redirect', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // First call returns simplified (redirect)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: { wikitext: { '*': WIKITEXT_SHU_SIMPLIFIED } },
        }),
      ),
    );
    // Second call returns traditional (full entry)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: { wikitext: { '*': WIKITEXT_SHU_TRADITIONAL } },
        }),
      ),
    );

    const result = await fetchChineseDefinition('书');
    expect(result).not.toBeNull();
    expect(result!.word).toBe('書');
    expect(result!.pinyin).toBe('shū');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 404 }));

    const result = await fetchChineseDefinition('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when wikitext has no useful data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          parse: { wikitext: { '*': '==Translingual==\nSome unrelated content.' } },
        }),
      ),
    );

    const result = await fetchChineseDefinition('test');
    expect(result).toBeNull();
  });
});
