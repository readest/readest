import { getUserLang } from './misc';

function parseUnicodeString(dataView: DataView, offset: number, length: number): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i += 2) {
    const charCode = dataView.getUint16(offset + i, false);
    if (charCode !== 0) {
      chars.push(String.fromCharCode(charCode));
    }
  }
  return chars.join('');
}

function parseMacintoshString(dataView: DataView, offset: number, length: number): string {
  const chars: string[] = [];
  for (let i = 0; i < length; i++) {
    const charCode = dataView.getUint8(offset + i);
    chars.push(String.fromCharCode(charCode));
  }
  return chars.join('');
}

const NO_STYLE_LANGUAGE_IDS = new Set([0x0404, 0x0804, 0x0c04, 0x1004, 19, 33]);

function getLanguagePriority(platformID: number, languageID: number, userLanguage: string): number {
  let priority = 0;

  // Base priority by platform (Unicode/Microsoft preferred)
  if (platformID === 0)
    priority += 100; // Unicode
  else if (platformID === 3)
    priority += 90; // Microsoft
  else if (platformID === 1) priority += 50; // Macintosh

  // Language-specific priorities
  const userLang = userLanguage.toLowerCase();

  if (platformID === 0 || platformID === 3) {
    if (userLang.startsWith('zh')) {
      if (languageID === 0x0804)
        priority += 50; // Simplified Chinese
      else if (languageID === 0x0404)
        priority += 45; // Traditional Chinese
      else if (languageID === 0x0c04)
        priority += 40; // Traditional Chinese
      else if (languageID === 0x1004) priority += 35; // Simplified Chinese
    } else if (userLang.startsWith('ja')) {
      if (languageID === 0x0411) priority += 50; // Japanese
    } else if (userLang.startsWith('ko')) {
      if (languageID === 0x0412) priority += 50; // Korean
    } else if (userLang.startsWith('en')) {
      if (languageID === 0x0409)
        priority += 50; // English (US)
      else if (languageID === 0x0809) priority += 45; // English (UK)
    }

    // Fallback: English
    if (languageID === 0x0409) priority += 10; // English fallback
  } else if (platformID === 1) {
    // Macintosh platform language codes
    if (userLang.startsWith('zh')) {
      if (languageID === 33)
        priority += 50; // Chinese (Simplified)
      else if (languageID === 19) priority += 45; // Chinese (Traditional)
    } else if (userLang.startsWith('ja')) {
      if (languageID === 11) priority += 50; // Japanese
    } else if (userLang.startsWith('ko')) {
      if (languageID === 23) priority += 50; // Korean
    } else if (userLang.startsWith('en')) {
      if (languageID === 0) priority += 50; // English
    }

    // Fallback: English
    if (languageID === 0) priority += 10; // English fallback
  }

  return priority;
}

type FontNameType = {
  name: string;
  platformID: number;
  languageID: number;
  priority: number;
};

export const parseFontName = (fontData: ArrayBuffer, filename: string) => {
  const fallbackName = filename.replace(/\.[^/.]+$/, '');
  try {
    const dataView = new DataView(fontData);
    const signature = dataView.getUint32(0, false);
    if (signature !== 0x00010000 && signature !== 0x74727565 && signature !== 0x4f54544f) {
      throw new Error('Unsupported font format');
    }
    const numTables = dataView.getUint16(4, false);
    let nameTableOffset = 0;
    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      const tag = String.fromCharCode(
        dataView.getUint8(tableOffset),
        dataView.getUint8(tableOffset + 1),
        dataView.getUint8(tableOffset + 2),
        dataView.getUint8(tableOffset + 3),
      );

      if (tag === 'name') {
        nameTableOffset = dataView.getUint32(tableOffset + 8, false);
        break;
      }
    }

    if (nameTableOffset === 0) {
      throw new Error('Name table not found');
    }

    const count = dataView.getUint16(nameTableOffset + 2, false);
    const stringOffset = dataView.getUint16(nameTableOffset + 4, false);

    const userLanguage = getUserLang();
    const fontFamilyNames: Array<FontNameType> = [];
    const fontStyleNames: Array<FontNameType> = [];
    for (let i = 0; i < count; i++) {
      const recordOffset = nameTableOffset + 6 + i * 12;
      const platformID = dataView.getUint16(recordOffset, false);
      const languageID = dataView.getUint16(recordOffset + 4, false);
      const nameID = dataView.getUint16(recordOffset + 6, false);
      const nameLength = dataView.getUint16(recordOffset + 8, false);
      const nameOffsetInTable = dataView.getUint16(recordOffset + 10, false);

      // nameID 1 = Font Family name, nameID 2 = Font Subfamily name (style)
      if (nameID === 1 || nameID === 2) {
        const stringStart = nameTableOffset + stringOffset + nameOffsetInTable;
        let fontName = '';

        if (platformID === 0 || platformID === 3) {
          // Unicode/Microsoft platform
          fontName = parseUnicodeString(dataView, stringStart, nameLength);
        } else if (platformID === 1) {
          // Macintosh platform
          fontName = parseMacintoshString(dataView, stringStart, nameLength);
        }

        if (fontName && fontName.trim()) {
          const priority = getLanguagePriority(platformID, languageID, userLanguage);
          const nameEntry = {
            name: fontName.trim(),
            platformID,
            languageID,
            priority,
          };

          if (nameID === 1) {
            fontFamilyNames.push(nameEntry);
          } else if (nameID === 2) {
            fontStyleNames.push(nameEntry);
          }
        }
      }
    }
    if (fontFamilyNames.length === 0) {
      throw new Error('Font family name not found');
    }
    fontFamilyNames.sort((a, b) => b.priority - a.priority);
    fontStyleNames.sort((a, b) => b.priority - a.priority);
    const fontStyleName = fontStyleNames[0];
    const familyName = fontFamilyNames[0]!.name;
    const styleName = fontStyleName?.name || '';
    return {
      name:
        fontStyleName && !NO_STYLE_LANGUAGE_IDS.has(fontStyleName.languageID)
          ? `${familyName} ${styleName}`
          : familyName,
      family: familyName,
      style: styleName,
    };
  } catch (error) {
    console.warn(`Failed to parse font: ${error}`);
    return {
      name: fallbackName,
      family: fallbackName,
      style: '',
    };
  }
};
