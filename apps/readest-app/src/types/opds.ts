export const REL = {
  ACQ: 'http://opds-spec.org/acquisition',
  FACET: 'http://opds-spec.org/facet',
  GROUP: 'http://opds-spec.org/group',
  COVER: ['http://opds-spec.org/image', 'http://opds-spec.org/cover'],
  THUMBNAIL: ['http://opds-spec.org/image/thumbnail', 'http://opds-spec.org/thumbnail'],
};

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
}

export interface OPDSFeed {
  metadata: {
    title?: string;
    subtitle?: string;
  };
  links: OPDSLink[];
  navigation?: OPDSNavigationItem[];
  publications?: OPDSPublication[];
  groups?: OPDSGroup[];
  facets?: OPDSFacet[];
}

export interface OPDSPublication {
  metadata: {
    title: string;
    subtitle?: string;
    author?: OPDSPerson[];
    description?: string;
    contributor?: OPDSPerson[];
    publisher?: string | OPDSPerson;
    published?: string;
    language?: string;
    identifier?: string;
    subject?: OPDSSubject[];
    rights?: string;
    [SYMBOL.CONTENT]?: OPDSContent;
  };
  links: OPDSLink[];
  images: OPDSLink[];
}

export interface OPDSSearch {
  metadata: {
    title?: string;
    description?: string;
  };
  search: (map: Map<string | null, Map<string | null, string>>) => string;
  params: OPDSSearchParam[];
}

export interface OPDSLink {
  rel?: string | string[];
  href: string;
  type?: string;
  title?: string;
  properties: {
    price?: {
      currency: string;
      value: string;
    } | null;
    indirectAcquisition?: Array<{ type: string }>;
    numberOfItems?: string;
  };
}

interface OPDSPerson {
  name: string;
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

export interface OPDSNavigationItem extends Partial<OPDSLink> {
  title?: string;
  [SYMBOL.SUMMARY]?: string;
}

interface OPDSGroup {
  metadata: {
    title?: string;
    numberOfItems?: string;
  };
  links: Array<{ rel: string; href: string; type?: string }>;
  publications?: OPDSPublication[];
  navigation?: OPDSNavigationItem[];
}

export interface OPDSFacet {
  metadata: {
    title?: string;
  };
  links: OPDSLink[];
}

interface OPDSSearchParam {
  ns?: string | null;
  name: string;
  required?: boolean;
  value?: string;
}
