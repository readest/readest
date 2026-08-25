import { describe, expect, it, vi } from 'vitest';
import { observeDynamicResources } from '@/utils/dynamicResources';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const microtask = () => Promise.resolve();

const makeDoc = () => document.implementation.createHTMLDocument('');

const makeLoader = (map: Record<string, string>) =>
  vi.fn(async (href: string): Promise<string> => map[href] ?? href);

describe('observeDynamicResources', () => {
  it('resolves the src of a media element a script inserts after load', async () => {
    const doc = makeDoc();
    const loadHref = makeLoader({ '../video/clip.mp4': 'blob:null/clip' });
    observeDynamicResources(doc, loadHref);

    const video = doc.createElement('video');
    video.setAttribute('src', '../video/clip.mp4');
    doc.body.appendChild(video);
    await flush();

    expect(loadHref).toHaveBeenCalledWith('../video/clip.mp4');
    expect(video.getAttribute('src')).toBe('blob:null/clip');
  });

  it('parks an unresolved src while it loads so the bad URL never errors', async () => {
    // Kotobee tears its player down on the media `error` event, which the
    // unresolvable relative URL fires long before a multi-MB clip is read out
    // of the zip. Removing `src` re-runs the load algorithm, cancelling it.
    const doc = makeDoc();
    let release!: (url: string) => void;
    const loadHref = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    observeDynamicResources(doc, loadHref);

    const video = doc.createElement('video');
    video.setAttribute('src', '../video/clip.mp4');
    doc.body.appendChild(video);
    await microtask();

    expect(video.hasAttribute('src')).toBe(false);
    release('blob:null/clip');
    await flush();
    expect(video.getAttribute('src')).toBe('blob:null/clip');
  });

  it('restores a reference the loader cannot resolve without looping', async () => {
    const doc = makeDoc();
    const loadHref = makeLoader({});
    observeDynamicResources(doc, loadHref);

    const script = doc.createElement('img');
    script.setAttribute('src', '../../_kmeta/missing.png');
    doc.body.appendChild(script);
    await flush();
    await flush();

    expect(script.getAttribute('src')).toBe('../../_kmeta/missing.png');
    expect(loadHref).toHaveBeenCalledTimes(1);
  });

  it('leaves absolute, blob, data and fragment references alone', async () => {
    const doc = makeDoc();
    const loadHref = makeLoader({});
    observeDynamicResources(doc, loadHref);

    const urls = ['blob:http://x/1', 'data:image/png;base64,AA==', 'https://a.b/c.mp4', '#frag'];
    for (const url of urls) {
      const img = doc.createElement('img');
      img.setAttribute('src', url);
      doc.body.appendChild(img);
    }
    await flush();

    expect(loadHref).not.toHaveBeenCalled();
    expect([...doc.querySelectorAll('img')].map((el) => el.getAttribute('src'))).toEqual(urls);
  });

  it('resolves a poster and an inline background-image url()', async () => {
    const doc = makeDoc();
    const loadHref = makeLoader({
      '../imgs/splash.png': 'blob:null/splash',
      '../video/clip.mp4': 'blob:null/clip',
    });
    observeDynamicResources(doc, loadHref);

    const video = doc.createElement('video');
    video.setAttribute('src', '../video/clip.mp4');
    video.setAttribute('poster', '../imgs/splash.png');
    doc.body.appendChild(video);
    const widget = doc.createElement('div');
    doc.body.appendChild(widget);
    await flush();
    widget.setAttribute('style', 'width: 10px; background-image: url("../imgs/splash.png");');
    await flush();

    expect(video.getAttribute('poster')).toBe('blob:null/splash');
    expect(widget.getAttribute('style')).toContain('url("blob:null/splash")');
    expect(widget.getAttribute('style')).toContain('width: 10px');
  });

  it('resolves references already present when observing starts', async () => {
    const doc = makeDoc();
    doc.body.innerHTML =
      '<div style="background-image: url(../imgs/splash.png)"><img src="../imgs/icon.png"></div>';
    const loadHref = makeLoader({
      '../imgs/splash.png': 'blob:null/splash',
      '../imgs/icon.png': 'blob:null/icon',
    });
    observeDynamicResources(doc, loadHref);
    await flush();

    expect(doc.querySelector('img')?.getAttribute('src')).toBe('blob:null/icon');
    expect(doc.querySelector('div')?.getAttribute('style')).toContain('url("blob:null/splash")');
  });

  it('reloads the parent media element when a <source> child is resolved', async () => {
    const doc = makeDoc();
    const loadHref = makeLoader({ '../audio/a.mp3': 'blob:null/a' });
    observeDynamicResources(doc, loadHref);

    const audio = doc.createElement('audio');
    const load = vi.fn();
    Object.defineProperty(audio, 'load', { value: load });
    const source = doc.createElement('source');
    source.setAttribute('src', '../audio/a.mp3');
    audio.appendChild(source);
    doc.body.appendChild(audio);
    await flush();

    expect(source.getAttribute('src')).toBe('blob:null/a');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps a src the script replaced while the first one was loading', async () => {
    const doc = makeDoc();
    let release!: (url: string) => void;
    const loadHref = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    observeDynamicResources(doc, loadHref);

    const video = doc.createElement('video');
    video.setAttribute('src', '../video/first.mp4');
    doc.body.appendChild(video);
    await microtask();
    video.setAttribute('src', 'blob:http://x/second');
    release('blob:null/first');
    await flush();

    expect(video.getAttribute('src')).toBe('blob:http://x/second');
  });

  it('keeps the newer source when the script swaps one relative src for another', async () => {
    // Both references are parked while they load, so "is the attribute back?"
    // cannot tell them apart: the newer request has to win on its own.
    const doc = makeDoc();
    const release = new Map<string, (url: string) => void>();
    const loadHref = vi.fn(
      (href: string) => new Promise<string>((resolve) => release.set(href, resolve)),
    );
    observeDynamicResources(doc, loadHref);

    const video = doc.createElement('video');
    video.setAttribute('src', '../video/first.mp4');
    doc.body.appendChild(video);
    await microtask();
    video.setAttribute('src', '../video/second.mp4');
    await flush();
    release.get('../video/first.mp4')!('blob:null/first');
    await flush();
    release.get('../video/second.mp4')!('blob:null/second');
    await flush();

    expect(video.getAttribute('src')).toBe('blob:null/second');
  });

  it('looks a reference up once per document, however many elements use it', async () => {
    // A script that rewrites an attribute whenever it changes would otherwise
    // drive an unbounded number of loader calls.
    const doc = makeDoc();
    const loadHref = makeLoader({ '../imgs/a.png': 'blob:null/a' });
    observeDynamicResources(doc, loadHref);

    const div = doc.createElement('div');
    div.innerHTML = '<img src="../imgs/a.png"><img src="../imgs/a.png">';
    div.setAttribute('style', 'background-image: url(../imgs/a.png)');
    doc.body.appendChild(div);
    await flush();

    expect(loadHref).toHaveBeenCalledTimes(1);
    expect([...doc.querySelectorAll('img')].map((el) => el.getAttribute('src'))).toEqual([
      'blob:null/a',
      'blob:null/a',
    ]);
    expect(div.getAttribute('style')).toContain('url("blob:null/a")');
  });

  it('keeps a poster the script replaced while the first one was loading', async () => {
    const doc = makeDoc();
    let release!: (url: string) => void;
    const loadHref = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    observeDynamicResources(doc, loadHref);

    const video = doc.createElement('video');
    video.setAttribute('poster', '../imgs/first.png');
    doc.body.appendChild(video);
    await microtask();
    video.setAttribute('poster', 'blob:http://x/second');
    release('blob:null/first');
    await flush();

    expect(video.getAttribute('poster')).toBe('blob:http://x/second');
  });

  it('resolves media in an XHTML section document, where tag names are lowercase', async () => {
    // EPUB sections are parsed as application/xhtml+xml, so `tagName` is
    // 'video', not 'VIDEO'; a case-sensitive check silently skips them.
    const doc = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body></body></html>',
      'application/xhtml+xml',
    );
    const loadHref = makeLoader({ '../video/clip.mp4': 'blob:null/clip' });
    observeDynamicResources(doc, loadHref);

    const video = doc.createElementNS('http://www.w3.org/1999/xhtml', 'video');
    video.setAttribute('src', '../video/clip.mp4');
    doc.body!.appendChild(video);
    await flush();

    expect(video.tagName).toBe('video');
    expect(video.getAttribute('src')).toBe('blob:null/clip');
  });

  it('stops resolving after disconnect', async () => {
    const doc = makeDoc();
    const loadHref = makeLoader({ '../video/clip.mp4': 'blob:null/clip' });
    const disconnect = observeDynamicResources(doc, loadHref);
    disconnect();

    const video = doc.createElement('video');
    video.setAttribute('src', '../video/clip.mp4');
    doc.body.appendChild(video);
    await flush();

    expect(loadHref).not.toHaveBeenCalled();
    expect(video.getAttribute('src')).toBe('../video/clip.mp4');
  });
});
