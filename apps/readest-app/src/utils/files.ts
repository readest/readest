import { AppService, FileItem } from '@/types/system';

export const copyFiles = async (appService: AppService, srcDir: string, dstDir: string) => {
  let filesToCopy: FileItem[] = [];
  try {
    filesToCopy = await appService.readDirectory(srcDir, 'None');
  } catch (error) {
    throw new Error(`Dir ${srcDir} failed to read.`);
  }

  for (let i = 0; i < filesToCopy.length; i++) {
    const file = filesToCopy[i]!;
    const srcPath = `${srcDir}/${file.path}`;
    const destPath = `${dstDir}/${file.path}`;
    await appService.copyFile(srcPath, destPath, 'None');
  }

  const filesCopied = await appService.readDirectory(dstDir, 'None');
  for (const file of filesToCopy) {
    if (!filesCopied.find((f) => f.path === file.path && f.size === file.size)) {
      throw new Error(`File ${file.path} failed to copy.`);
    }
  }
};
