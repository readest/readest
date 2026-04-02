import { FileSystem } from '@/types/system';
import { getFilename } from '@/utils/path';
import { CustomFont, CustomFontInfo } from '@/styles/fonts';
import { parseFontInfo } from '@/utils/font';

export async function importFont(
  fs: FileSystem,
  file?: string | File,
): Promise<CustomFontInfo | null> {
  let fontPath: string;
  let fontFile: File;
  if (typeof file === 'string') {
    const filePath = file;
    const fileobj = await fs.openFile(filePath, 'None');
    fontPath = fileobj.name || getFilename(filePath);
    await fs.copyFile(filePath, fontPath, 'Fonts');
    fontFile = await fs.openFile(fontPath, 'Fonts');
  } else if (file) {
    fontPath = getFilename(file.name);
    await fs.writeFile(fontPath, 'Fonts', file);
    fontFile = file;
  } else {
    return null;
  }

  return {
    path: fontPath,
    ...parseFontInfo(await fontFile.arrayBuffer(), fontPath),
  };
}

export async function deleteFont(fs: FileSystem, font: CustomFont): Promise<void> {
  await fs.removeFile(font.path, 'Fonts');
}
