import { FontStyle } from '@/styles/fonts';
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

function parseOS2Weight(dataView: DataView, os2TableOffset: number): number {
  // OS/2 table usWeightClass is at offset 4
  return dataView.getUint16(os2TableOffset + 4, false);
}

function parseOS2Selection(dataView: DataView, os2TableOffset: number): number {
  // OS/2 table fsSelection is at offset 62
  return dataView.getUint16(os2TableOffset + 62, false);
}

interface VariableFontAxis {
  tag: string;
  minValue: number;
  defaultValue: number;
  maxValue: number;
  name?: string;
}

function parseVariableFontAxes(dataView: DataView, fvarTableOffset: number): VariableFontAxis[] {
  try {
    // fvar table structure:
    // version (4 bytes) + axisCount (2 bytes) + axisSize (2 bytes) + instanceCount (2 bytes) + instanceSize (2 bytes)
    const axisCount = dataView.getUint16(fvarTableOffset + 4, false);
    const axisSize = dataView.getUint16(fvarTableOffset + 6, false);

    const axes: VariableFontAxis[] = [];

    // Each axis record starts at offset 16 from table start
    let axisOffset = fvarTableOffset + 16;

    for (let i = 0; i < axisCount; i++) {
      // Axis record structure:
      // axisTag (4 bytes) + minValue (4 bytes) + defaultValue (4 bytes) + maxValue (4 bytes) + flags (2 bytes) + axisNameID (2 bytes)

      const tag = String.fromCharCode(
        dataView.getUint8(axisOffset),
        dataView.getUint8(axisOffset + 1),
        dataView.getUint8(axisOffset + 2),
        dataView.getUint8(axisOffset + 3),
      );

      // Fixed-point values (16.16 format)
      const minValue = dataView.getInt32(axisOffset + 4, false) / 65536;
      const defaultValue = dataView.getInt32(axisOffset + 8, false) / 65536;
      const maxValue = dataView.getInt32(axisOffset + 12, false) / 65536;

      axes.push({
        tag,
        minValue,
        defaultValue,
        maxValue,
      });

      axisOffset += axisSize;
    }

    return axes;
  } catch (error) {
    console.warn('Failed to parse fvar table:', error);
    return [];
  }
}

function weightClassToCSSWeight(weightClass: number): number {
  // Map OpenType weight class to CSS weight
  if (weightClass >= 1 && weightClass <= 100) return 100;
  if (weightClass >= 101 && weightClass <= 200) return 200;
  if (weightClass >= 201 && weightClass <= 300) return 300;
  if (weightClass >= 301 && weightClass <= 400) return 400;
  if (weightClass >= 401 && weightClass <= 500) return 500;
  if (weightClass >= 501 && weightClass <= 600) return 600;
  if (weightClass >= 601 && weightClass <= 700) return 700;
  if (weightClass >= 701 && weightClass <= 800) return 800;
  if (weightClass >= 801 && weightClass <= 900) return 900;
  return 400; // Default to normal weight
}

function inferWeightFromStyleName(styleName: string): number {
  const lowerStyle = styleName.toLowerCase();

  // Check for specific weight keywords
  if (lowerStyle.includes('thin') || lowerStyle.includes('hairline')) return 100;
  if (lowerStyle.includes('extralight') || lowerStyle.includes('ultralight')) return 200;
  if (
    lowerStyle.includes('light') &&
    !lowerStyle.includes('extralight') &&
    !lowerStyle.includes('ultralight')
  )
    return 300;
  if (lowerStyle.includes('medium')) return 500;
  if (lowerStyle.includes('semibold') || lowerStyle.includes('demibold')) return 600;
  if (lowerStyle.includes('extrabold') || lowerStyle.includes('ultrabold')) return 800;
  if (lowerStyle.includes('black') || lowerStyle.includes('heavy')) return 900;
  if (
    lowerStyle.includes('bold') &&
    !lowerStyle.includes('semibold') &&
    !lowerStyle.includes('extrabold') &&
    !lowerStyle.includes('ultrabold')
  )
    return 700;

  return 400; // Default to normal weight
}

function inferStyleFromName(
  styleName: string,
  fsSelection: number,
): 'normal' | 'italic' | 'oblique' {
  const lowerStyle = styleName.toLowerCase();

  // Check fsSelection flags first (bit 0 = italic, bit 9 = oblique)
  if (fsSelection & 0x200) return 'oblique'; // Bit 9
  if (fsSelection & 0x1) return 'italic'; // Bit 0

  // Fallback to style name analysis
  if (lowerStyle.includes('oblique')) return 'oblique';
  if (lowerStyle.includes('italic') || lowerStyle.includes('slant')) return 'italic';

  return 'normal';
}

