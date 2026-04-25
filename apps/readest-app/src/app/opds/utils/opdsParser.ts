import {
  REL,
  SYMBOL,
  OPDSFeed,
  OPDSPublication,
  OPDSGenericLink,
  OPDSSearch,
  OPDSPrice,
  OPDSIndirectAcquisition,
  OPDSAcquisitionLink,
  OPDSStreamLink,
  OPDSNavigationItem,
  OPDSGroup,
  OPDSFacetLink,
} from '@/types/opds';

const NS = {
  ATOM: 'http://www.w3.org/2005/Atom',
  OPDS: 'http://opds-spec.org/2010/catalog',
  THR: 'http://purl.org/syndication/thread/1.0',
  DC: 'http://purl.org/dc/elements/1.1/',
  DCTERMS: 'http://purl.org/dc/terms/',
  FH: 'http://purl.org/syndication/history/1.0',
  PSE: 'http://vaemendis.net/opds-pse/ns',
  OS: 'http://a9.com/-/spec/opensearch/1.1/',
};

const MIME = {
  ATOM: 'application/atom+xml',
  OPDS2: 'application/opds+json',
};

const FACET_GROUP = Symbol('facetGroup');

export const groupByArray = <T, K>(arr: T[] | undefined, f: (el: T) => K | K[]): Map<K, T[]> => {
  const map = new Map<K, T[]>();
  if (arr) {
    for (const el of arr) {
      const keys = f(el);
      const keyArray = Array.isArray(keys) ? keys : [keys];
      for (const key of keyArray) {
        const group = map.get(key as K);
        if (group) group.push(el);
        else map.set(key as K, [el]);
      }
    }
  }
  return map;
};

const parseMediaType = (str?: string | null) => {
  if (!str) return undefined;
  const [mediaType, ...ps] = str.split(/ *; */);
  if (!mediaType) return undefined;
  return {
    mediaType: mediaType.toLowerCase(),
    parameters: ps.reduce(
      (acc, p) => {
        const [name, val] = p.split('=');
        if (name) {
          acc[name.toLowerCase()] = val?.replace(/(^"|"$)/g, '');
        }
        return acc;
      },
      {} as Record<string, string | undefined>,
    ),
  };
};

export const isOPDSCatalog = (str?: string | null) => {
  const parsed = parseMediaType(str);
  if (!parsed) return false;
  const { mediaType, parameters } = parsed;
  if (mediaType === MIME.OPDS2) return true;
  return mediaType === MIME.ATOM && parameters['profile']?.toLowerCase() === 'opds-catalog';
};

export const isOPDSSearch = (str?: string | null) => {
  const parsed = parseMediaType(str);
  if (!parsed) return false;
  const { mediaType } = parsed;
  return mediaType === MIME.ATOM;
};

const useNS = (doc: Document, ns: string) =>
  doc.lookupNamespaceURI(null) === ns || doc.lookupPrefix(ns) ? ns : undefined;

const filterNS = (ns?: string) =>
  ns
    ? (name: string) => (el: Element) => el.namespaceURI === ns && el.localName === name
    : (name: string) => (el: Element) => el.localName === name;

const getContent = (el?: Element | null) => {
  if (!el) return undefined;
  const type = el.getAttribute('type') ?? 'text';
  const value =
    type === 'xhtml'
      ? el.innerHTML
      : type === 'html'
        ? el.textContent?.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
        : el.textContent;
  return { value: value || '', type: type as 'text' | 'html' | 'xhtml' };
};

const getTextContent = (el?: Element | null) => {
  const content = getContent(el);
  if (content?.type === 'text') return content.value;
  return undefined;
};

const getSummary = (a?: Element | null, b?: Element | null) =>
  getTextContent(a) ?? getTextContent(b);

const getDirectChildren = (
  el: Element,
  ns: string,
  localName: string,
  tagName: string,
): Element[] => {
  return Array.from(el.childNodes).filter((node): node is Element => {
    if (node.nodeType !== 1) return false; // Node.ELEMENT_NODE
    const element = node as Element;
    return (
      (element.namespaceURI === ns && element.localName === localName) ||
      element.tagName === tagName
    );
  });
};

