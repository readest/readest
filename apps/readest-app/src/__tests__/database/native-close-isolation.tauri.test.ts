import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, remove } from '@tauri-apps/plugin-fs';
import { NativeDatabaseService } from '@/services/database/nativeDatabaseService';

// Nested under the webdriver capability's allowed fs scope
// (**/.readest-test-sandbox-tauri/**), in a subdir of our own so cleanup
// cannot collide with other test files using the same sandbox root.
const SANDBOX_DIR = `${process.env['CWD']}/.readest-test-sandbox-tauri/db-close-isolation`;

describe('NativeDatabaseService (native Tauri)', () => {
  beforeAll(async () => {
    await mkdir(SANDBOX_DIR, { recursive: true });
  });

  afterAll(async () => {
    await remove(SANDBOX_DIR, { recursive: true });
  });

  // The plugin's arg-less close() drains every open connection app-wide, so a
  // service closing "its own" database must pass its path or it kills every
  // other database too (statistics.db "database ... not loaded", READEST-6).
  it('closing one database leaves other connections loaded', async () => {
    const a = await NativeDatabaseService.open(`sqlite:${SANDBOX_DIR}/close-isolation-a.db`);
    const b = await NativeDatabaseService.open(`sqlite:${SANDBOX_DIR}/close-isolation-b.db`);
    try {
      await b.close();
      await expect(a.select<{ one: number }>('SELECT 1 AS one')).resolves.toEqual([{ one: 1 }]);
    } finally {
      await a.close().catch(() => {});
    }
  });
});
