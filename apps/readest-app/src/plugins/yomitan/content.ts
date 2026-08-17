import {
  MAX_DICTIONARY_DOCUMENT_DEPTH,
  MAX_DICTIONARY_DOCUMENT_NODES,
  type DictionaryContentNode,
} from '@/services/plugins/contract';

interface NormalizeState {
  nodes: number;
  currentHeadword?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`Invalid Yomitan ${field}`);
  return value;
};

const optionalPositiveNumber = (value: unknown, field: string): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid Yomitan ${field}`);
  }
  return value;
};

export const normalizeYomitanResourcePath = (path: unknown): string => {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) {
    throw new Error('Invalid Yomitan resource path');
  }
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((segment) => segment === '..' || segment === '.') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path)
  ) {
    throw new Error('Unsafe Yomitan resource path');
  }
  return path;
};

const countNode = (state: NormalizeState, depth: number): void => {
  if (depth > MAX_DICTIONARY_DOCUMENT_DEPTH) {
    throw new Error(`Yomitan content exceeds maximum depth ${MAX_DICTIONARY_DOCUMENT_DEPTH}`);
  }
  state.nodes += 1;
  if (state.nodes > MAX_DICTIONARY_DOCUMENT_NODES) {
    throw new Error(`Yomitan content exceeds maximum nodes ${MAX_DICTIONARY_DOCUMENT_NODES}`);
  }
};

const imageNode = (value: Record<string, unknown>): DictionaryContentNode => {
  const path = normalizeYomitanResourcePath(value['path']);
  const imageRendering = optionalString(value['imageRendering'], 'imageRendering');
  const appearance = optionalString(value['appearance'], 'appearance');
  const sizeUnits = optionalString(value['sizeUnits'], 'sizeUnits');
  if (
    imageRendering !== undefined &&
    imageRendering !== 'auto' &&
    imageRendering !== 'pixelated' &&
    imageRendering !== 'crisp-edges'
  ) {
    throw new Error('Invalid Yomitan imageRendering');
  }
  if (appearance !== undefined && appearance !== 'auto' && appearance !== 'monochrome') {
    throw new Error('Invalid Yomitan appearance');
  }
  if (sizeUnits !== undefined && sizeUnits !== 'px' && sizeUnits !== 'em') {
    throw new Error('Invalid Yomitan sizeUnits');
  }
  return {
    type: 'image',
    resourceRef: path,
    ...(optionalString(value['alt'], 'image alt') === undefined
      ? {}
      : { alt: optionalString(value['alt'], 'image alt') }),
    ...(optionalString(value['title'], 'image title') === undefined
      ? {}
      : { title: optionalString(value['title'], 'image title') }),
    ...(optionalPositiveNumber(value['width'], 'image width') === undefined
      ? {}
      : { width: optionalPositiveNumber(value['width'], 'image width') }),
    ...(optionalPositiveNumber(value['height'], 'image height') === undefined
      ? {}
      : { height: optionalPositiveNumber(value['height'], 'image height') }),
    ...(sizeUnits === undefined ? {} : { sizeUnits }),
    ...(imageRendering === undefined
      ? value['pixelated'] === true
        ? { imageRendering: 'pixelated' as const }
        : {}
      : { imageRendering }),
    ...(appearance === undefined ? {} : { appearance }),
  };
};

type DictionaryElementStyle = NonNullable<
  Extract<DictionaryContentNode, { type: 'element' }>['style']
>;

const styleNode = (value: unknown): DictionaryElementStyle => {
  if (!isRecord(value)) return {};
  const style: DictionaryElementStyle = {};
  if (value['fontStyle'] === 'normal' || value['fontStyle'] === 'italic') {
    style.fontStyle = value['fontStyle'];
  }
  if (value['fontWeight'] === 'normal' || value['fontWeight'] === 'bold') {
    style.fontWeight = value['fontWeight'];
  }
  if (
    value['textDecorationLine'] === 'none' ||
    value['textDecorationLine'] === 'underline' ||
    value['textDecorationLine'] === 'line-through'
  ) {
    style.textDecorationLine = value['textDecorationLine'];
  }
  if (
    value['verticalAlign'] === 'baseline' ||
    value['verticalAlign'] === 'sub' ||
    value['verticalAlign'] === 'super' ||
    value['verticalAlign'] === 'text-top' ||
    value['verticalAlign'] === 'text-bottom' ||
    value['verticalAlign'] === 'middle'
  ) {
    style.verticalAlign = value['verticalAlign'];
  }
  if (
    value['textAlign'] === 'start' ||
    value['textAlign'] === 'end' ||
    value['textAlign'] === 'left' ||
    value['textAlign'] === 'right' ||
    value['textAlign'] === 'center'
  ) {
    style.textAlign = value['textAlign'];
  }
  return style;
};

const plainText = (nodes: DictionaryContentNode[]): string => {
  const parts: string[] = [];
  const visit = (node: DictionaryContentNode): void => {
    if (node.type === 'text') parts.push(node.value);
    else if (node.type === 'lineBreak') parts.push(' ');
    else if (node.type === 'link') parts.push(node.label);
    else if (node.type === 'image') {
      if (node.alt) parts.push(node.alt);
    } else {
      node.children.forEach(visit);
    }
  };
  nodes.forEach(visit);
  return parts.join('').trim();
};

const internalLookupWord = (href: string, currentHeadword?: string): string => {
  const query = href.slice(1);
  const params = new URLSearchParams(query);
  const requested = params.get('query') ?? params.get('term') ?? decodeURIComponent(query);
  const word = requested.trim() || currentHeadword?.trim() || '';
  if (!word.trim() || word.length > 512) throw new Error('Invalid Yomitan internal link');
  return word.trim();
};

const normalizeValue = (
  value: unknown,
  depth: number,
  state: NormalizeState,
): DictionaryContentNode[] => {
  if (depth > MAX_DICTIONARY_DOCUMENT_DEPTH) {
    throw new Error(`Yomitan content exceeds maximum depth ${MAX_DICTIONARY_DOCUMENT_DEPTH}`);
  }
  if (typeof value === 'string') {
    countNode(state, depth);
    return [{ type: 'text', value }];
  }
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      typeof value[0] === 'string' &&
      Array.isArray(value[1]) &&
      value[1].every((item) => typeof item === 'string')
    ) {
      countNode(state, depth);
      return [{ type: 'text', value: value[0] }];
    }
    return value.flatMap((child) => normalizeValue(child, depth, state));
  }
  if (!isRecord(value)) throw new Error('Invalid Yomitan structured content');

  if (value['type'] === 'text') {
    return normalizeValue(value['text'], depth, state);
  }
  if (value['type'] === 'image') {
    countNode(state, depth);
    return [imageNode(value)];
  }
  if (value['type'] === 'structured-content') {
    return normalizeValue(value['content'], depth, state);
  }

  const tag = value['tag'];
  if (tag === 'br') {
    countNode(state, depth);
    return [{ type: 'lineBreak' }];
  }
  if (tag === 'img') {
    countNode(state, depth);
    return [imageNode(value)];
  }
  if (tag === 'a') {
    const href = value['href'];
    if (typeof href !== 'string') throw new Error('Invalid Yomitan link');
    const children = normalizeValue(value['content'] ?? '', depth + 1, state);
    const label = plainText(children) || href;
    countNode(state, depth);
    if (href.startsWith('?')) {
      return [
        {
          type: 'link',
          label,
          target: { type: 'lookup', word: internalLookupWord(href, state.currentHeadword) },
        },
      ];
    }
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      throw new Error('Invalid Yomitan external link');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Unsafe Yomitan external link');
    }
    return [{ type: 'link', label, target: { type: 'external', url: url.href } }];
  }

  const allowedTags = [
    'p',
    'span',
    'div',
    'ruby',
    'rt',
    'rp',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'ol',
    'ul',
    'li',
    'details',
    'summary',
  ] as const;
  if (typeof tag !== 'string' || !allowedTags.includes(tag as (typeof allowedTags)[number])) {
    throw new Error(`Unsupported Yomitan content tag: ${String(tag)}`);
  }
  const children = normalizeValue(value['content'] ?? [], depth + 1, state);
  countNode(state, depth);
  const style = styleNode(value['style']);
  const title = optionalString(value['title'], 'element title');
  const lang = optionalString(value['lang'], 'element language');
  const colSpan = optionalPositiveNumber(value['colSpan'], 'column span');
  const rowSpan = optionalPositiveNumber(value['rowSpan'], 'row span');
  return [
    {
      type: 'element',
      tag: tag as (typeof allowedTags)[number],
      children,
      ...(title === undefined ? {} : { title }),
      ...(value['open'] === true ? { open: true } : {}),
      ...(lang === undefined ? {} : { lang }),
      ...(colSpan === undefined ? {} : { colSpan }),
      ...(rowSpan === undefined ? {} : { rowSpan }),
      ...(Object.keys(style).length === 0 ? {} : { style }),
    },
  ];
};

export const normalizeYomitanGlossary = (
  glossary: unknown[],
  currentHeadword?: string,
): DictionaryContentNode[] => {
  const state: NormalizeState = {
    nodes: 0,
    ...(currentHeadword === undefined ? {} : { currentHeadword }),
  };
  return glossary.flatMap((value) => normalizeValue(value, 1, state));
};

export const collectYomitanResourceRefs = (nodes: DictionaryContentNode[]): string[] => {
  const refs = new Set<string>();
  const visit = (node: DictionaryContentNode): void => {
    if (node.type === 'image') refs.add(node.resourceRef);
    else if (node.type === 'element') node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return [...refs];
};
