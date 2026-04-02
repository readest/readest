import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/misc', () => ({
  getUserLang: vi.fn(() => 'en'),
}));

import { getUserLang } from '@/utils/misc';
import { parseFontInfo, isFontType } from '@/utils/font';

// ---------------------------------------------------------------------------
// helpers: build minimal valid TrueType font binary data
// ---------------------------------------------------------------------------

/** Write a 16-bit big-endian unsigned integer into a DataView. */
function writeU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, false);
}

/** Write a 32-bit big-endian unsigned integer into a DataView. */
function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, false);
}

/** Write a 32-bit big-endian signed integer into a DataView. */
function writeI32(view: DataView, offset: number, value: number) {
  view.setInt32(offset, value, false);
}

/**
 * Build a minimal TrueType font buffer with a `name` table (and optionally
 * an OS/2 table and fvar table) so that `parseFontInfo` can parse it.
 */
function buildFontBuffer(options: {
  familyName: string;
  styleName?: string;
  preferredFamily?: string;
  preferredStyle?: string;
  platformID?: number; // 0 = Unicode, 1 = Mac, 3 = Microsoft
  languageID?: number;
  weightClass?: number; // OS/2 usWeightClass
  fsSelection?: number; // OS/2 fsSelection
  fvarAxes?: Array<{ tag: string; min: number; def: number; max: number }>;
}): ArrayBuffer {
  const {
    familyName,
    styleName = '',
    preferredFamily,
    preferredStyle,
    platformID = 3,
    languageID = 0x0409,
    weightClass,
    fsSelection,
    fvarAxes,
  } = options;

  const hasOS2 = weightClass !== undefined || fsSelection !== undefined;
  const hasFvar = fvarAxes && fvarAxes.length > 0;

  let numTables = 1; // name table always present
  if (hasOS2) numTables++;
  if (hasFvar) numTables++;

  // Table directory starts at offset 12, each entry is 16 bytes
  const tableDirectorySize = numTables * 16;
  const headerSize = 12 + tableDirectorySize;

  // Build name records
  interface NameRecord {
    nameID: number;
    text: string;
  }
  const nameRecords: NameRecord[] = [];
  nameRecords.push({ nameID: 1, text: familyName }); // Font Family
  if (styleName) nameRecords.push({ nameID: 2, text: styleName }); // Font Subfamily
  if (preferredFamily) nameRecords.push({ nameID: 16, text: preferredFamily });
  if (preferredStyle) nameRecords.push({ nameID: 17, text: preferredStyle });

  // Calculate name table size
  const nameRecordHeaderSize = 6; // name table header: format(2) + count(2) + stringOffset(2)
  const nameRecordEntrySize = 12; // each name record
  const stringDataStart = nameRecordHeaderSize + nameRecords.length * nameRecordEntrySize;

  // For platform 0 or 3 (Unicode/Microsoft), strings are UTF-16BE (2 bytes per char)
  // For platform 1 (Macintosh), strings are single-byte
  const isUnicode = platformID === 0 || platformID === 3;
  const charSize = isUnicode ? 2 : 1;

  let totalStringBytes = 0;
  const stringOffsets: number[] = [];
  for (const rec of nameRecords) {
    stringOffsets.push(totalStringBytes);
    totalStringBytes += rec.text.length * charSize;
  }

  const nameTableSize = stringDataStart + totalStringBytes;

  // OS/2 table needs at least 64 bytes (to cover fsSelection at offset 62)
  const os2TableSize = hasOS2 ? 78 : 0;

  // fvar table: header (16 bytes) + axes (20 bytes each)
  const fvarTableSize = hasFvar ? 16 + fvarAxes.length * 20 : 0;

  const totalSize = headerSize + nameTableSize + os2TableSize + fvarTableSize;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // --- Font header ---
  writeU32(view, 0, 0x00010000); // sfVersion (TrueType)
  writeU16(view, 4, numTables);
  writeU16(view, 6, 0); // searchRange
  writeU16(view, 8, 0); // entrySelector
  writeU16(view, 10, 0); // rangeShift

  let tableIdx = 0;
  let dataOffset = headerSize;

  // --- name table entry in directory ---
  const nameTableOffset = dataOffset;
  const nameEntryOffset = 12 + tableIdx * 16;
  view.setUint8(nameEntryOffset, 'n'.charCodeAt(0));
  view.setUint8(nameEntryOffset + 1, 'a'.charCodeAt(0));
  view.setUint8(nameEntryOffset + 2, 'm'.charCodeAt(0));
  view.setUint8(nameEntryOffset + 3, 'e'.charCodeAt(0));
  writeU32(view, nameEntryOffset + 4, 0); // checksum
  writeU32(view, nameEntryOffset + 8, nameTableOffset);
  writeU32(view, nameEntryOffset + 12, nameTableSize);
  tableIdx++;
  dataOffset += nameTableSize;

  // --- OS/2 table entry ---
  let os2Offset = 0;
  if (hasOS2) {
    os2Offset = dataOffset;
    const os2EntryOffset = 12 + tableIdx * 16;
    view.setUint8(os2EntryOffset, 'O'.charCodeAt(0));
    view.setUint8(os2EntryOffset + 1, 'S'.charCodeAt(0));
    view.setUint8(os2EntryOffset + 2, '/'.charCodeAt(0));
    view.setUint8(os2EntryOffset + 3, '2'.charCodeAt(0));
    writeU32(view, os2EntryOffset + 4, 0);
    writeU32(view, os2EntryOffset + 8, os2Offset);
    writeU32(view, os2EntryOffset + 12, os2TableSize);
    tableIdx++;
    dataOffset += os2TableSize;
  }

  // --- fvar table entry ---
  let fvarOffset = 0;
  if (hasFvar) {
    fvarOffset = dataOffset;
    const fvarEntryOffset = 12 + tableIdx * 16;
    view.setUint8(fvarEntryOffset, 'f'.charCodeAt(0));
    view.setUint8(fvarEntryOffset + 1, 'v'.charCodeAt(0));
    view.setUint8(fvarEntryOffset + 2, 'a'.charCodeAt(0));
    view.setUint8(fvarEntryOffset + 3, 'r'.charCodeAt(0));
    writeU32(view, fvarEntryOffset + 4, 0);
    writeU32(view, fvarEntryOffset + 8, fvarOffset);
    writeU32(view, fvarEntryOffset + 12, fvarTableSize);
    dataOffset += fvarTableSize;
  }

  // --- Name table data ---
  writeU16(view, nameTableOffset, 0); // format
  writeU16(view, nameTableOffset + 2, nameRecords.length); // count
  writeU16(view, nameTableOffset + 4, stringDataStart); // stringOffset

  for (let i = 0; i < nameRecords.length; i++) {
    const rec = nameRecords[i]!;
    const recOffset = nameTableOffset + 6 + i * 12;
    writeU16(view, recOffset, platformID);
    writeU16(view, recOffset + 2, isUnicode ? 1 : 0); // encodingID
    writeU16(view, recOffset + 4, languageID);
    writeU16(view, recOffset + 6, rec.nameID);
    writeU16(view, recOffset + 8, rec.text.length * charSize); // length
    writeU16(view, recOffset + 10, stringOffsets[i]!); // offset

    // Write string data
    const strStart = nameTableOffset + stringDataStart + stringOffsets[i]!;
    for (let j = 0; j < rec.text.length; j++) {
      if (isUnicode) {
        writeU16(view, strStart + j * 2, rec.text.charCodeAt(j));
      } else {
        view.setUint8(strStart + j, rec.text.charCodeAt(j));
      }
    }
  }

  // --- OS/2 table data ---
  if (hasOS2 && os2Offset > 0) {
    // usWeightClass at offset 4
    writeU16(view, os2Offset + 4, weightClass ?? 400);
    // fsSelection at offset 62
    writeU16(view, os2Offset + 62, fsSelection ?? 0);
  }

  // --- fvar table data ---
  if (hasFvar && fvarOffset > 0) {
    // axisCount at offset 4
    writeU16(view, fvarOffset + 4, fvarAxes.length);
    // axisSize at offset 6
    writeU16(view, fvarOffset + 6, 20);

    for (let i = 0; i < fvarAxes.length; i++) {
      const axis = fvarAxes[i]!;
      const axisOff = fvarOffset + 16 + i * 20;
      // tag (4 bytes)
      for (let j = 0; j < 4; j++) {
        view.setUint8(axisOff + j, axis.tag.charCodeAt(j));
      }
      // Fixed 16.16 values
      writeI32(view, axisOff + 4, Math.round(axis.min * 65536));
      writeI32(view, axisOff + 8, Math.round(axis.def * 65536));
      writeI32(view, axisOff + 12, Math.round(axis.max * 65536));
    }
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// parseFontInfo
// ---------------------------------------------------------------------------
describe('parseFontInfo', () => {
  beforeEach(() => {
    vi.mocked(getUserLang).mockReturnValue('en');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses basic font family name from Unicode/Microsoft platform', () => {
    const buf = buildFontBuffer({
      familyName: 'Roboto',
      platformID: 3,
      languageID: 0x0409,
    });
    const info = parseFontInfo(buf, 'Roboto.ttf');
    expect(info.family).toBe('Roboto');
    expect(info.name).toBe('Roboto');
    expect(info.weight).toBe(400);
    expect(info.style).toBe('normal');
    expect(info.variable).toBe(false);
  });

  it('parses font with style name', () => {
    const buf = buildFontBuffer({
      familyName: 'Roboto',
      styleName: 'Bold Italic',
      platformID: 3,
      languageID: 0x0409,
    });
    const info = parseFontInfo(buf, 'Roboto-BoldItalic.ttf');
    expect(info.name).toBe('Roboto Bold Italic');
    expect(info.family).toBe('Roboto');
  });

  it('infers bold weight from style name when OS/2 reports 400', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Bold',
      weightClass: 400,
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.weight).toBe(700);
  });

  it('reads weight from OS/2 table when available', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Regular',
      weightClass: 700,
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.weight).toBe(700);
  });

  it('detects italic from fsSelection bit 0', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Regular',
      weightClass: 400,
      fsSelection: 0x1, // bit 0 = italic
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.style).toBe('italic');
  });

  it('detects oblique from fsSelection bit 9', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Regular',
      weightClass: 400,
      fsSelection: 0x200, // bit 9 = oblique
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.style).toBe('oblique');
  });

  it('detects italic from style name when fsSelection has no italic/oblique bits', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Italic',
      weightClass: 400,
      fsSelection: 0,
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.style).toBe('italic');
  });

  it('detects oblique from style name', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Oblique',
      weightClass: 400,
      fsSelection: 0,
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.style).toBe('oblique');
  });

  it('detects variable font from fvar table', () => {
    const buf = buildFontBuffer({
      familyName: 'VarFont',
      styleName: 'Regular',
      weightClass: 400,
      fvarAxes: [{ tag: 'wght', min: 100, def: 400, max: 900 }],
    });
    const info = parseFontInfo(buf, 'varfont.ttf');
    expect(info.variable).toBe(true);
  });

  it('prefers typographic family name (nameID 16) over font family (nameID 1)', () => {
    const buf = buildFontBuffer({
      familyName: 'Roboto Bold',
      preferredFamily: 'Roboto',
      preferredStyle: 'Bold',
      weightClass: 700,
    });
    const info = parseFontInfo(buf, 'roboto-bold.ttf');
    expect(info.family).toBe('Roboto');
  });

  it('falls back to filename when font data is invalid', () => {
    const buf = new ArrayBuffer(10); // too small to be valid
    const info = parseFontInfo(buf, 'MyFont.ttf');
    expect(info.family).toBe('MyFont');
    expect(info.name).toBe('MyFont');
    expect(info.weight).toBe(400);
    expect(info.style).toBe('normal');
    expect(info.variable).toBe(false);
  });

  it('falls back to filename with extension stripped', () => {
    const buf = new ArrayBuffer(4);
    const info = parseFontInfo(buf, 'Some Font Name.otf');
    expect(info.family).toBe('Some Font Name');
    expect(info.name).toBe('Some Font Name');
  });

  it('parses Macintosh platform strings', () => {
    const buf = buildFontBuffer({
      familyName: 'MacFont',
      styleName: 'Regular',
      platformID: 1,
      languageID: 0,
    });
    const info = parseFontInfo(buf, 'mac.ttf');
    expect(info.family).toBe('MacFont');
  });

  it('maps various weight class ranges correctly', () => {
    // Test thin (100)
    let buf = buildFontBuffer({ familyName: 'F', styleName: 'Thin', weightClass: 50 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(100);

    // Test extra-light (200)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'ExtraLight', weightClass: 150 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(200);

    // Test light (300)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'Light', weightClass: 250 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(300);

    // Test medium (500)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'Medium', weightClass: 450 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(500);

    // Test semibold (600)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'SemiBold', weightClass: 550 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(600);

    // Test bold (700)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'Bold', weightClass: 650 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(700);

    // Test extra-bold (800)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'ExtraBold', weightClass: 750 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(800);

    // Test black (900)
    buf = buildFontBuffer({ familyName: 'F', styleName: 'Black', weightClass: 850 });
    expect(parseFontInfo(buf, 'f.ttf').weight).toBe(900);
  });

  it('infers weight from style name keywords', () => {
    const cases: Array<{ style: string; expected: number }> = [
      { style: 'Thin', expected: 100 },
      { style: 'Hairline', expected: 100 },
      { style: 'ExtraLight', expected: 200 },
      { style: 'UltraLight', expected: 200 },
      { style: 'Light', expected: 300 },
      { style: 'Medium', expected: 500 },
      { style: 'SemiBold', expected: 600 },
      { style: 'DemiBold', expected: 600 },
      { style: 'Bold', expected: 700 },
      { style: 'ExtraBold', expected: 800 },
      { style: 'UltraBold', expected: 800 },
      { style: 'Black', expected: 900 },
      { style: 'Heavy', expected: 900 },
    ];

    for (const { style, expected } of cases) {
      // Use weightClass: 400 so the style name inference is used
      const buf = buildFontBuffer({
        familyName: 'F',
        styleName: style,
        weightClass: 400,
      });
      const info = parseFontInfo(buf, 'f.ttf');
      expect(info.weight).toBe(expected);
    }
  });

  it('handles out-of-range weight class by defaulting to 400', () => {
    const buf = buildFontBuffer({
      familyName: 'F',
      styleName: 'Regular',
      weightClass: 1000,
    });
    const info = parseFontInfo(buf, 'f.ttf');
    expect(info.weight).toBe(400);
  });

  it('suppresses style name for CJK language IDs', () => {
    // languageID 0x0804 is Simplified Chinese (in NO_STYLE_LANGUAGE_IDS)
    const buf = buildFontBuffer({
      familyName: 'NotoSansSC',
      styleName: 'Regular',
      platformID: 3,
      languageID: 0x0804,
      weightClass: 400,
    });
    const info = parseFontInfo(buf, 'noto.ttf');
    // Name should not include the style for CJK language IDs
    expect(info.name).toBe('NotoSansSC');
  });

  it('prioritizes Chinese language when user lang is zh', () => {
    vi.mocked(getUserLang).mockReturnValue('zh');
    const buf = buildFontBuffer({
      familyName: 'ChineseFont',
      platformID: 3,
      languageID: 0x0804,
      weightClass: 400,
    });
    const info = parseFontInfo(buf, 'ch.ttf');
    expect(info.family).toBe('ChineseFont');
  });

  it('detects slant as italic style', () => {
    const buf = buildFontBuffer({
      familyName: 'TestFont',
      styleName: 'Slant',
      weightClass: 400,
      fsSelection: 0,
    });
    const info = parseFontInfo(buf, 'test.ttf');
    expect(info.style).toBe('italic');
  });
});

// ---------------------------------------------------------------------------
// isFontType
// ---------------------------------------------------------------------------
describe('isFontType', () => {
  it('returns true for standard font MIME types', () => {
    expect(isFontType('font/woff')).toBe(true);
    expect(isFontType('font/woff2')).toBe(true);
    expect(isFontType('font/ttf')).toBe(true);
    expect(isFontType('font/otf')).toBe(true);
  });

  it('returns true for application font MIME types', () => {
    expect(isFontType('application/font-woff')).toBe(true);
    expect(isFontType('application/font-woff2')).toBe(true);
    expect(isFontType('application/x-font-woff')).toBe(true);
    expect(isFontType('application/x-font-woff2')).toBe(true);
    expect(isFontType('application/x-font-ttf')).toBe(true);
    expect(isFontType('application/x-font-otf')).toBe(true);
  });

  it('returns false for non-font MIME types', () => {
    expect(isFontType('text/plain')).toBe(false);
    expect(isFontType('application/json')).toBe(false);
    expect(isFontType('image/png')).toBe(false);
    expect(isFontType('')).toBe(false);
    expect(isFontType('font/svg')).toBe(false);
  });
});
