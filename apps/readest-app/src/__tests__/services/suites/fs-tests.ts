import { describe, it, expect } from 'vitest';
import { AppService } from '@/types/system';

export function fsTests(getService: () => AppService) {
  describe('FileSystem', () => {
    it('should write and read text files', async () => {
      const service = getService();
      await service.writeFile('test.txt', 'Data', 'hello world');
      const content = await service.readFile('test.txt', 'Data', 'text');
      expect(content).toBe('hello world');
    });

    it('should write and read binary files', async () => {
      const service = getService();
      const data = new Uint8Array([1, 2, 3, 4]).buffer;
      await service.writeFile('test.bin', 'Data', data);
      const content = await service.readFile('test.bin', 'Data', 'binary');
      expect(new Uint8Array(content as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it('should check file existence', async () => {
      const service = getService();
      expect(await service.exists('missing.txt', 'Data')).toBe(false);
      await service.writeFile('exists.txt', 'Data', 'content');
      expect(await service.exists('exists.txt', 'Data')).toBe(true);
    });

    it('should delete files', async () => {
      const service = getService();
      await service.writeFile('deleteme.txt', 'Data', 'content');
      expect(await service.exists('deleteme.txt', 'Data')).toBe(true);
      await service.deleteFile('deleteme.txt', 'Data');
      expect(await service.exists('deleteme.txt', 'Data')).toBe(false);
    });

    it('should create and remove directories', async () => {
      const service = getService();
      await service.createDir('sub/nested', 'Data', true);
      expect(await service.exists('sub/nested', 'Data')).toBe(true);
      await service.deleteDir('sub', 'Data', true);
      expect(await service.exists('sub', 'Data')).toBe(false);
    });

    it('should read directory contents recursively', async () => {
      const service = getService();
      await service.writeFile('a.txt', 'Data', 'a');
      await service.writeFile('sub/b.txt', 'Data', 'b');
      const items = await service.readDirectory('', 'Data');
      const paths = items.map((i) => i.path).sort();
      expect(paths).toContain('a.txt');
      expect(paths.some((p) => p.endsWith('b.txt'))).toBe(true);
    });

    it('should open files', async () => {
      const service = getService();
      await service.writeFile('open.txt', 'Data', 'file content');
      const file = await service.openFile('open.txt', 'Data');
      expect(file.name).toBe('open.txt');
      const text = await file.text();
      expect(text).toBe('file content');
    });
  });
}
