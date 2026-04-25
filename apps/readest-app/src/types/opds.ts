export const REL = {
  ACQ: 'http://opds-spec.org/acquisition',
  FACET: 'http://opds-spec.org/facet',
  GROUP: 'http://opds-spec.org/group',
  COVER: ['http://opds-spec.org/image', 'http://opds-spec.org/cover', 'x-stanza-cover-image'],
  THUMBNAIL: [
    'http://opds-spec.org/image/thumbnail',
    'http://opds-spec.org/thumbnail',
    'x-stanza-cover-image-thumbnail',
  ],
  STREAM: 'http://vaemendis.net/opds-pse/stream',
} as const;

const SUMMARY = Symbol('summary');
const CONTENT = Symbol('content');

export const SYMBOL = {
  SUMMARY,
  CONTENT,
} as const;

export interface OPDSCatalog {
  id: string;
  name: string;
  url: string;
  description?: string;
  disabled?: boolean;
  icon?: string;
  username?: string;
  password?: string;
  customHeaders?: Record<string, string>;
  autoDownload?: boolean;
}

export interface OPDSFeed {
  metadata: {
    id?: string;
    updated?: string;
    title?: string;
    subtitle?: string;
    numberOfItems?: number;
    itemsPerPage?: number;
    currentPage?: number;
  };
  links: OPDSGenericLink[];
  isComplete?: boolean;
  isArchive?: boolean;
  navigation?: OPDSNavigationItem[];
  publications?: OPDSPublication[];
  groups?: OPDSGroup[];
  facets?: OPDSFacet[];
}

export interface OPDSPublication {
  metadata: {
    id?: string;
    updated?: string;
    title?: string;
    subtitle?: string;
    description?: string;
    content?: OPDSContent;
    author?: OPDSPerson[];
    contributor?: OPDSPerson[];
    publisher?: string | OPDSPerson | OPDSPerson[];
    published?: string;
    language?: string | string[];
    identifier?: string;
    subject?: OPDSSubject[];
    rights?: string;
    [SYMBOL.CONTENT]?: OPDSContent;
  };
  links: Array<OPDSAcquisitionLink | OPDSStreamLink | OPDSGenericLink>;
  images: OPDSGenericLink[];
}

export interface OPDSSearch {
  metadata: {
    title?: string;
    description?: string;
  };
  search: (map: Map<string | undefined, Map<string, string>>) => string;
  params: OPDSSearchParam[];
}

export interface OPDSBaseLink {
  rel?: string | string[];
  href?: string;
  type?: string;
  title?: string;
}

interface OPDSPerson {
  name?: string;
  links: Array<{ href: string }>;
}

interface OPDSSubject {
  name?: string;
  code?: string;
  scheme?: string;
}

interface OPDSContent {
  value: string;
  type: 'text' | 'html' | 'xhtml';
}

export interface OPDSGenericLink extends OPDSBaseLink {
  properties?: {
    price?: undefined;
    indirectAcquisition?: undefined;
    numberOfItems?: number;
    'pse:count'?: undefined;
    'pse:lastRead'?: undefined;
    'pse:lastReadDate'?: undefined;
  };
}

export interface OPDSAcquisitionLink extends OPDSBaseLink {
  properties?: {
    price?: OPDSPrice | OPDSPrice[];
    indirectAcquisition?: OPDSIndirectAcquisition[];
    numberOfItems?: number;
    'pse:count'?: undefined;
    'pse:lastRead'?: undefined;
    'pse:lastReadDate'?: undefined;
  };
}

export interface OPDSStreamLink extends OPDSBaseLink {
  properties?: {
    price?: OPDSPrice | OPDSPrice[];
    indirectAcquisition?: OPDSIndirectAcquisition[];
    numberOfItems?: number;
    'pse:count'?: number;
    'pse:lastRead'?: number;
    'pse:lastReadDate'?: string;
  };
}

export interface OPDSFacetLink extends OPDSBaseLink {
  properties?: {
    price?: undefined;
    indirectAcquisition?: undefined;
    numberOfItems?: number;
    'pse:count'?: undefined;
    'pse:lastRead'?: undefined;
    'pse:lastReadDate'?: undefined;
  };
}

export interface OPDSNavigationItem extends OPDSGenericLink {
  title?: string;
  [SYMBOL.SUMMARY]?: string;
}

export interface OPDSGroup {
  metadata: {
    title?: string;
    numberOfItems?: number;
  };
  links: OPDSGenericLink[];
  publications?: OPDSPublication[];
  navigation?: OPDSNavigationItem[];
}

export interface OPDSFacet {
  metadata: {
    title?: string;
  };
  links: OPDSFacetLink[];
}

interface OPDSSearchParam {
  ns?: string;
  name: string;
  required?: boolean;
  value?: string;
}

export interface OPDSPrice {
  currency?: string;
  value: number;
}

export interface OPDSIndirectAcquisition {
  type: string;
  child?: OPDSIndirectAcquisition[];
}
