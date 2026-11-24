import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scriptPath = 'src-tauri/src/web_browser_image_selection.js';
const script = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';

const pickerCleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of pickerCleanups.splice(0)) cleanup();
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'elementsFromPoint');
});

function install(selectImage = true) {
  const location = { href: 'https://search.example/images?q=book', protocol: 'https:' };
  const browser = window;
  const listeners: Array<{ type: string; listener: EventListener }> = [];
  const addEventListener = browser.addEventListener.bind(browser);
  const removeEventListener = browser.removeEventListener.bind(browser);
  const pickerWindow = {
    top: null as unknown,
    document,
    location,
    addEventListener(type: string, listener: EventListener, capture: boolean) {
      listeners.push({ type, listener });
      addEventListener(type, listener, capture);
    },
  };
  pickerWindow.top = pickerWindow;
  pickerCleanups.push(() => {
    for (const { type, listener } of listeners) removeEventListener(type, listener, true);
  });
  runInNewContext(
    script.replace(
      '__READEST_BROWSER_OPTIONS__',
      JSON.stringify({
        selectImage,
        background: '#ffffff',
        foreground: '#000000',
        isEink: true,
        labels: { selectImage: 'Choose cover', imageSelectionHint: 'Choose an image now' },
      }),
    ),
    { window: pickerWindow, document, location, URL },
  );
  const host = document.getElementById('__readest_browser_image_selection__');
  const root = host?.shadowRoot;
  return {
    location,
    root,
    button: root?.querySelector('button'),
    use: root?.querySelector<HTMLButtonElement>('.use'),
  };
}

function image(src = '/large.jpg') {
  const img = document.createElement('img');
  img.src = src;
  document.body.append(img);
  return img;
}

