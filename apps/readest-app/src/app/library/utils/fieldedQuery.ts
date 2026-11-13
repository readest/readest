/**
 * Calibre-like fielded search for the library search box (#7370):
 *
 *   author:herbert                     the field contains "herbert"
 *   subject:"science fiction"          quotes keep spaces in a value
 *   title:=dune  title:"=Dune"         `=` matches a whole value
 *   title:~^the                        `~` matches a regular expression
 *   #genre:opera                       a calibre custom column, by #label
 *   a and b, a b, a or b, not a, ( )   `not` binds tighter than `and`, then `or`
 *
 * A word with no field prefix matches any field. Matching ignores case. A
 * query only switches to fielded search when it names a known field, so
 * "Re:Zero" or a regular expression is searched exactly as before.
 */

/** Canonical field names and the aliases calibre users type for them. */
const FIELD_ALIASES: Record<string, string> = {
  title: 'title',
  author: 'author',
  authors: 'author',
  tag: 'tag',
  tags: 'tag',
  subject: 'subject',
  subjects: 'subject',
  series: 'series',
  publisher: 'publisher',
  language: 'language',
  languages: 'language',
  lang: 'language',
  format: 'format',
  formats: 'format',
  description: 'description',
  comments: 'description',
  group: 'group',
  isbn: 'isbn',
  identifier: 'identifier',
  identifiers: 'identifier',
};