type FontNameType = {
  name: string;
  platformID: number;
  languageID: number;
  priority: number;
};

export const parseFontInfo = (fontData: ArrayBuffer, filename: string) => {
  const fallbackName = filename.replace(/\.[^/.]+$/, '');
  try {
    const dataView = new DataView(fontData);
    const signature = dataView.getUint32(0, false);
    if (signature !== 0x00010000 && signature !== 0x74727565 && signature !== 0x4f54544f) {
      throw new Error('Unsupported font format');
    }
    const numTables = dataView.getUint16(4, false);
    let nameTableOffset = 0;
    let os2TableOffset = 0;
    let fvarTableOffset = 0;
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
      } else if (tag === 'OS/2') {
        os2TableOffset = dataView.getUint32(tableOffset + 8, false);
      } else if (tag === 'fvar') {
        fvarTableOffset = dataView.getUint32(tableOffset + 8, false);
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
    const preferredFamilyNames: Array<FontNameType> = [];
    const preferredStyleNames: Array<FontNameType> = [];
    for (let i = 0; i < count; i++) {
      const recordOffset = nameTableOffset + 6 + i * 12;
      const platformID = dataView.getUint16(recordOffset, false);
      const languageID = dataView.getUint16(recordOffset + 4, false);
      const nameID = dataView.getUint16(recordOffset + 6, false);
      const nameLength = dataView.getUint16(recordOffset + 8, false);
      const nameOffsetInTable = dataView.getUint16(recordOffset + 10, false);

      // nameID 1 = Font Family name, nameID 2 = Font Subfamily name (style)
      // nameID 16 = Typographic Family name, nameID 17 = Typographic Subfamily name
      if (nameID === 1 || nameID === 2 || nameID === 16 || nameID === 17) {
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
          } else if (nameID === 16) {
            preferredFamilyNames.push(nameEntry);
          } else if (nameID === 17) {
            preferredStyleNames.push(nameEntry);
          }
        }
      }
    }
    if (fontFamilyNames.length === 0) {
      throw new Error('Font family name not found');
    }
    fontFamilyNames.sort((a, b) => b.priority - a.priority);
    fontStyleNames.sort((a, b) => b.priority - a.priority);
    preferredFamilyNames.sort((a, b) => b.priority - a.priority);
    preferredStyleNames.sort((a, b) => b.priority - a.priority);

    // Prefer typographic names if available
    const familyName = (preferredFamilyNames[0] || fontFamilyNames[0])!.name;
    const fontStyleName = preferredStyleNames[0] || fontStyleNames[0];
    const styleName = fontStyleName?.name || '';

    // Parse weight and style information
    let fontWeight = 400;
    let fontStyle: FontStyle = 'normal';
    let fsSelection = 0;

    if (os2TableOffset > 0) {
      try {
        const weightClass = parseOS2Weight(dataView, os2TableOffset);
        fontWeight = weightClassToCSSWeight(weightClass);
        fsSelection = parseOS2Selection(dataView, os2TableOffset);
      } catch {
        console.warn('Failed to parse OS/2 table, falling back to style name analysis');
      }
    }

    let isVariable = false;
    if (fvarTableOffset > 0) {
      const axes = parseVariableFontAxes(dataView, fvarTableOffset);
      if (axes && axes.length > 0) {
        isVariable = true;
      }
    }

    // If OS/2 table weight is default (400) or unavailable, try to infer from style name
    if (fontWeight === 400 && styleName) {
      const inferredWeight = inferWeightFromStyleName(styleName);
      if (inferredWeight !== 400) {
        fontWeight = inferredWeight;
      }
    }

    fontStyle = inferStyleFromName(styleName, fsSelection);

    return {
      name:
        fontStyleName && !NO_STYLE_LANGUAGE_IDS.has(fontStyleName.languageID)
          ? `${familyName} ${styleName}`
          : familyName,
      family: familyName,
      weight: fontWeight,
      style: fontStyle,
      variable: isVariable,
    };
  } catch (error) {
    console.warn(`Failed to parse font: ${error}`);
    return {
      name: fallbackName,
      family: fallbackName,
      weight: 400,
      style: 'normal' as FontStyle,
      variable: false,
    };
  }
};
