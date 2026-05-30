import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { NodeAppService } from '@/services/nodeAppService';
import { fsTests } from './suites/fs-tests';
import { libraryTests } from './suites/library-tests';
import { bookTests } from './suites/book-tests';

const FIXTURES_DIR = path.join(process.cwd(), 'src/__tests__/fixtures/data');

async function getBookFile(name: string): Promise<File> {
  const buf = await fsp.readFile(path.join(FIXTURES_DIR, name));
  return new File([buf], name);
}

const SANDBOX_DIR = path.join(process.cwd(), '.test-sandbox-node');

describe('NodeAppService', () => {
  let tmpDir: string;
  let service: NodeAppService;

  beforeAll(async () => {
    await fsp.mkdir(SANDBOX_DIR, { recursive: true });
  });

  afterAll(async () => {
    await fsp.rm(SANDBOX_DIR, { recursive: true, force: true });
  });

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(SANDBOX_DIR, 'node-'));
    service = new NodeAppService(tmpDir);
    await service.init();
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('should copy files from absolute path', async () => {
    const srcPath = path.join(tmpDir, 'source.txt');
    await fsp.writeFile(srcPath, 'copy me');
    await service.copyFile(srcPath, 'None', 'copied.txt', 'Data');
    const content = await service.readFile('copied.txt', 'Data', 'text');
    expect(content).toBe('copy me');
  });

  it('should save files via saveFile', async () => {
    const filepath = path.join(tmpDir, 'saved.txt');
    const result = await service.saveFile('saved.txt', 'saved content', { filePath: filepath });
    expect(result).toBe(true);
    const content = await fsp.readFile(filepath, 'utf-8');
    expect(content).toBe('saved content');
  });

  it('should set localBooksDir after init', () => {
    expect(service.localBooksDir).toBe(path.join(tmpDir, 'Readest', 'Books'));
  });

  it('should resolve file paths correctly', async () => {
    const resolved = await service.resolveFilePath('test.json', 'Books');
    expect(resolved).toBe(path.join(tmpDir, 'Readest', 'Books', 'test.json'));
  });

  it('should resolve empty path to prefix', async () => {
    const resolved = await service.resolveFilePath('', 'Data');
    expect(resolved).toBe(path.join(tmpDir, 'Readest'));
  });

  it('should switch to new root via setCustomRootDir', async () => {
    const newRoot = await fsp.mkdtemp(path.join(SANDBOX_DIR, 'custom-'));
    try {
      await service.setCustomRootDir(newRoot);
      expect(service.localBooksDir).toBe(path.join(newRoot, 'Readest', 'Books'));
      await service.writeFile('test.txt', 'Settings', 'settings data');
      const content = await service.readFile('test.txt', 'Settings', 'text');
      expect(content).toBe('settings data');
    } finally {
      await fsp.rm(newRoot, { recursive: true, force: true });
    }
  });

  it('should use system dirs when no customRootDir', async () => {
    const defaultService = new NodeAppService();
    const settingsPrefix = await defaultService.resolveFilePath('', 'Settings');
    expect(settingsPrefix).toBeTruthy();
    expect(path.isAbsolute(settingsPrefix)).toBe(true);
    expect(settingsPrefix.toLowerCase()).toContain('readest');
  });

  fsTests(() => service);
  libraryTests(() => service);
  bookTests(() => service, getBookFile);
});