/** A field name, or `#label` for a calibre custom column. */
const FIELD_PREFIX = /^(#?[a-z_][a-z0-9_]*):/i;

type Token = { type: '(' } | { type: ')' } | { type: 'word'; text: string; quoted: boolean };

type QueryNode =
  | { kind: 'term'; field: string | null; matches: (value: string) => boolean }
  | { kind: 'not'; node: QueryNode }
  | { kind: 'and' | 'or'; nodes: QueryNode[] };

export type FieldedQuery = QueryNode;

/** Values of one field of the item being matched; `null` asks for every field. */
export type FieldValues = (field: string | null) => string[];

const isSpace = (ch: string): boolean => /\s/.test(ch);

/**
 * One word starting at `start`: a quoted value, optionally after `field:`, or
 * a run up to a space or a parenthesis. After `field:` the value keeps its
 * balanced parentheses, so `title:~(dune|hobbit)` stays one regex value while
 * a `)` it didn't open still closes the enclosing group.
 */
const readWord = (query: string, start: number): { text: string; quoted: boolean; end: number } => {
  let i = start;
  let inField = false;
  let depth = 0;
  while (i < query.length) {
    const ch = query[i]!;
    if (ch === '"') {
      const close = query.indexOf('"', i + 1);
      const end = close === -1 ? query.length : close + 1;
      return { text: query.slice(start, end), quoted: true, end };
    }
    if (isSpace(ch)) break;
    if (ch === ':' && !inField) inField = true;
    else if (ch === '(') {
      if (!inField) break;
      depth++;
    } else if (ch === ')') {
      if (depth === 0) break;
      depth--;
    }
    i++;
  }
  return { text: query.slice(start, i), quoted: false, end: i };
};

const tokenize = (query: string): Token[] => {
  const tokens: Token[] = [];
  let depth = 0;
  let i = 0;
  while (i < query.length) {
    const ch = query[i]!;
    if (isSpace(ch)) {
      i++;
    } else if (ch === '(') {
      depth++;
      tokens.push({ type: '(' });
      i++;
    } else if (ch === ')') {
      // A stray ")" closes nothing; drop it rather than end the query there.
      if (depth > 0) {
        depth--;
        tokens.push({ type: ')' });
      }
      i++;
    } else {
      const word = readWord(query, i);
      tokens.push({ type: 'word', text: word.text, quoted: word.quoted });
      i = word.end;
    }
  }
  return tokens;
};

const unquote = (value: string): string => {
  if (!value.startsWith('"')) return value;
  return value.endsWith('"') && value.length > 1 ? value.slice(1, -1) : value.slice(1);
};

/** The canonical field a word names, or null when it names none. */
const fieldOf = (text: string): { field: string; value: string } | null => {
  const prefix = text.match(FIELD_PREFIX);
  if (!prefix?.[1]) return null;
  const name = prefix[1].toLowerCase();
  const field = name.startsWith('#') ? name : FIELD_ALIASES[name];
  // "Language: A Biography" is a title with a colon, not an empty field.
  const value = unquote(text.slice(prefix[0].length));
  if (!field || !value) return null;
  return { field, value };
};

const containsMatcher = (text: string): ((value: string) => boolean) => {
  const needle = text.toLowerCase();
  return (value) => value.toLowerCase().includes(needle);
};

const valueMatcher = (raw: string): ((value: string) => boolean) => {
  if (raw.startsWith('=')) {
    const exact = raw.slice(1).trim().toLowerCase();
    return (value) => value.trim().toLowerCase() === exact;
  }
  if (raw.startsWith('~')) {
    try {
      const pattern = new RegExp(raw.slice(1), 'i');
      return (value) => pattern.test(value);
    } catch {
      // An unfinished pattern while typing: match it as plain text.
      return containsMatcher(raw.slice(1));
    }
  }
  return containsMatcher(raw);
};

const isOperator = (token: Token | undefined, op: 'and' | 'or' | 'not'): boolean =>
  token?.type === 'word' && !token.quoted && token.text.toLowerCase() === op;

const combine = (kind: 'and' | 'or', nodes: QueryNode[]): QueryNode | null =>
  nodes.length === 0 ? null : nodes.length === 1 ? nodes[0]! : { kind, nodes };

/**
 * Parse a library search query. Returns null when the query names no known
 * field, so the caller keeps the plain search. Lenient while the user types:
 * a dangling operator is ignored and an unclosed parenthesis closes at the end.
 */
export function parseFieldedQuery(query: string): FieldedQuery | null {
  const tokens = tokenize(query);
  if (!tokens.some((token) => token.type === 'word' && fieldOf(token.text))) return null;

  let pos = 0;
  const atGroupEnd = () => pos >= tokens.length || tokens[pos]!.type === ')';

  const parsePrimary = (): QueryNode | null => {
    const token = tokens[pos];
    if (!token || token.type === ')' || isOperator(token, 'and') || isOperator(token, 'or')) {
      return null;
    }
    pos++;
    if (token.type === '(') {
      const node = parseOr();
      if (tokens[pos]?.type === ')') pos++;
      return node;
    }
    const fielded = fieldOf(token.text);
    if (fielded) {
      return { kind: 'term', field: fielded.field, matches: valueMatcher(fielded.value) };
    }
    return { kind: 'term', field: null, matches: containsMatcher(unquote(token.text)) };
  };

  const parseNot = (): QueryNode | null => {
    if (!isOperator(tokens[pos], 'not')) return parsePrimary();
    pos++;
    const node = parseNot();
    return node && { kind: 'not', node };
  };

  const parseAnd = (): QueryNode | null => {
    const nodes: QueryNode[] = [];
    while (!atGroupEnd() && !isOperator(tokens[pos], 'or')) {
      if (isOperator(tokens[pos], 'and')) {
        pos++;
        continue;
      }
      const node = parseNot();
      if (node) nodes.push(node);
    }
    return combine('and', nodes);
  };

  function parseOr(): QueryNode | null {
    const nodes: QueryNode[] = [];
    for (;;) {
      const node = parseAnd();
      if (node) nodes.push(node);
      if (!isOperator(tokens[pos], 'or')) break;
      pos++;
    }
    return combine('or', nodes);
  }

  return parseOr();
}

export function matchesFieldedQuery(query: FieldedQuery, values: FieldValues): boolean {
  switch (query.kind) {
    case 'term':
      return values(query.field).some(query.matches);
    case 'not':
      return !matchesFieldedQuery(query.node, values);
    case 'and':
      return query.nodes.every((node) => matchesFieldedQuery(node, values));
    case 'or':
      return query.nodes.some((node) => matchesFieldedQuery(node, values));
  }
}