describe('browser image selection', () => {
  it('requires explicitly arming selection and preserves ordinary preview clicks', () => {
    const { location, button, root } = install();
    expect(button?.textContent).toBe('Choose cover');
    const img = image('https://images.example/full.jpg');
    const preview = vi.fn();
    img.addEventListener('click', preview);
    img.click();
    expect(preview).toHaveBeenCalledOnce();
    expect(location.href).toBe('https://search.example/images?q=book');
    button!.click();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(root?.textContent).toContain('Choose an image now');
    img.click();
    expect(preview).toHaveBeenCalledOnce();
    expect(location.href).toBe('https://search.example/images?q=book');
    expect(root?.querySelector<HTMLImageElement>('.preview')?.src).toBe(
      'https://images.example/full.jpg',
    );
    root?.querySelector<HTMLButtonElement>('.use')?.click();
    const selected = new URL(location.href);
    expect(selected.host).toBe('readest-browser.invalid');
    expect(selected.pathname).toBe('/image');
    expect(selected.searchParams.get('url')).toBe('https://images.example/full.jpg');
    expect(selected.searchParams.get('pageUrl')).toBe('https://search.example/images?q=book');
  });

  it('uses responsive currentSrc and resolves relative sources against the page base', () => {
    const { location, button, use } = install();
    expect(button).toBeTruthy();
    const img = image();
    Object.defineProperty(img, 'currentSrc', { value: '/responsive/full.jpg?x=1&y=2' });
    button!.click();
    img.click();
    use?.click();
    expect(new URL(location.href).searchParams.get('url')).toBe(
      new URL('/responsive/full.jpg?x=1&y=2', document.baseURI).href,
    );
  });

  it.each([
    'data:image/png;base64,AA==',
    'blob:https://example.com/id',
    'file:///cover.jpg',
    'javascript:alert(1)',
    '',
  ])('does not select unsupported source %s', (src) => {
    const { location, button } = install();
    expect(button).toBeTruthy();
    button!.click();
    image(src).click();
    expect(location.href).toBe('https://search.example/images?q=book');
  });

  it('selects an image behind a preview overlay only after arming selection', () => {
    const { location, button, use } = install();
    const img = image('https://cdn.example/preview.jpg');
    const overlay = document.createElement('div');
    document.body.append(overlay);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [overlay, img],
    });
    overlay.click();
    expect(location.href).toBe('https://search.example/images?q=book');
    button!.click();
    overlay.click();
    use?.click();
    expect(new URL(location.href).searchParams.get('url')).toBe('https://cdn.example/preview.jpg');
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });

  it('does not select an image underneath a browser toolbar click', () => {
    const chrome = document.createElement('div');
    chrome.id = '__readest_browser_chrome__';
    document.body.append(chrome);
    const { location, button } = install();
    const img = image('https://cdn.example/under-toolbar.jpg');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [chrome, img],
    });
    button!.click();
    chrome.click();
    expect(location.href).toBe('https://search.example/images?q=book');
  });

  it('selects before page capture handlers can swallow an image click', () => {
    const swallow = (event: Event) => {
      if ((event.target as HTMLElement).tagName === 'IMG') event.stopImmediatePropagation();
    };
    document.addEventListener('click', swallow, true);
    const { location, button, use } = install();
    const img = image('https://cdn.example/full-cover.jpg');
    button!.click();
    img.click();
    document.removeEventListener('click', swallow, true);
    use?.click();
    expect(new URL(location.href).searchParams.get('url')).toBe(
      'https://cdn.example/full-cover.jpg',
    );
  });

  it('selects the visible image inside a same-origin preview iframe', () => {
    const { location, button, root, use } = install();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const img = frame.contentDocument!.createElement('img');
    img.src = 'https://cdn.example/framed-cover.jpg';
    frame.contentDocument!.body.append(img);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [frame],
    });
    Object.defineProperty(frame.contentDocument!, 'elementsFromPoint', { value: () => [img] });
    button!.click();
    root?.querySelector<HTMLElement>('.shield')?.click();
    expect(root?.querySelector<HTMLImageElement>('.preview')?.src).toBe(
      'https://cdn.example/framed-cover.jpg',
    );
    use?.click();
    expect(new URL(location.href).searchParams.get('url')).toBe(
      'https://cdn.example/framed-cover.jpg',
    );
  });

  it('does not select a background thumbnail through an inaccessible preview frame', () => {
    const { location, button, root } = install();
    const frame = document.createElement('iframe');
    document.body.append(frame);
    Object.defineProperty(frame, 'contentDocument', { get: () => null });
    const behind = image('https://cdn.example/background.jpg');
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [frame, behind],
    });
    button!.click();
    root?.querySelector<HTMLElement>('.shield')?.click();
    expect(location.href).toBe('https://search.example/images?q=book');
    expect(root?.querySelector<HTMLButtonElement>('.use')?.hidden).toBe(true);
  });

  it.each(['input', 'textarea'])('exits selection and focuses a clicked %s for editing', (tag) => {
    const { button, root, location } = install();
    const input = document.createElement(tag);
    document.body.append(input);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [input],
    });
    button!.click();
    root
      ?.querySelector<HTMLElement>('.shield')
      ?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true }),
      );
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(root?.querySelector<HTMLElement>('.shield')?.hidden).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(location.href).toBe('https://search.example/images?q=book');
  });

  it('lets a search field beneath a page overlay leave selection mode', () => {
    const { button, root } = install();
    const overlay = document.createElement('div');
    const input = document.createElement('input');
    document.body.append(overlay, input);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [overlay, input, document.body],
    });
    button!.click();
    root
      ?.querySelector<HTMLElement>('.shield')
      ?.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true }),
      );
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(input);
  });

  it('blocks the page pointer action while armed and preserves it when browsing', () => {
    const { button } = install();
    const img = image('https://cdn.example/cover.jpg');
    const navigate = vi.fn();
    img.addEventListener('pointerdown', navigate);
    img.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(navigate).toHaveBeenCalledOnce();
    button!.click();
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    img.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('can choose another image before confirming a cover', () => {
    const { location, button, use, root } = install();
    button!.click();
    image('https://cdn.example/first.jpg').click();
    expect(location.href).toBe('https://search.example/images?q=book');
    button!.click();
    expect(use?.hidden).toBe(true);
    image('https://cdn.example/second.jpg').click();
    expect(root?.querySelector<HTMLImageElement>('.preview')?.src).toBe(
      'https://cdn.example/second.jpg',
    );
    use?.click();
    expect(new URL(location.href).searchParams.get('url')).toBe('https://cdn.example/second.jpg');
  });

  it('explains unsupported thumbnails and returns to browsing for a full-size preview', () => {
    const { location, button, root } = install();
    button!.click();
    image('data:image/png;base64,AA==').click();
    expect(location.href).toBe('https://search.example/images?q=book');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(root?.querySelector('[role="status"]')?.textContent).toContain(
      'Open the full-size image',
    );
  });

  it('outlines the image under the pointer while choosing a cover', () => {
    const { button, root } = install();
    const img = image('https://cdn.example/cover.jpg');
    button!.click();
    img.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(root?.querySelector('.outline')?.hasAttribute('hidden')).toBe(false);
    button!.click();
    expect(root?.querySelector('.outline')?.hasAttribute('hidden')).toBe(true);
  });

  it('can cancel selection and ignores clicks on non-images', () => {
    const { location, button } = install();
    expect(button).toBeTruthy();
    button!.click();
    document.body.click();
    expect(location.href).toBe('https://search.example/images?q=book');
    button!.click();
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    image('https://example.com/cover.jpg').click();
    expect(location.href).toBe('https://search.example/images?q=book');
  });

  it('presents browsing, choosing and confirmation actions in one cover panel', () => {
    const { button, root } = install();
    expect(root?.querySelector('.picker')?.getAttribute('role')).toBe('region');
    expect(button?.textContent).toBe('Choose cover');
    expect(root?.querySelector('.heading')?.textContent).toBe('Book cover');
    button!.click();
    expect(button?.textContent).toBe('Cancel');
    image('https://cdn.example/cover.jpg').click();
    expect(button?.textContent).toBe('Choose another');
    expect(root?.querySelector('.use')?.textContent).toBe('Use this cover');
    expect(root?.querySelector('.heading')?.textContent).toBe('Cover selected');
  });

  it('leaves import and clip mode without selection controls', () => {
    const { button } = install(false);
    expect(button).toBeUndefined();
  });
});
