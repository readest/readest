import { describe, test, expect } from 'vitest';
import { isStoragePermissionError } from '@/utils/permission';

describe('isStoragePermissionError', () => {
  test('detects Android EACCES / permission-denied save failures', () => {
    expect(
      isStoragePermissionError(
        new Error(
          'Failed to save library.json: failed to open file at path: ' +
            '/storage/emulated/0/Readest/Books/library.json.bak with error: ' +
            'Permission denied (os error 13)',
        ),
      ),
    ).toBe(true);
    expect(isStoragePermissionError('EACCES: permission denied')).toBe(true);
  });

  test('ignores unrelated errors', () => {
    expect(isStoragePermissionError(new Error('disk full'))).toBe(false);
    expect(isStoragePermissionError(new Error('JSON parse error'))).toBe(false);
    expect(isStoragePermissionError(undefined)).toBe(false);
  });
});
