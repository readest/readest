import { describe, test, expect, beforeEach, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn().mockReturnValue({ label: 'main' }),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => {
  const mockOnce = vi.fn();
  return {
    WebviewWindow: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this['once'] = mockOnce;
    }),
  };
});

vi.mock('@/services/environment', () => ({
  isPWA: vi.fn().mockReturnValue(false),
  isWebAppPlatform: vi.fn().mockReturnValue(false),
}));

vi.mock('@/services/constants', () => ({
  BOOK_IDS_SEPARATOR: '+',
}));

import { redirect } from 'next/navigation';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isPWA, isWebAppPlatform } from '@/services/environment';
import {
  navigateToReader,
  navigateToLogin,
  navigateToProfile,
  navigateToLibrary,
  navigateToResetPassword,
  navigateToUpdatePassword,
  redirectToLibrary,
  showReaderWindow,
  showLibraryWindow,
} from '@/utils/nav';

// ── Helpers ──────────────────────────────────────────────────────────
function mockRouter() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  };
}

function makeAppService(isMacOS = false) {
  return { isMacOSApp: isMacOS } as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Reset default environment mock returns
  vi.mocked(isWebAppPlatform).mockReturnValue(false);
  vi.mocked(isPWA).mockReturnValue(false);

  // Reset window.location
  Object.defineProperty(window, 'location', {
    value: { pathname: '/library', search: '?q=test' },
    writable: true,
  });

  // Reset sessionStorage
  sessionStorage.clear();
});

// ── Tests ────────────────────────────────────────────────────────────
describe('navigateToReader', () => {
  test('navigates to /reader with ids param for non-web platform', () => {
    const router = mockRouter();
    navigateToReader(router, ['book1', 'book2']);

    expect(router.push).toHaveBeenCalledTimes(1);
    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('/reader?');
    expect(url).toContain('ids=book1%2Bbook2');
  });

  test('navigates to /reader/id for web platform (non-PWA)', () => {
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
    vi.mocked(isPWA).mockReturnValue(false);

    const router = mockRouter();
    navigateToReader(router, ['book1']);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toBe('/reader/book1');
  });

  test('web platform with PWA uses query param format', () => {
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
    vi.mocked(isPWA).mockReturnValue(true);

    const router = mockRouter();
    navigateToReader(router, ['book1']);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('/reader?');
    expect(url).toContain('ids=book1');
  });

  test('joins multiple book IDs with + separator', () => {
    const router = mockRouter();
    navigateToReader(router, ['a', 'b', 'c']);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('ids=a%2Bb%2Bc');
  });

  test('appends additional query params for non-web platform', () => {
    const router = mockRouter();
    navigateToReader(router, ['book1'], 'view=scroll');

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('view=scroll');
    expect(url).toContain('ids=book1');
  });

  test('appends additional query params for web platform', () => {
    vi.mocked(isWebAppPlatform).mockReturnValue(true);
    vi.mocked(isPWA).mockReturnValue(false);

    const router = mockRouter();
    navigateToReader(router, ['book1'], 'view=scroll');

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toBe('/reader/book1?view=scroll');
  });

  test('passes navOptions through', () => {
    const router = mockRouter();
    navigateToReader(router, ['book1'], undefined, { scroll: false });

    expect(router.push).toHaveBeenCalledWith(expect.stringContaining('/reader'), { scroll: false });
  });
});

describe('navigateToLogin', () => {
  test('navigates to /auth with redirect from current path', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/library', search: '?q=test' },
      writable: true,
    });

    const router = mockRouter();
    navigateToLogin(router);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('/auth?redirect=');
    expect(url).toContain(encodeURIComponent('/library?q=test'));
  });

  test('uses / as redirect when already on /auth', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/auth', search: '' },
      writable: true,
    });

    const router = mockRouter();
    navigateToLogin(router);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toBe('/auth?redirect=%2F');
  });
});

describe('navigateToProfile', () => {
  test('navigates to /user', () => {
    const router = mockRouter();
    navigateToProfile(router);

    expect(router.push).toHaveBeenCalledWith('/user');
  });
});

