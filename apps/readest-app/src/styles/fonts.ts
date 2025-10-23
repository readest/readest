import { isCJKEnv } from '@/utils/misc';
import { getFilename } from '@/utils/path';
import { md5Fingerprint } from '@/utils/md5';

export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2';

const basicGoogleFonts = [
  { family: 'Bitter', weights: 'ital,wght@0,100..900;1,100..900' },
  { family: 'Fira Code', weights: 'wght@300..700' },
  { family: 'Literata', weights: 'ital,opsz,wght@0,7..72,200..900;1,7..72,200..900' },
  { family: 'Merriweather', weights: 'ital,opsz,wght@0,18..144,300..900;1,18..144,300..900' },
  { family: 'Noto Sans', weights: 'ital,wght@0,100..900;1,100..900' },
  { family: 'Open Sans', weights: 'ital,wght@0,300..800;1,300..800' },
  { family: 'Roboto', weights: 'ital,wght@0,100..900;1,100..900' },
  { family: 'Roboto Slab', weights: 'ital,wght@0,100..900;1,100..900' },
  { family: 'Vollkorn', weights: 'ital,wght@0,400..900;1,400..900' },
  { family: 'PT Sans', weights: 'ital,wght@0,400;0,700;1,400;1,700' },
  { family: 'PT Serif', weights: 'ital,wght@0,400;0,700;1,400;1,700' },
  { family: 'PT Mono', weights: '' },
];

const cjkGoogleFonts = [
  { family: 'LXGW WenKai TC', weights: '' },
  { family: 'Noto Sans SC', weights: '' },
  { family: 'Noto Sans TC', weights: '' },
  { family: 'Noto Serif JP', weights: '' },
];

const getAdditionalBasicFontLinks = () => `
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${basicGoogleFonts
    .map(
      ({ family, weights }) =>
        `family=${encodeURIComponent(family)}${weights ? `:${weights}` : ''}`,
    )
    .join('&')}&display=swap" crossorigin="anonymous">
`;

const getAdditionalCJKFontLinks = () => `
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/misans-webfont@1.0.4/misans-l3/misans-l3/result.min.css" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/lxgw-wenkai-screen-web/1.520.0/lxgwwenkaigbscreen/result.css" crossorigin="anonymous" />
  <link rel='stylesheet' href='https://chinese-fonts-cdn.netlify.app/packages/hwmct/dist/%E6%B1%87%E6%96%87%E6%98%8E%E6%9C%9D%E4%BD%93/result.css' crossorigin="anonymous" />
  <link rel='stylesheet' href='https://chinese-fonts-cdn.netlify.app/packages/jhlst/dist/%E4%BA%AC%E8%8F%AF%E8%80%81%E5%AE%8B%E4%BD%93v2_002/result.css' crossorigin="anonymous" />
  <link rel='stylesheet' href='https://chinese-fonts-cdn.netlify.app/packages/syst/dist/SourceHanSerifCN/result.css' crossorigin="anonymous" />
  <link rel='stylesheet' href='https://chinese-fonts-cdn.netlify.app/packages/GuanKiapTsingKhai/dist/GuanKiapTsingKhai-T/result.css' crossorigin="anonymous" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${cjkGoogleFonts
    .map(
      ({ family, weights }) =>
        `family=${encodeURIComponent(family)}${weights ? `:${weights}` : ''}`,
    )
    .join('&')}&display=swap" crossorigin="anonymous" />
`;

const getAdditionalCJKFontFaces = () => `
  @font-face {
    font-family: "FangSong";
    font-display: swap;
    src: local("Fang Song"), local("FangSong"), local("Noto Serif CJK"), local("Source Han Serif SC VF"), url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.eot");
    src: url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.eot?#iefix") format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.woff2") format("woff2"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.woff") format("woff"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.ttf") format("truetype"),
    url("https://db.onlinewebfonts.com/t/2ecbfe1d9bfc191c6f15c0ccc23cbd43.svg#FangSong") format("svg");
  }
  @font-face {
    font-family: "Kaiti";
    font-display: swap;
    src: local("Kai"), local("KaiTi"), local("AR PL UKai"), local("LXGW WenKai GB Screen"), url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.eot");
    src: url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.eot?#iefix")format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.woff2")format("woff2"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.woff")format("woff"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.ttf")format("truetype"),
    url("https://db.onlinewebfonts.com/t/1ee9941f1b8c128110ca4307dda59917.svg#STKaiti")format("svg");
  }
  @font-face {
    font-family: "Heiti";
    font-display: swap;
    src: local("Hei"), local("SimHei"), local("WenQuanYi Zen Hei"), local("Source Han Sans SC VF"), url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.eot");
    src: url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.eot?#iefix")format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.woff2")format("woff2"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.woff")format("woff"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.ttf")format("truetype"),
    url("https://db.onlinewebfonts.com/t/a4948b9d43a91468825a5251df1ec58d.svg#WenQuanYi Micro Hei")format("svg");
  }
  @font-face {
    font-family: "XiHeiti";
    font-display: swap;
    src: local("PingFang SC"), local("Microsoft YaHei"), local("WenQuanYi Micro Hei"), local("FZHei-B01"), url("https://db.onlinewebfonts.com/t/4f0b783ba4a1b381fc7e7af81ecab481.eot");
    src: url("https://db.onlinewebfonts.com/t/4f0b783ba4a1b381fc7e7af81ecab481.eot?#iefix")format("embedded-opentype"),
    url("https://db.onlinewebfonts.com/t/4f0b783ba4a1b381fc7e7af81ecab481.woff2")format("woff2"),
    url("https://db.onlinewebfonts.com/t/4f0b783ba4a1b381fc7e7af81ecab481.woff")format("woff"),
    url("https://db.onlinewebfonts.com/t/4f0b783ba4a1b381fc7e7af81ecab481.ttf")format("truetype"),
    url("https://db.onlinewebfonts.com/t/4f0b783ba4a1b381fc7e7af81ecab481.svg#STHeiti J Light")format("svg");
}
`;

