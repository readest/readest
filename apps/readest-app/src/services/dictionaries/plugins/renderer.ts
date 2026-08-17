import DOMPurify from 'dompurify';
import {
  parseDictionaryLookupResult,
  MAX_PLUGIN_RESOURCE_BYTES,
  type DictionaryContentNode,
  type DictionaryLookupResult,
  type PluginResult,
} from '@/services/plugins/contract';

const hasPrefix = (bytes: Uint8Array, prefix: number[]): boolean =>
  prefix.every((value, index) => bytes[index] === value);

const hasAvifSignature = (bytes: Uint8Array): boolean => {
  if (bytes.byteLength < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0);
  const text = (offset: number): string =>
    new TextDecoder('ascii').decode(bytes.subarray(offset, offset + 4));
  if (boxSize < 16 || boxSize > bytes.byteLength || text(4) !== 'ftyp') return false;
  if (text(8) === 'avif' || text(8) === 'avis') return true;
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    if (text(offset) === 'avif' || text(offset) === 'avis') return true;
  }
  return false;
};

const assertRasterSignature = (mimeType: string, bytes: Uint8Array): void => {
  const valid =
    (mimeType === 'image/png' && hasPrefix(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) ||
    (mimeType === 'image/jpeg' && hasPrefix(bytes, [255, 216, 255])) ||
    (mimeType === 'image/gif' &&
      (new TextDecoder('ascii').decode(bytes.subarray(0, 6)) === 'GIF87a' ||
        new TextDecoder('ascii').decode(bytes.subarray(0, 6)) === 'GIF89a')) ||
    (mimeType === 'image/webp' &&
      new TextDecoder('ascii').decode(bytes.subarray(0, 4)) === 'RIFF' &&
      new TextDecoder('ascii').decode(bytes.subarray(8, 12)) === 'WEBP') ||
    (mimeType === 'image/avif' && hasAvifSignature(bytes));
  if (!valid) throw new Error(`Dictionary resource signature does not match ${mimeType}`);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 32 * 1_024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const createDictionaryResourceDataUrl = (
  mimeType: PluginResult<'readResource'>['mimeType'],
  bytes: Uint8Array,
): string => {
  if (bytes.byteLength > MAX_PLUGIN_RESOURCE_BYTES) {
    throw new Error('Dictionary resource exceeds size limit');
  }
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Unsupported dictionary resource type: ${mimeType}`);
  }
  let safeBytes = bytes;
  if (mimeType === 'image/svg+xml') {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const sanitized = DOMPurify.sanitize(source, {
      USE_PROFILES: { svg: true, svgFilters: false },
      ALLOWED_TAGS: [
        'svg',
        'g',
        'path',
        'rect',
        'circle',
        'ellipse',
        'line',
        'polyline',
        'polygon',
        'text',
        'tspan',
        'defs',
        'clipPath',
        'mask',
        'linearGradient',
        'radialGradient',
        'stop',
        'use',
      ],
      ALLOWED_ATTR: [
        'xmlns',
        'viewBox',
        'width',
        'height',
        'x',
        'y',
        'x1',
        'x2',
        'y1',
        'y2',
        'cx',
        'cy',
        'r',
        'rx',
        'ry',
        'd',
        'points',
        'fill',
        'fill-opacity',
        'stroke',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'opacity',
        'transform',
        'offset',
        'stop-color',
        'stop-opacity',
        'clip-path',
        'mask',
        'id',
      ],
      FORBID_TAGS: [
        'script',
        'foreignObject',
        'animate',
        'animateMotion',
        'animateTransform',
        'set',
      ],
      FORBID_ATTR: ['href', 'xlink:href', 'style'],
      ALLOW_DATA_ATTR: false,
    });
    if (!/<svg(?:\s|>)/iu.test(sanitized)) throw new Error('Dictionary SVG has no safe root');
    safeBytes = new TextEncoder().encode(sanitized);
  } else if (
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(mimeType)
  ) {
    assertRasterSignature(mimeType, bytes);
  }
  return `data:${mimeType};base64,${bytesToBase64(safeBytes)}`;
};

interface RenderOptions {
  onNavigate?: (word: string) => void;
  resolveResource: (resourceRef: string) => Promise<PluginResult<'readResource'>>;
}

interface RenderContext extends RenderOptions {
  resourceDataUrls: Map<string, Promise<string>>;
  resourceBytes: number;
}

const MAX_RENDERED_RESOURCE_BYTES = MAX_PLUGIN_RESOURCE_BYTES * 2;

const resolveResourceDataUrl = (resourceRef: string, context: RenderContext): Promise<string> => {
  const cached = context.resourceDataUrls.get(resourceRef);
  if (cached) return cached;
  const pending = (async () => {
    const resource = await context.resolveResource(resourceRef);
    if (context.resourceBytes + resource.bytes.byteLength > MAX_RENDERED_RESOURCE_BYTES) {
      throw new Error('Dictionary result resources exceed aggregate size limit');
    }
    const dataUrl = createDictionaryResourceDataUrl(resource.mimeType, resource.bytes);
    context.resourceBytes += resource.bytes.byteLength;
    return dataUrl;
  })();
  context.resourceDataUrls.set(resourceRef, pending);
  return pending;
};

const applyNodeStyle = (
  element: HTMLElement,
  style: Extract<DictionaryContentNode, { type: 'element' }>['style'],
): void => {
  if (!style) return;
  if (style.fontStyle) element.style.fontStyle = style.fontStyle;
  if (style.fontWeight) element.style.fontWeight = style.fontWeight;
  if (style.textDecorationLine) element.style.textDecorationLine = style.textDecorationLine;
  if (style.verticalAlign) element.style.verticalAlign = style.verticalAlign;
  if (style.textAlign) element.style.textAlign = style.textAlign;
};

const renderNode = async (node: DictionaryContentNode, context: RenderContext): Promise<Node> => {
  if (node.type === 'text') return document.createTextNode(node.value);
  if (node.type === 'lineBreak') return document.createElement('br');
  if (node.type === 'link') {
    const anchor = document.createElement('a');
    anchor.textContent = node.label;
    if (node.target.type === 'lookup') {
      anchor.href = '#';
      anchor.dataset['dictionaryLookup'] = node.target.word;
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        context.onNavigate?.(node.target.type === 'lookup' ? node.target.word : '');
      });
    } else {
      anchor.href = node.target.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
    return anchor;
  }
  if (node.type === 'image') {
    const image = document.createElement('img');
    image.alt = node.alt ?? '';
    if (node.title) image.title = node.title;
    if (node.width) image.style.width = `${node.width}${node.sizeUnits ?? 'px'}`;
    if (node.height) image.style.height = `${node.height}${node.sizeUnits ?? 'px'}`;
    if (node.imageRendering) image.style.imageRendering = node.imageRendering;
    if (node.appearance === 'monochrome') image.classList.add('dictionary-image-monochrome');
    try {
      image.src = await resolveResourceDataUrl(node.resourceRef, context);
    } catch {
      image.dataset['resourceError'] = 'true';
    }
    return image;
  }
  const element = document.createElement(node.tag);
  if (node.title) element.title = node.title;
  if (node.open && element instanceof HTMLDetailsElement) element.open = true;
  if (node.lang) element.lang = node.lang;
  if (node.colSpan && element instanceof HTMLTableCellElement) element.colSpan = node.colSpan;
  if (node.rowSpan && element instanceof HTMLTableCellElement) element.rowSpan = node.rowSpan;
  applyNodeStyle(element, node.style);
  for (const child of node.children) element.append(await renderNode(child, context));
  return element;
};

export const renderPluginDictionaryResult = async (
  container: HTMLElement,
  value: DictionaryLookupResult,
  options: RenderOptions,
): Promise<void> => {
  const result = parseDictionaryLookupResult(value);
  const context: RenderContext = {
    ...options,
    resourceDataUrls: new Map(),
    resourceBytes: 0,
  };
  const fragment = document.createDocumentFragment();
  for (const entry of result.entries) {
    const article = document.createElement('article');
    article.className = 'dictionary-plugin-entry';
    const heading = document.createElement('div');
    heading.className = 'dictionary-plugin-heading';
    const expression = document.createElement('strong');
    expression.textContent = entry.expression;
    heading.append(expression);
    if (entry.reading && entry.reading !== entry.expression) {
      const reading = document.createElement('span');
      reading.className = 'dictionary-plugin-reading';
      reading.textContent = ` ${entry.reading}`;
      heading.append(reading);
    }
    article.append(heading);

    if (entry.tags?.length) {
      const tags = document.createElement('div');
      tags.className = 'dictionary-plugin-tags';
      for (const tag of entry.tags) {
        const badge = document.createElement('span');
        badge.textContent = tag.name;
        if (tag.notes) badge.title = tag.notes;
        tags.append(badge);
      }
      article.append(tags);
    }
    const metadata = document.createElement('div');
    metadata.className = 'dictionary-plugin-metadata';
    const parts: string[] = [];
    if (entry.frequencies?.length) {
      parts.push(
        `Frequency: ${entry.frequencies
          .map((frequency) => frequency.displayValue ?? String(frequency.value))
          .join(', ')}`,
      );
    }
    if (entry.pitches?.length) {
      parts.push(`Pitch: ${entry.pitches.map((pitch) => String(pitch.position)).join(', ')}`);
    }
    if (entry.ipa?.length) parts.push(`IPA: ${entry.ipa.map((item) => item.value).join(', ')}`);
    if (entry.deinflection?.length) parts.push(entry.deinflection.join(' → '));
    metadata.textContent = parts.join(' · ');
    if (parts.length > 0) article.append(metadata);

    const definitions = document.createElement('div');
    definitions.className = 'dictionary-plugin-definitions';
    for (const definition of entry.definitions) {
      definitions.append(await renderNode(definition, context));
    }
    article.append(definitions);
    fragment.append(article);
  }
  container.replaceChildren(fragment);
};
