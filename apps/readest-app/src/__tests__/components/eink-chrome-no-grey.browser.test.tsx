/**
 * E-ink chrome draws in ink, not grey (#7817).
 *
 * A mono e-ink panel renders a grey fill as a dithered wash that ghosts on
 * every refresh. The sidebar tab bar, the TOC's current-position row, the
 * settings steppers and font menu, and daisyUI's switches all drew grey on
 * e-ink. On e-ink they now use base-100 surfaces with base-content outlines:
 * an active tab or a live stepper is outlined, a switch knob is filled when on
 * and hollow when off, and a disabled switch dashes its track and keeps its
 * knob on its side. Off e-ink nothing changes.
 *
 * Assert resolved colors in Chromium with the real stylesheet, not class
 * strings.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: null }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (n: number) => n,
  useDefaultIconSize: () => 20,
}));

const { default: TabNavigation } = await import('@/app/reader/components/sidebar/TabNavigation');
const { CurrentPositionRow } = await import('@/app/reader/components/sidebar/TOCItem');
const { default: NumberInput } = await import('@/components/settings/NumberInput');
const { default: FontDropdown } = await import('@/components/settings/FontDropDown');
const { default: Ribbon } = await import('@/app/reader/components/Ribbon');
await import('@/styles/globals.css');

// Wide enough for the `sm:` styles the sidebar uses on tablets and desktops.
beforeAll(async () => {
  await page.viewport(1024, 768);
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-eink');
  document.documentElement.removeAttribute('data-theme');
});

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const setMode = (eink: boolean) => {
  document.documentElement.setAttribute('data-theme', 'default-light');
  if (eink) document.documentElement.setAttribute('data-eink', 'true');
};

// The theme's paper and ink, resolved the same way as the elements under test.
const themeColors = () => {
  const { container } = render(
    <>
      <div data-testid='paper' className='bg-base-100' />
      <div data-testid='ink' className='bg-base-content' />
    </>,
  );
  const bg = (id: string) =>
    getComputedStyle(container.querySelector(`[data-testid="${id}"]`)!).backgroundColor;
  return { paper: bg('paper'), ink: bg('ink') };
};

const style = (el: Element, pseudo?: string) => getComputedStyle(el, pseudo);

const renderChrome = () => {
  render(
    <div style={{ width: 320, padding: 300 }}>
      <TabNavigation activeTab='toc' onTabChange={() => {}} />
      <CurrentPositionRow depth={1} page={42} />
      <NumberInput label='Font Size' value={16} min={8} max={72} onChange={() => {}} />
      <NumberInput label='Line Spacing' value={1.4} min={1} max={3} disabled onChange={() => {}} />
      <FontDropdown
        family='serif'
        selected='Bitter'
        options={[{ option: 'Bitter' }]}
        onSelect={() => {}}
        onGetFontFamily={(option) => option}
      />
    </div>,
  );
  const [enabledMinus, disabledMinus] = document.querySelectorAll<HTMLElement>(
    'button[aria-label="Decrease"]',
  );
  return {
    tabBar: document.querySelector('.bottom-tab')!,
    activeTab: document.querySelector('[aria-pressed="true"]')!,
    currentRow: document.querySelector('[role="treeitem"][aria-current="true"]')!,
    stepper: enabledMinus!,
    disabledStepper: disabledMinus!,
    fontButton: document.querySelector('.dropdown > button')!,
    fontList: document.querySelector('.dropdown-content')!,
  };
};

describe('e-ink chrome without grey (#7817)', () => {
  it('draws the sidebar tabs, current row, steppers and font menu in ink', () => {
    setMode(true);
    const { paper, ink } = themeColors();
    const el = renderChrome();

    expect(style(el.tabBar).backgroundColor).toBe(paper);
    expect(style(el.tabBar).borderTopColor).toBe(ink);

    expect(style(el.activeTab).backgroundColor).toBe(paper);
    expect(style(el.activeTab).borderTopWidth).toBe('1px');
    expect(style(el.activeTab).borderTopColor).toBe(ink);

    expect(style(el.currentRow).backgroundColor).toBe(TRANSPARENT);

    expect(style(el.stepper).backgroundColor).toBe(paper);
    expect(style(el.stepper).borderTopColor).toBe(ink);
    // A stepper that can't act has no outline, so the two read apart.
    expect(style(el.disabledStepper).borderTopColor).not.toBe(ink);

    expect(style(el.fontButton).backgroundColor).toBe(paper);
    expect(style(el.fontButton).borderTopColor).toBe(ink);
    expect(style(el.fontList).backgroundColor).toBe(paper);
    expect(style(el.fontList).borderTopColor).toBe(ink);
  });

  it("lines the sidebar tab bar's top rule up with the footer bar's", () => {
    setMode(true);
    renderChrome();
    const bar = document.querySelector('.bottom-tab')!;
    const iconTop = (tab: Element) => tab.querySelector('svg')!.getBoundingClientRect().top;
    const [active, inactive] = [
      bar.querySelector('[aria-pressed="true"]')!,
      bar.querySelector('[aria-pressed="false"]')!,
    ];

    // The desktop footer bar is 52px tall (`sm:h-[52px]`), rule included.
    expect(bar.getBoundingClientRect().height).toBe(52);
    // The active tab's outline doesn't push its icon off the row.
    expect(iconTop(active)).toBe(iconTop(inactive));
  });

  // Under 640px tall the sidebar takes its 65px phone tab bar, but the footer
  // keeps 52px while the window is 640px wide or more.
  it.each([
    { w: 1024, h: 600, eink: true, height: 52 },
    { w: 1024, h: 600, eink: false, height: 65 },
    { w: 400, h: 800, eink: true, height: 65 },
  ])('makes the tab bar $height px at $w x $h, e-ink $eink', async ({ w, h, eink, height }) => {
    await page.viewport(w, h);
    setMode(eink);
    renderChrome();

    expect(document.querySelector('.bottom-tab')!.getBoundingClientRect().height).toBe(height);
    await page.viewport(1024, 768);
  });

  it('leaves them as they were off e-ink', () => {
    setMode(false);
    const { paper, ink } = themeColors();
    const el = renderChrome();

    for (const node of [el.tabBar, el.activeTab, el.currentRow, el.stepper, el.fontButton]) {
      expect(style(node).backgroundColor).not.toBe(paper);
      expect(style(node).backgroundColor).not.toBe(TRANSPARENT);
    }
    expect(style(el.activeTab).borderTopWidth).toBe('0px');
    expect(style(el.stepper).borderTopColor).not.toBe(ink);
  });

  it('draws switches in ink: filled on, hollow off, dashed when disabled', () => {
    setMode(true);
    const { ink } = themeColors();
    render(
      <>
        <input type='checkbox' className='toggle' data-testid='on' defaultChecked />
        <input type='checkbox' className='toggle' data-testid='off' />
        <input type='checkbox' className='toggle' data-testid='dis-on' defaultChecked disabled />
        <input type='checkbox' className='toggle' data-testid='dis-off' disabled />
        <input
          type='checkbox'
          className='toggle toggle-primary'
          data-testid='primary'
          defaultChecked
        />
      </>,
    );
    const get = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;

    for (const id of ['on', 'off', 'dis-on', 'dis-off', 'primary']) {
      expect(style(get(id)).borderTopColor, id).toBe(ink);
    }
    expect(style(get('on'), '::before').backgroundColor).toBe(ink);
    expect(style(get('primary'), '::before').backgroundColor).toBe(ink);

    expect(style(get('off'), '::before').backgroundColor).toBe(TRANSPARENT);
    expect(style(get('off'), '::before').borderTopColor).toBe(ink);
    expect(style(get('off')).borderTopStyle).toBe('solid');

    for (const id of ['dis-on', 'dis-off']) {
      expect(style(get(id)).opacity, id).toBe('1');
      expect(style(get(id)).borderTopStyle, id).toBe('dashed');
      expect(style(get(id), '::before').backgroundColor, id).toBe(TRANSPARENT);
      expect(style(get(id), '::before').borderTopColor, id).toBe(ink);
    }
    // A disabled switch still shows its value: the knob keeps its side.
    expect(style(get('dis-on')).gridTemplateColumns).not.toBe(
      style(get('dis-off')).gridTemplateColumns,
    );
  });

  it('leaves switches as they were off e-ink', () => {
    setMode(false);
    const { ink } = themeColors();
    render(
      <>
        <input type='checkbox' className='toggle' data-testid='off' />
        <input type='checkbox' className='toggle' data-testid='dis' disabled />
      </>,
    );
    const get = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;

    expect(style(get('off')).borderTopColor).not.toBe(ink);
    expect(style(get('off'), '::before').backgroundColor).not.toBe(TRANSPARENT);
    expect(style(get('dis')).opacity).toBe('0.3');
    expect(style(get('dis')).borderTopStyle).toBe('solid');
  });

  it('draws the bookmark ribbon in ink on a black-and-white panel only', () => {
    setMode(true);
    const { ink } = themeColors();
    render(
      <>
        <div data-testid='bw'>
          <Ribbon isBwEink />
        </div>
        <div data-testid='color'>
          <Ribbon />
        </div>
      </>,
    );
    const polygon = (id: string) => style(document.querySelector(`[data-testid="${id}"] polygon`)!);

    expect(polygon('bw').fill).toBe(ink);
    expect(polygon('color').fill).toBe('rgb(244, 67, 54)');
    expect(polygon('color').stroke).toBe('none');
  });

  // A dark theme's ink is light, and a PDF page left unthemed stays white, so
  // the ink ribbon is outlined in the theme's paper to stay visible on it.
  it('outlines the ink ribbon in paper so it shows on an unthemed page', () => {
    document.documentElement.setAttribute('data-theme', 'default-dark');
    document.documentElement.setAttribute('data-eink', 'true');
    const { paper } = themeColors();
    render(<Ribbon isBwEink />);
    const polygon = style(document.querySelector('polygon')!);

    expect(polygon.stroke).toBe(paper);
    expect(parseFloat(polygon.strokeWidth)).toBeGreaterThanOrEqual(2);
    expect(polygon.vectorEffect).toBe('non-scaling-stroke');
  });
});
