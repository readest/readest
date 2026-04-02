describe('Readest App Launch', () => {
  it('should have a visible body element', async () => {
    const body = await $('body');
    await body.waitForDisplayed({ timeout: 10000 });
    expect(await body.isDisplayed()).toBe(true);
  });

  it('should have the correct window handle', async () => {
    const handle = await browser.getWindowHandle();
    expect(handle).toBeTruthy();
  });

  it('should return the page source', async () => {
    const source = await browser.getPageSource();
    expect(source).toContain('html');
  });
});

describe('Library Page', () => {
  it('should navigate to the library page', async () => {
    const url = await browser.getUrl();
    expect(url).toMatch(/library|localhost/);
  });

  it('should display the library container', async () => {
    const library = await $('[aria-label="Your Library"]');
    await library.waitForExist({ timeout: 15000 });
    expect(await library.isExisting()).toBe(true);
  });

  it('should display the library header', async () => {
    const header = await $('[aria-label="Library Header"]');
    await header.waitForExist({ timeout: 10000 });
    expect(await header.isExisting()).toBe(true);
  });

  it('should display the bookshelf area', async () => {
    const bookshelf = await $('[aria-label="Bookshelf"]');
    await bookshelf.waitForExist({ timeout: 10000 });
    expect(await bookshelf.isExisting()).toBe(true);
  });

  it('should have a search input', async () => {
    const searchInput = await $('.search-input');
    await searchInput.waitForExist({ timeout: 10000 });
    expect(await searchInput.isExisting()).toBe(true);
  });

  it('should allow typing in the search input', async () => {
    const searchInput = await $('.search-input');
    await searchInput.waitForDisplayed({ timeout: 10000 });
    await searchInput.setValue('test search');
    const value = await searchInput.getValue();
    expect(value).toBe('test search');
  });

  it('should show the clear search button after typing', async () => {
    const clearBtn = await $('[aria-label="Clear Search"]');
    await clearBtn.waitForExist({ timeout: 5000 });
    expect(await clearBtn.isExisting()).toBe(true);
  });

  it('should clear the search input when clear button is clicked', async () => {
    const clearBtn = await $('[aria-label="Clear Search"]');
    await clearBtn.click();
    const searchInput = await $('.search-input');
    const value = await searchInput.getValue();
    expect(value).toBe('');
  });

  it('should have a select books button', async () => {
    const selectBtn = await $('[aria-label="Select Books"]');
    await selectBtn.waitForExist({ timeout: 10000 });
    expect(await selectBtn.isExisting()).toBe(true);
  });

  it('should have an import books button', async () => {
    const importBtn = await $('[aria-label="Import Books"]');
    await importBtn.waitForExist({ timeout: 10000 });
    expect(await importBtn.isExisting()).toBe(true);
  });
});

describe('Window Management', () => {
  it('should return the window size', async () => {
    const size = await browser.getWindowSize();
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});

describe('JavaScript Execution', () => {
  it('should execute JavaScript in the app context', async () => {
    const result = await browser.execute(() => {
      return document.readyState;
    });
    expect(result).toBe('complete');
  });

  it('should access the document title via JS', async () => {
    const title = await browser.execute(() => {
      return document.title;
    });
    expect(title).toContain('Readest');
  });

  it('should detect the app platform globals', async () => {
    const hasCLIAccess = await browser.execute(() => {
      return (window as unknown as Record<string, unknown>).__READEST_CLI_ACCESS === true;
    });
    expect(hasCLIAccess).toBe(true);
  });
});

describe('Navigation', () => {
  it('should navigate back to library after visiting another route', async () => {
    const currentUrl = await browser.getUrl();
    await browser.url(currentUrl.replace(/\/[^/]*$/, '/library'));
    const library = await $('[aria-label="Your Library"]');
    await library.waitForExist({ timeout: 15000 });
    expect(await library.isExisting()).toBe(true);
  });
});