const getPrice = (link: Element): OPDSPrice | OPDSPrice[] | undefined => {
  const prices = getDirectChildren(link, NS.OPDS, 'price', 'opds:price');
  if (!prices.length) return undefined;
  const parsed = prices.map((price) => ({
    currency: price.getAttribute('currencycode') ?? undefined,
    value: parseFloat(price.textContent || '0'),
  }));
  return parsed.length === 1 ? parsed[0] : parsed;
};

const getIndirectAcquisition = (el: Element): OPDSIndirectAcquisition[] => {
  const ias = getDirectChildren(el, NS.OPDS, 'indirectAcquisition', 'opds:indirectAcquisition');
  if (!ias.length) return [];

  const results: OPDSIndirectAcquisition[] = [];
  for (const ia of ias) {
    const type = ia.getAttribute('type');
    if (type) {
      results.push({
        type,
        child: getIndirectAcquisition(ia),
      });
    }
  }
  return results;
};

const getLink = (link: Element) => {
  const relAttr = link.getAttribute('rel');
  const rel = relAttr ? relAttr.split(/ +/) : undefined;

  const isAcquisition = rel?.some((r) => r.startsWith(REL.ACQ) || r === 'preview');
  const isStream = rel?.includes(REL.STREAM);

  const activeFacet =
    link.getAttributeNS(NS.OPDS, 'activeFacet') || link.getAttribute('opds:activeFacet');
  const mappedRel = activeFacet === 'true' ? [rel ?? []].flat().concat('self') : rel;

  const thrCount = link.getAttributeNS(NS.THR, 'count') || link.getAttribute('thr:count');
  const fallbackCount = link.getAttribute('count');

  const pseCount = link.getAttributeNS(NS.PSE, 'count') || link.getAttribute('pse:count');
  const pseLastRead = link.getAttributeNS(NS.PSE, 'lastRead') || link.getAttribute('pse:lastRead');
  const pseLastReadDate =
    link.getAttributeNS(NS.PSE, 'lastReadDate') || link.getAttribute('pse:lastReadDate');

  return {
    rel: mappedRel,
    href: link.getAttribute('href') ?? undefined,
    type: link.getAttribute('type') ?? undefined,
    title: link.getAttribute('title') ?? undefined,
    [FACET_GROUP as symbol]:
      link.getAttributeNS(NS.OPDS, 'facetGroup') ||
      link.getAttribute('opds:facetGroup') ||
      undefined,
    properties: {
      price: isAcquisition || isStream ? getPrice(link) : undefined,
      indirectAcquisition: isAcquisition || isStream ? getIndirectAcquisition(link) : undefined,
      numberOfItems:
        thrCount != null
          ? Number(thrCount)
          : !isStream && fallbackCount != null
            ? Number(fallbackCount)
            : undefined,
      'pse:count':
        isStream && (pseCount ?? fallbackCount) != null
          ? Number(pseCount ?? fallbackCount)
          : undefined,
      'pse:lastRead': isStream && pseLastRead != null ? Number(pseLastRead) : undefined,
      'pse:lastReadDate': isStream ? (pseLastReadDate ?? undefined) : undefined,
    },
  };
};

const getPerson = (person: Element) => {
  const ns = person.namespaceURI;
  const uri = ns ? person.getElementsByTagNameNS(ns, 'uri')[0]?.textContent : undefined;
  return {
    name: ns ? (person.getElementsByTagNameNS(ns, 'name')[0]?.textContent ?? undefined) : undefined,
    links: uri ? [{ href: uri }] : [],
  };
};

