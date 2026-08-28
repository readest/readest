/**
 * The translator popup divides its capped height between the original pane and
 * the translated pane — both scroll — while the divider and the provider footer
 * stay pinned.
 *
 * Assert the resolved layout, never the class string. `grid-rows-[1fr,auto,1fr,auto]`
 * looked right and sat in the class attribute, but Tailwind emits arbitrary
 * values verbatim, so it produced `grid-template-rows:1fr,auto,1fr,auto`. Commas
 * are not track separators, the browser threw the declaration away, and every row
 * fell back to an implicit auto track sized to its content. On a phone that
 * pushed the translated text and the whole provider footer past the popup's own
 * max height, with nothing scrollable to reach them.
 *
 * A bare `1fr` would not have been enough either: it floors at min-content, so
 * the rows still refuse to shrink inside the capped popup. Each flexible track
 * needs `minmax(0,...)`.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

vi.mock('@/hooks/useKeyDownActions', () => ({ useKeyDownActions: () => {} }));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ token: 'test-token' }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {
      globalReadSettings: { translateTargetLang: 'zh-CN', translationProvider: 'google' },
    },
    setSettings: vi.fn(),
  }),
}));

// Long enough that either pane on its own would outgrow the capped popup.
const LONG_SOURCE =
  'The plaint about the lost art of diagramming sentences refers to a notation that was ' +
  'invented by Alonzo Reed and Brainerd Kellogg in 1877 and taught in American schools ' +
  'until the 1960s, when it fell victim to the revolt among educators against all things formal.';
const LONG_TRANSLATION =
  '关于绘制句子的失落艺术的抱怨是指一种符号，由Alonzo Reed和Brainerd Kellogg于1877年发明，' +
  '并在美国学校教授，直到20世纪60年代，当时它成为教育工作者反对所有正式事物的反抗的牺牲品。';

vi.mock('@/hooks/useTranslator', async () => {
  // The real registry, so the footer renders real provider labels.
  const { getTranslators } = await import('@/services/translators');
  const translators = getTranslators();
  return {
    useTranslator: () => ({
      translate: async (texts: string[]) => texts.map(() => LONG_TRANSLATION),
      translator: translators.find((t) => t.name === 'google'),
      translators,
      loading: false,
    }),
  };
});

const { default: TranslatorPopup } = await import(
  '@/app/reader/components/annotator/TranslatorPopup'
);

beforeAll(async () => {
  await page.viewport(400, 700);
});

afterEach(() => cleanup());

const renderPopup = () =>
  render(
    <TranslatorPopup
      text={LONG_SOURCE}
      // Attached low on a short viewport, so the popup is height-capped hard.
      position={{ dir: 'down', point: { x: 20, y: 390 } }}
      trianglePosition={{ dir: 'down', point: { x: 100, y: 380 } }}
      popupWidth={360}
      popupHeight={200}
    />,
  );

const getPopup = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('.popup-container')!;

describe('TranslatorPopup layout', () => {
  it('emits a grid-template-rows declaration the browser actually accepts', async () => {
    const { container } = renderPopup();
    const popup = getPopup(container);
    await waitFor(() => expect(popup.textContent).toContain(LONG_TRANSLATION));

    // Read the class off the rendered popup so this stays tied to the component
    // rather than to a copy of its class string.
    const gridClass = [...popup.classList].find((c) => c.startsWith('grid-rows-'));
    expect(gridClass).toBeDefined();

    // An *empty* grid reports its explicit tracks (as 0px each) and reports
    // `none` when the declaration was thrown away. On the popup itself the
    // computed value is the used track sizes either way, so a dropped
    // declaration is indistinguishable there — hence the bare probe.
    const probe = document.createElement('div');
    probe.className = gridClass!;
    probe.style.display = 'grid';
    document.body.appendChild(probe);
    try {
      expect(getComputedStyle(probe).gridTemplateRows).not.toBe('none');
    } finally {
      probe.remove();
    }
  });

  it('keeps the provider footer inside the popup instead of off screen', async () => {
    const { container } = renderPopup();
    const popup = getPopup(container);
    await waitFor(() => expect(popup.textContent).toContain(LONG_TRANSLATION));

    const popupRect = popup.getBoundingClientRect();
    const footer = popup.children[3] as HTMLElement;
    const footerRect = footer.getBoundingClientRect();

    expect(footer.textContent).toMatch(/Translated by/);
    // Rounded: sub-pixel grid track sizing lands a fraction over the edge.
    expect(Math.round(footerRect.bottom)).toBeLessThanOrEqual(Math.round(popupRect.bottom));
    expect(Math.round(footerRect.bottom)).toBeLessThanOrEqual(window.innerHeight);
  });

  it('lets both panes scroll rather than overflowing the popup', async () => {
    const { container } = renderPopup();
    const popup = getPopup(container);
    await waitFor(() => expect(popup.textContent).toContain(LONG_TRANSLATION));

    // The popup itself never scrolls; the two panes do.
    expect(popup.scrollHeight).toBeLessThanOrEqual(popup.clientHeight + 1);

    const originalPane = popup.children[0] as HTMLElement;
    const translatedPane = popup.children[2] as HTMLElement;
    for (const pane of [originalPane, translatedPane]) {
      expect(getComputedStyle(pane).overflowY).toBe('auto');
      expect(pane.scrollHeight).toBeGreaterThan(pane.clientHeight);
    }
  });
});
