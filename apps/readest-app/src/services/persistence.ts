import { FileSystem, BaseDir } from '@/types/system';

async function loadJSONFile(
  fs: FileSystem,
  path: string,
  base: BaseDir,
): Promise<{ success: boolean; data?: unknown; error?: unknown }> {
  try {
    const txt = await fs.readFile(path, base, 'text');
    if (!txt || typeof txt !== 'string' || txt.trim().length === 0) {
      return { success: false, error: 'File is empty or invalid' };
    }
    try {
      const data = JSON.parse(txt as string);
      return { success: true, data };
    } catch (parseError) {
      return { success: false, error: `JSON parse error: ${parseError}` };
    }
  } catch (error) {
    return { success: false, error };
  }
}

/**
 * Safely loads a JSON file with automatic backup fallback.
 * If the main file is corrupted, attempts to load from backup.
 */
export async function safeLoadJSON<T>(
  fs: FileSystem,
  filename: string,
  base: BaseDir,
  defaultValue: T,
): Promise<T> {
  const backupFilename = `${filename}.bak`;

  const mainResult = await loadJSONFile(fs, filename, base);
  if (mainResult.success) {
    return mainResult.data as T;
  }

  const backupResult = await loadJSONFile(fs, backupFilename, base);
  if (backupResult.success) {
    try {
      const backupData = JSON.stringify(backupResult.data, null, 2);
      await fs.writeFile(filename, base, backupData);
    } catch (error) {
      console.info(`Failed to restore ${filename} from backup:`, error);
    }
    return backupResult.data as T;
  }

  return defaultValue;
}

/**
 * Safely saves a JSON file with atomic write using backup strategy.
 * Strategy: write to backup first, then to main file.
 * This ensures at least one valid copy exists at all times.
 */
export async function safeSaveJSON(
  fs: FileSystem,
  filename: string,
  base: BaseDir,
  data: unknown,
): Promise<void> {
  const backupFilename = `${filename}.bak`;
  const jsonData = JSON.stringify(data);

  try {
    await fs.writeFile(backupFilename, base, jsonData);
    await fs.writeFile(filename, base, jsonData);
  } catch (error) {
    console.error(`Failed to save ${filename}:`, error);
    throw new Error(`Failed to save ${filename}: ${error}`);
  }
}