export const getPublication = (entry: Element): OPDSPublication => {
  const filter = filterNS(useNS(entry.ownerDocument, NS.ATOM));
  const children = Array.from(entry.children);
  const filterDCEL = filterNS(NS.DC);
  const filterDCTERMS = filterNS(NS.DCTERMS);
  const filterDC = (x: string) => (y: Element) => filterDCEL(x)(y) || filterDCTERMS(x)(y);

  const links = children.filter(filter('link')).map(getLink);
  const linksByRel = groupByArray(links, (link) => link.rel || []);

  // OPDS 2.0 Mapping
  const summaryEl = children.find(filter('summary'));
  const contentEl = children.find(filter('content'));

  return {
    metadata: {
      title: children.find(filter('title'))?.textContent ?? undefined,
      author: children.filter(filter('author')).map(getPerson),
      contributor: children.filter(filter('contributor')).map(getPerson),
      publisher: children.find(filterDC('publisher'))?.textContent ?? undefined,
      published:
        (children.find(filterDCTERMS('issued')) ?? children.find(filterDC('date')))?.textContent ??
        undefined,
      language: children.find(filterDC('language'))?.textContent ?? undefined,
      identifier: children.find(filterDC('identifier'))?.textContent ?? undefined,
      subject: children.filter(filter('category')).map((category) => ({
        name: category.getAttribute('label') ?? undefined,
        code: category.getAttribute('term') ?? undefined,
        scheme: category.getAttribute('scheme') ?? undefined,
      })),
      rights: children.find(filter('rights'))?.textContent ?? undefined,
      // OPDS 2.0 uses description natively
      description: getSummary(summaryEl, contentEl),
      [SYMBOL.CONTENT]: getContent(contentEl ?? summaryEl) ?? undefined,
    },
    links: links as Array<OPDSAcquisitionLink | OPDSStreamLink | OPDSGenericLink>,
    images: [...REL.COVER, ...REL.THUMBNAIL]
      .map((R) => linksByRel.get(R)?.[0])
      .filter(Boolean) as OPDSGenericLink[],
  };
};

export const getFeed = (doc: Document): OPDSFeed => {
  const ns = useNS(doc, NS.ATOM);
  const filter = filterNS(ns);
  const children = Array.from(doc.documentElement.children);
  const entries = children.filter(filter('entry'));
  const links = children.filter(filter('link')).map(getLink);
  const linksByRel = groupByArray(links, (link) => link.rel || []);

  const filterFH = filterNS(NS.FH);
  const filterOS = filterNS(NS.OS);

  const groupedItems = new Map<string | undefined, Array<OPDSPublication | OPDSNavigationItem>>([
    [undefined, []],
  ]);
  const groupLinkMap = new Map<string, OPDSGenericLink>();

  for (const entry of entries) {
    const entryChildren = Array.from(entry.children);
    const entryLinks = entryChildren.filter(filter('link')).map(getLink);
    const entryLinksByRel = groupByArray(entryLinks, (link) => link.rel || []);

    const isPub = Array.from(entryLinksByRel.keys()).some((rel) => {
      return rel.startsWith(REL.ACQ) || rel === 'preview' || rel === REL.STREAM;
    });

    const groupLinks = entryLinksByRel.get(REL.GROUP) ?? entryLinksByRel.get('collection');
    const groupLink = groupLinks?.length
      ? (groupLinks.find((link) => groupedItems.has(link.href)) ?? groupLinks[0])
      : undefined;

    if (groupLink && groupLink.href && !groupLinkMap.has(groupLink.href)) {
      groupLinkMap.set(groupLink.href, groupLink as OPDSGenericLink);
    }

    const item = isPub
      ? getPublication(entry)
      : (Object.assign(entryLinks.find((link) => isOPDSCatalog(link.type)) ?? entryLinks[0] ?? {}, {
          title: entryChildren.find(filter('title'))?.textContent ?? undefined,
          [SYMBOL.SUMMARY]:
            getSummary(
              entryChildren.find(filter('summary')),
              entryChildren.find(filter('content')),
            ) ?? undefined,
        }) as OPDSNavigationItem);

    const arr = groupedItems.get(groupLink?.href);
    if (arr) arr.push(item);
    else if (groupLink?.href) groupedItems.set(groupLink.href, [item]);
  }

  const groupsList: OPDSGroup[] = [];
  const standaloneItems: Partial<Pick<OPDSFeed, 'publications' | 'navigation'>> = {};

  Array.from(groupedItems.entries()).forEach(([key, items]) => {
    const isPubs = items.length > 0 && 'metadata' in items[0];

    if (key === undefined) {
      if (isPubs) {
        standaloneItems.publications = items as OPDSPublication[];
      } else {
        standaloneItems.navigation = items as OPDSNavigationItem[];
      }
    } else {
      const link = groupLinkMap.get(key);
      const group: OPDSGroup = {
        metadata: {
          title: link?.title,
          numberOfItems: link?.properties?.numberOfItems,
        },
        links: [{ rel: ['self'], href: link?.href, type: link?.type }],
      };

      if (isPubs) {
        group.publications = items as OPDSPublication[];
      } else {
        group.navigation = items as OPDSNavigationItem[];
      }

      groupsList.push(group);
    }
  });

  const totalResults = children.find(filterOS('totalResults'))?.textContent;
  const itemsPerPage = children.find(filterOS('itemsPerPage'))?.textContent;
  const startIndex = children.find(filterOS('startIndex'))?.textContent;

  let currentPage;
  if (startIndex != null && itemsPerPage != null) {
    const start = Number(startIndex);
    const items = Number(itemsPerPage);
    currentPage = Math.floor((start > 0 ? start - 1 : 0) / items) + 1;
  }

  return {
    metadata: {
      title: children.find(filter('title'))?.textContent ?? undefined,
      subtitle: children.find(filter('subtitle'))?.textContent ?? undefined,
      numberOfItems: totalResults != null ? Number(totalResults) : undefined,
      itemsPerPage: itemsPerPage != null ? Number(itemsPerPage) : undefined,
      currentPage,
    },
    links: links as OPDSGenericLink[],
    isComplete: !!children.find(filterFH('complete')) || undefined,
    isArchive: !!children.find(filterFH('archive')) || undefined,
    ...standaloneItems,
    groups: groupsList.length ? groupsList : undefined,
    facets: Array.from(
      groupByArray(
        linksByRel.get(REL.FACET) ?? [],
        (link) => link[FACET_GROUP as keyof typeof link],
      ),
      ([facet, linksArr]) => ({
        metadata: { title: facet as string | undefined },
        links: linksArr as OPDSFacetLink[],
      }),
    ),
  };
};

