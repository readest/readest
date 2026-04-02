import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { join } from '@tauri-apps/api/path';
import { mkdir, remove, writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { NativeAppService } from '@/services/nativeAppService';
import { fsTests } from './suites/fs-tests';
import { libraryTests } from './suites/library-tests';
import { bookTests } from './suites/book-tests';

async function getBookFile(name: string): Promise<string> {
  return await join(process.env['CWD']!, 'src/__tests__/fixtures/data', name);
}

const SANDBOX_DIR = `${process.env['CWD']}/.readest-test-sandbox-tauri`;
let tmpCounter = 0;

describe('NativeAppService', () => {
  let tmpDir: string;
  let service: NativeAppService;

  beforeAll(async () => {
    await mkdir(SANDBOX_DIR, { recursive: true });
  });

  afterAll(async () => {
    await remove(SANDBOX_DIR, { recursive: true });
  });

  beforeEach(async () => {
    tmpCounter++;
    tmpDir = await join(SANDBOX_DIR, `tauri-${Date.now()}-${tmpCounter}`);
    await mkdir(tmpDir, { recursive: true });
    service = new NativeAppService(tmpDir);
    await service.init();
    // init() doesn't create base dirs; ensure Data and Books dirs exist
    await service.createDir('', 'Data', true);
    await service.createDir('', 'Books', true);
  });

  afterEach(async () => {
    await remove(tmpDir, { recursive: true });
  });

  it('should have localBooksDir set after init', () => {
    expect(service.localBooksDir).toBeTruthy();
    expect(service.localBooksDir.toLowerCase()).toContain('books');
  });

  it('should resolve file paths to absolute paths', async () => {
    const resolved = await service.resolveFilePath('test.json', 'Books');
    expect(resolved).toBeTruthy();
    expect(resolved).toContain('test.json');
    expect(resolved.toLowerCase()).toContain('books');
  });

  it('should have appPlatform set to tauri', () => {
    expect(service.appPlatform).toBe('tauri');
  });

  it('should write and read text via plugin wrapper', async () => {
    const filePath = await join(tmpDir, 'wrapper-test.txt');
    await writeTextFile(filePath, 'wrapper-write');
    const content = await readTextFile(filePath);
    expect(content).toBe('wrapper-write');
  });

  fsTests(() => service);
  libraryTests(() => service);
  bookTests(() => service, getBookFile);
});