describe('navigateToLibrary', () => {
  test('replaces to /library without params by default', () => {
    const router = mockRouter();
    navigateToLibrary(router);

    expect(router.replace).toHaveBeenCalledWith('/library', undefined);
  });

  test('replaces to /library with query params', () => {
    const router = mockRouter();
    navigateToLibrary(router, 'sort=title');

    expect(router.replace).toHaveBeenCalledWith('/library?sort=title', undefined);
  });

  test('passes navOptions through', () => {
    const router = mockRouter();
    navigateToLibrary(router, undefined, { scroll: false });

    expect(router.replace).toHaveBeenCalledWith('/library', { scroll: false });
  });

  test('uses lastLibraryParams from sessionStorage when navBack=true', () => {
    sessionStorage.setItem('lastLibraryParams', 'sort=author&view=list');

    const router = mockRouter();
    navigateToLibrary(router, undefined, undefined, true);

    expect(router.replace).toHaveBeenCalledWith('/library?sort=author&view=list', undefined);
  });

  test('ignores lastLibraryParams when navBack=false', () => {
    sessionStorage.setItem('lastLibraryParams', 'sort=author');

    const router = mockRouter();
    navigateToLibrary(router, 'sort=title', undefined, false);

    expect(router.replace).toHaveBeenCalledWith('/library?sort=title', undefined);
  });

  test('falls back when lastLibraryParams is null and navBack=true', () => {
    const router = mockRouter();
    navigateToLibrary(router, 'sort=date', undefined, true);

    // Should still use the provided queryParams since sessionStorage has nothing
    expect(router.replace).toHaveBeenCalledWith('/library?sort=date', undefined);
  });
});

describe('redirectToLibrary', () => {
  test('calls redirect to /library', () => {
    redirectToLibrary();
    expect(redirect).toHaveBeenCalledWith('/library');
  });
});

describe('navigateToResetPassword', () => {
  test('navigates to /auth/recovery with redirect', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/settings', search: '' },
      writable: true,
    });

    const router = mockRouter();
    navigateToResetPassword(router);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('/auth/recovery?redirect=');
    expect(url).toContain(encodeURIComponent('/settings'));
  });

  test('uses / as redirect when on /auth', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/auth', search: '' },
      writable: true,
    });

    const router = mockRouter();
    navigateToResetPassword(router);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toBe('/auth/recovery?redirect=%2F');
  });
});

describe('navigateToUpdatePassword', () => {
  test('navigates to /auth/update with redirect', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/user', search: '?tab=security' },
      writable: true,
    });

    const router = mockRouter();
    navigateToUpdatePassword(router);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toContain('/auth/update?redirect=');
    expect(url).toContain(encodeURIComponent('/user?tab=security'));
  });

  test('uses / as redirect when on /auth', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/auth', search: '' },
      writable: true,
    });

    const router = mockRouter();
    navigateToUpdatePassword(router);

    const url = router.push.mock.calls[0]![0] as string;
    expect(url).toBe('/auth/update?redirect=%2F');
  });
});

describe('showReaderWindow', () => {
  test('creates a new WebviewWindow with correct URL', () => {
    const appService = makeAppService();
    showReaderWindow(appService as never, ['book1', 'book2']);

    expect(WebviewWindow).toHaveBeenCalled();
    const constructorCall = vi.mocked(WebviewWindow).mock.calls[0]!;
    const url = constructorCall[1]!.url as string;
    expect(url).toContain('/reader?');
    expect(url).toContain('ids=book1%2Bbook2');
  });

  test('uses macOS-specific window options', () => {
    const appService = makeAppService(true);
    showReaderWindow(appService as never, ['book1']);

    const constructorCall = vi.mocked(WebviewWindow).mock.calls[0]!;
    const options = constructorCall[1]!;
    expect(options.title).toBe('');
    expect(options.decorations).toBe(true);
    expect(options.titleBarStyle).toBe('overlay');
  });

  test('uses non-macOS window options', () => {
    const appService = makeAppService(false);
    showReaderWindow(appService as never, ['book1']);

    const constructorCall = vi.mocked(WebviewWindow).mock.calls[0]!;
    const options = constructorCall[1]!;
    expect(options.title).toBe('Readest');
    expect(options.decorations).toBe(false);
    expect(options.transparent).toBe(true);
    expect(options.shadow).toBe(true);
  });
});

describe('showLibraryWindow', () => {
  test('creates a new WebviewWindow with file params', () => {
    const appService = makeAppService();
    showLibraryWindow(appService as never, ['file1.epub', 'file2.epub']);

    expect(WebviewWindow).toHaveBeenCalled();
    const constructorCall = vi.mocked(WebviewWindow).mock.calls[0]!;
    const url = constructorCall[1]!.url as string;
    expect(url).toContain('/library?');
    expect(url).toContain('file=file1.epub');
    expect(url).toContain('file=file2.epub');
  });
});