export const getSearch = async (link: OPDSGenericLink): Promise<OPDSSearch> => {
  // @ts-ignore
  const { replace, getVariables } = await import('foliate-js/uri-template.js');
  return {
    metadata: {
      title: link.title ?? undefined,
    },
    search: (map: Map<string | undefined, Map<string, string>>) =>
      replace(link.href || '', map.get(undefined)),
    params: Array.from(getVariables(link.href || ''), (name: string) => ({ name })),
  };
};

export const getOpenSearch = (doc: Document): OPDSSearch => {
  const defaultNS = doc.documentElement.namespaceURI || undefined;
  const filter = filterNS(defaultNS);
  const children = Array.from(doc.documentElement.children);

  const $$urls = children.filter(filter('Url'));
  const $url = $$urls.find((url) => isOPDSCatalog(url.getAttribute('type'))) ?? $$urls[0];
  if (!$url) throw new Error('document must contain at least one Url element');

  const regex = /{(?:([^}]+?):)?(.+?)(\?)?}/g;
  const defaultMap = new Map([
    ['count', '100'],
    ['startIndex', $url.getAttribute('indexOffset') ?? '0'],
    ['startPage', $url.getAttribute('pageOffset') ?? '0'],
    ['language', '*'],
    ['inputEncoding', 'UTF-8'],
    ['outputEncoding', 'UTF-8'],
  ]);

  const template = $url.getAttribute('template') || '';
  return {
    metadata: {
      title:
        (children.find(filter('LongName')) ?? children.find(filter('ShortName')))?.textContent ??
        undefined,
      description: children.find(filter('Description'))?.textContent ?? undefined,
    },
    search: (map: Map<string | undefined, Map<string, string>>) =>
      template.replace(regex, (_, prefix, param) => {
        const namespace = prefix ? $url.lookupNamespaceURI(prefix) : undefined;
        const ns = namespace === defaultNS ? undefined : namespace;
        const val = map.get(ns ?? undefined)?.get(param);
        return encodeURIComponent(val ?? (!ns ? (defaultMap.get(param) ?? '') : ''));
      }),
    params: Array.from(template.matchAll(regex), ([, prefix, param, optional]) => {
      const namespace = prefix ? $url.lookupNamespaceURI(prefix) : undefined;
      const ns = namespace === defaultNS ? undefined : namespace;
      const safeParam = param || '';
      return {
        ns: ns || undefined,
        name: safeParam,
        required: !optional,
        value: ns && ns !== defaultNS ? undefined : (defaultMap.get(safeParam) ?? undefined),
      };
    }),
  };
};
