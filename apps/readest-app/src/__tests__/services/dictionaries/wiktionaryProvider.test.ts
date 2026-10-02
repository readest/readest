import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wiktionaryProvider } from '@/services/dictionaries/providers/wiktionaryProvider';
import { BUILTIN_PROVIDER_IDS } from '@/services/dictionaries/types';

const sampleResponse = {
  en: [
    {
      partOfSpeech: 'Noun',
      language: 'English',
      definitions: [
        {
          definition:
            'A <a rel="mw:WikiLink" title="cat" href="/wiki/cat">cat</a> is a small animal.',
          examples: ['<i>The cat sat on the mat.</i>'],
        },
      ],
    },
  ],
};

describe('wiktionary provider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the expected metadata', () => {
    expect(wiktionaryProvider.id).toBe(BUILTIN_PROVIDER_IDS.wiktionary);
    expect(wiktionaryProvider.kind).toBe('builtin');
  });

  it('renders results into the supplied container and reports success', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wiktionaryProvider.lookup('cat', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.headword).toBe('cat');
      expect(outcome.sourceLabel).toContain('Wiktionary');
    }
    expect(container.querySelector('h1')?.textContent).toBe('cat');
    expect(container.querySelector('h2')?.textContent).toBe('Noun');
    expect(container.querySelector('ol li')?.textContent).toContain('is a small animal');
  });

  it('rewires WikiLinks to call onNavigate instead of following the href', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => sampleResponse,
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();
    const onNavigate = vi.fn();

    await wiktionaryProvider.lookup('cat', {
      lang: 'en',
      signal: controller.signal,
      container,
      onNavigate,
    });

    const link = container.querySelector<HTMLAnchorElement>('a[rel="mw:WikiLink"]');
    expect(link).toBeTruthy();
    expect(link!.className).toContain('underline');
    link!.click();
    expect(onNavigate).toHaveBeenCalledWith('cat');
  });

  it('returns empty when the API has no entries for the requested language', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wiktionaryProvider.lookup('zzznonsense', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('empty');
  });

  it('returns error on HTTP failure', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    const container = document.createElement('div');
    const controller = new AbortController();

    const outcome = await wiktionaryProvider.lookup('cat', {
      lang: 'en',
      signal: controller.signal,
      container,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('error');
  });

  describe('native-language editions', () => {
    const esPage = `
      <div class="mw-content-ltr mw-parser-output" lang="es" dir="ltr">
        <div class="mw-heading mw-heading2"><h2 id="Español">Español</h2></div>
        <style>.pron-graf{float:right}</style>
        <table class="pron-graf"><tr><td>pronunciación</td></tr></table>
        <div class="mw-heading mw-heading3"><h3>Etimología</h3></div>
        <p>Del latín <a href="/wiki/casa#Latín" title="casa">casa</a>.</p>
        <div class="mw-heading mw-heading4"><h4>Sustantivo femenino</h4></div>
        <dl><dt>1</dt><dd>Edificación destinada a <a href="/wiki/vivienda" title="vivienda">vivienda</a>.<sup class="reference">[1]</sup></dd></dl>
        <dl><dd><ul><li><b>Ejemplo:</b> <div class="mw-collapsible mw-collapsed"><blockquote><p>Vivo en una casa grande.</p></blockquote></div></li></ul></dd></dl>
        <dl><dt>2</dt><dd>Véase <a href="/w/index.php?title=hogarx&amp;action=edit&amp;redlink=1" class="new" title="hogarx (la página no existe)">hogarx</a>.</dd></dl>
        <div class="mw-heading mw-heading4"><h4>Traducciones</h4></div>
        <div class="trad-arriba mw-collapsible"><ul><li>Inglés: house</li></ul></div>
        <div class="mw-heading mw-heading2"><h2 id="Aragonés">Aragonés</h2></div>
        <dl><dd>Definición aragonesa.</dd></dl>
      </div>`;

    const parseResponse = (text: string, title = 'casa') =>
      ({ ok: true, json: async () => ({ parse: { title, text } }) }) as Response;

    const lookup = (word: string, lang: string, onNavigate?: (word: string) => void) => {
      const container = document.createElement('div');
      const outcome = wiktionaryProvider.lookup(word, {
        lang,
        signal: new AbortController().signal,
        container,
        onNavigate,
      });
      return { container, outcome };
    };

    it('queries the Wiktionary edition matching the book language', async () => {
      fetchMock.mockResolvedValueOnce(parseResponse(esPage));
      const { outcome } = lookup('casa', 'es-ES');
      expect((await outcome).ok).toBe(true);
      const url = new URL(fetchMock.mock.calls[0]![0] as string);
      expect(url.origin).toBe('https://es.wiktionary.org');
      expect(url.pathname).toBe('/w/api.php');
      expect(url.searchParams.get('action')).toBe('parse');
      expect(url.searchParams.get('page')).toBe('casa');
      expect(url.searchParams.get('origin')).toBe('*');
    });

    it('renders only the section for the book language, without tables or styles', async () => {
      fetchMock.mockResolvedValueOnce(parseResponse(esPage));
      const { container, outcome } = lookup('casa', 'es');
      const result = await outcome;

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.headword).toBe('casa');
      expect(container.querySelector('h1')?.textContent).toBe('casa');
      expect(container.querySelector('hgroup p')?.textContent).toBe('Español');
      expect(container.textContent).toContain('Del latín');
      expect(container.textContent).toContain('Edificación destinada a vivienda.');
      expect(container.textContent).toContain('Vivo en una casa grande.');
      expect(container.textContent).not.toContain('Inglés: house');
      expect(container.textContent).not.toContain('Definición aragonesa');
      expect(container.textContent).not.toContain('pronunciación');
      expect(container.textContent).not.toContain('[1]');
      expect(container.querySelector('style, table')).toBeNull();
    });

    it('drops headings left empty once their content is stripped', async () => {
      fetchMock.mockResolvedValueOnce(parseResponse(esPage));
      const { container, outcome } = lookup('casa', 'es');
      await outcome;
      const headings = Array.from(container.querySelectorAll('h2, h3')).map((h) => h.textContent);
      expect(headings).toEqual(['Etimología', 'Sustantivo femenino']);
    });

    it('routes wiki links through onNavigate and unwraps links to missing pages', async () => {
      fetchMock.mockResolvedValueOnce(parseResponse(esPage));
      const onNavigate = vi.fn();
      const { container, outcome } = lookup('casa', 'es', onNavigate);
      await outcome;

      const links = Array.from(container.querySelectorAll('a'));
      expect(links.map((a) => a.textContent)).toEqual(['casa', 'vivienda']);
      links[1]!.click();
      expect(onNavigate).toHaveBeenCalledWith('vivienda');
      expect(container.textContent).toContain('Véase hogarx.');
    });

    it('matches the language name as a whole word', async () => {
      const dePage = `
        <div class="mw-parser-output">
          <div class="mw-heading mw-heading2"><h2>Haus (Niederdeutsch)</h2></div>
          <p>Niederdeutsche Bedeutung</p>
          <div class="mw-heading mw-heading2"><h2>Haus (Deutsch)</h2></div>
          <p>Hochdeutsche Bedeutung</p>
        </div>`;
      fetchMock.mockResolvedValueOnce(parseResponse(dePage, 'Haus'));
      const { container, outcome } = lookup('Haus', 'de');
      await outcome;
      expect(container.textContent).toContain('Hochdeutsche Bedeutung');
      expect(container.textContent).not.toContain('Niederdeutsche Bedeutung');
    });

    it('sizes subheadings relative to the shallowest one in the section', async () => {
      const ruPage = `
        <div class="mw-parser-output">
          <div class="mw-heading mw-heading1"><h1>Русский</h1></div>
          <div class="mw-heading mw-heading3"><h3>Семантические свойства</h3></div>
          <div class="mw-heading mw-heading4"><h4>Значение</h4></div>
          <ol><li>здание</li></ol>
        </div>`;
      fetchMock.mockResolvedValueOnce(parseResponse(ruPage, 'дом'));
      const { container, outcome } = lookup('дом', 'ru');
      await outcome;
      expect(container.querySelector('h2')?.textContent).toBe('Семантические свойства');
      expect(container.querySelector('h3')?.textContent).toBe('Значение');
    });

    it('falls back to English Wiktionary when the edition has no page', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ error: { code: 'missingtitle' } }),
        } as Response)
        .mockResolvedValueOnce({ ok: true, json: async () => sampleResponse } as Response);
      const { container, outcome } = lookup('cat', 'es');

      expect((await outcome).ok).toBe(true);
      expect(fetchMock.mock.calls[1]![0]).toContain('https://en.wiktionary.org/api/rest_v1/');
      expect(container.querySelector('ol li')?.textContent).toContain('is a small animal');
    });

    it('falls back to English Wiktionary when the page has no section for the language', async () => {
      fetchMock
        .mockResolvedValueOnce(
          parseResponse('<div class="mw-parser-output"><h2>Inglés</h2><p>x</p></div>', 'cat'),
        )
        .mockResolvedValueOnce({ ok: true, json: async () => sampleResponse } as Response);
      const { container, outcome } = lookup('cat', 'es');

      expect((await outcome).ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain('Inglés');
    });

    it('falls back to English Wiktionary when the edition cannot be reached', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({ ok: true, json: async () => sampleResponse } as Response);
      const { outcome } = lookup('cat', 'xx');

      expect((await outcome).ok).toBe(true);
      expect(fetchMock.mock.calls[1]![0]).toContain('https://en.wiktionary.org/api/rest_v1/');
    });

    it('never builds a host from a malformed book language', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => sampleResponse } as Response);
      for (const lang of ['evil.example#', 'evil.example/', 'es.evil', 'e s']) {
        await lookup('cat', lang).outcome;
      }
      for (const [url] of fetchMock.mock.calls) {
        expect(new URL(url as string).hostname).toBe('en.wiktionary.org');
      }
    });

    it('keeps using the English endpoint for English books', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => sampleResponse } as Response);
      await lookup('cat', 'en-US').outcome;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toContain('https://en.wiktionary.org/api/rest_v1/');
    });
  });
});