export const mountAdditionalFonts = (document: Document, isCJK = false) => {
  const mountCJKFonts = isCJK || isCJKEnv();
  let links = getAdditionalBasicFontLinks();
  if (mountCJKFonts) {
    const style = document.createElement('style');
    style.textContent = getAdditionalCJKFontFaces();
    document.head.appendChild(style);

    links = `${links}\n${getAdditionalCJKFontLinks()}`;
  }

  const parser = new DOMParser();
  const parsedDocument = parser.parseFromString(links, 'text/html');

  Array.from(parsedDocument.head.children).forEach((child) => {
    if (child.tagName === 'LINK') {
      const link = document.createElement('link');
      link.rel = child.getAttribute('rel') || '';
      link.href = child.getAttribute('href') || '';
      link.crossOrigin = child.getAttribute('crossorigin') || '';

      document.head.appendChild(link);
    }
  });
};

export type FontStyle = 'normal' | 'italic' | 'oblique';

export interface CustomFont {
  id: string;
  name: string;
  path: string;
  family?: string;
  style?: string;
  weight?: number;
  variable?: boolean;

  downloadedAt?: number;
  deletedAt?: number;

  blobUrl?: string;
  loaded?: boolean;
  error?: string;
}

export type CustomFontInfo = Partial<CustomFont> &
  Required<Pick<CustomFont, 'path' | 'name' | 'family' | 'style' | 'weight' | 'variable'>>;

export function getFontName(path: string): string {
  const fileName = getFilename(path);
  return fileName.replace(/\.(ttf|otf|woff|woff2)$/i, '');
}

export function getFontId(name: string): string {
  return md5Fingerprint(name);
}

export function getFontFormat(path: string): FontFormat {
  const extension = path.toLowerCase().split('.').pop();
  switch (extension) {
    case 'ttf':
      return 'ttf';
    case 'otf':
      return 'otf';
    case 'woff':
      return 'woff';
    case 'woff2':
      return 'woff2';
    default:
      return 'ttf';
  }
}

export function getMimeType(format: FontFormat): string {
  const types = { ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2' };
  return types[format] || 'font/ttf';
}

export function getCSSFormatString(format: FontFormat): string {
  const formats = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };
  return formats[format] || 'truetype';
}

export function createFontFamily(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function createFontCSS(font: CustomFont): string {
  const format = getFontFormat(font.path);
  const cssFormat = getCSSFormatString(format);
  const fontFamily = createFontFamily(font.family || font.name);
  const fontStyle = font.style || 'normal';
  const fontWeight = font.weight || 400;
  const variable = font.variable || false;
  if (!font.blobUrl) {
    throw new Error(`Blob URL not available for font: ${font.name}`);
  }

  const css = `
    @font-face {
      font-family: "${fontFamily}";
      ${variable ? '' : `font-style: ${fontStyle};`}
      ${variable ? '' : `font-weight: ${fontWeight};`}
      src: url("${font.blobUrl}") format("${cssFormat}");
      font-display: swap;
    }
  `;

  return css;
}

export function createCustomFont(
  path: string,
  options?: Partial<Omit<CustomFont, 'id' | 'path'>>,
): CustomFont {
  const name = options?.name || getFontName(path);
  return {
    id: getFontId(name),
    name,
    family: options?.family,
    style: options?.style,
    weight: options?.weight,
    variable: options?.variable,
    path,
  };
}

export const mountCustomFont = (document: Document, font: CustomFont) => {
  const fontStyleId = `custom-font-${font.id}`;
  const styleElement = document.getElementById(fontStyleId) || document.createElement('style');
  styleElement.id = fontStyleId;
  styleElement.textContent = createFontCSS(font);

  if (!styleElement.parentNode) {
    document.head.appendChild(styleElement);
  }
};
