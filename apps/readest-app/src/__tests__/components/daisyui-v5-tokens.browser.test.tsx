/**
 * Guards the daisyUI 5 migration end to end through the compiled stylesheet:
 * every built-in theme lands as v5 `--color-*` tokens on `[data-theme]`, the
 * v4 field metrics the layouts were tuned on stay pinned, and `.select` opts
 * into `appearance: base-select` so the option popup is painted by the page
 * instead of the OS (#5587: white native popups on Windows dark mode).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { themes, applyCustomTheme } from '@/styles/themes';
import SettingsSelect from '@/components/settings/primitives/SettingsSelect';
import Select from '@/components/Select';

await import('@/styles/globals.css');

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-eink');
});

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('daisyUI 5 theme tokens', () => {
  it('compiles every built-in theme into --color-* tokens', () => {
    for (const theme of themes) {
      for (const scheme of ['light', 'dark'] as const) {
        document.documentElement.setAttribute('data-theme', `${theme.name}-${scheme}`);
        const { container } = render(<div className='bg-base-100 text-primary' />);
        const style = getComputedStyle(container.firstElementChild as HTMLElement);
        expect(style.backgroundColor, `${theme.name}-${scheme} base-100`).toBe(
          rgb(theme.colors[scheme]['base-100']),
        );
        expect(style.color, `${theme.name}-${scheme} primary`).toBe(
          rgb(theme.colors[scheme].primary),
        );
        expect(getComputedStyle(document.documentElement).colorScheme).toBe(scheme);
        cleanup();
      }
    }
  });

  it('applies runtime custom themes through the same tokens', () => {
    applyCustomTheme({
      name: 'custom-test',
      label: 'Custom',
      colors: {
        light: { bg: '#123456', fg: '#ffffff', primary: '#00ff00' },
        dark: { bg: '#654321', fg: '#000000', primary: '#ff00ff' },
      },
    });
    document.documentElement.setAttribute('data-theme', 'custom-test-dark');
    const { container } = render(<div className='bg-base-100 text-primary' />);
    const style = getComputedStyle(container.firstElementChild as HTMLElement);
    expect(style.backgroundColor).toBe('rgb(101, 67, 33)');
    expect(style.color).toBe('rgb(255, 0, 255)');
    expect(getComputedStyle(document.documentElement).colorScheme).toBe('dark');
    document.getElementById('theme-custom-test-styles')?.remove();
  });

  it('keeps the daisyUI 4 field metrics', () => {
    document.documentElement.setAttribute('data-theme', 'default-light');
    const { getByTestId } = render(
      <>
        <button data-testid='btn' className='btn'>
          md
        </button>
        <button data-testid='btn-sm' className='btn btn-sm'>
          sm
        </button>
        <input data-testid='input' className='input' />
        <select data-testid='select' className='select'>
          <option>x</option>
        </select>
        <input data-testid='checkbox' type='checkbox' className='checkbox' />
        <input data-testid='toggle' type='checkbox' className='toggle' defaultChecked />
        <input data-testid='toggle-sm' type='checkbox' className='toggle toggle-sm' />
        <input data-testid='toggle-xs' type='checkbox' className='toggle toggle-xs' />
        <span data-testid='loading-lg' className='loading loading-dots loading-lg' />
      </>,
    );
    const box = (id: string) => getByTestId(id).getBoundingClientRect();
    expect(box('btn').height).toBe(48);
    expect(box('btn-sm').height).toBe(32);
    expect(getComputedStyle(getByTestId('btn-sm')).fontSize).toBe('14px');
    expect(box('input').height).toBe(48);
    expect(box('select').height).toBe(48);
    expect(getComputedStyle(getByTestId('btn')).borderTopLeftRadius).toBe('8px');
    expect(getComputedStyle(getByTestId('checkbox')).borderTopLeftRadius).toBe('8px');
    // daisyUI 5 narrowed the toggle track from 3rem to 2.5rem; the switch reads
    // as base-100 track + base-content knob on both versions.
    const toggle = getByTestId('toggle');
    expect(box('toggle').width).toBe(48);
    expect(box('toggle').height).toBe(24);
    expect(getComputedStyle(toggle).backgroundColor).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(toggle, '::before').backgroundColor).toBe('rgb(23, 23, 23)');
    // Each size has its own v4 width, so the base pin must not flatten them.
    expect([box('toggle-sm').width, box('toggle-sm').height]).toEqual([32, 20]);
    expect([box('toggle-xs').width, box('toggle-xs').height]).toEqual([24, 16]);
    // daisyUI 5 shrank `loading-lg` from 2.5rem to 1.75rem.
    expect(box('loading-lg').width).toBe(40);
  });

  it('keeps the loading animations at full speed', () => {
    // daisyUI 5 ships each `.loading-*` mask twice: a slowed-down base rule that
    // stands in for reduced motion, then an `@media (prefers-reduced-motion:
    // no-preference)` override at full speed.  Tailwind emits the media block
    // *before* the base rule for some of them, so the slow mask wins for everyone
    // and the dots drift up and down instead of bouncing.
    expect(window.matchMedia('(prefers-reduced-motion: no-preference)').matches).toBe(true);
    const { getByTestId } = render(
      <>
        <span data-testid='dots' className='loading loading-dots' />
        <span data-testid='spinner' className='loading loading-spinner' />
        <span data-testid='infinity' className='loading loading-infinity' />
        <span data-testid='plain' className='loading' />
        <span
          data-testid='variant'
          className='loading loading-lg not-eink:loading-dots eink:loading-spinner'
        />
      </>,
    );
    const durations = (id: string) =>
      [...getComputedStyle(getByTestId(id)).maskImage.matchAll(/dur='([^']+)'/g)].map((m) => m[1]);
    expect(durations('dots')).toEqual(['1.05s', '1.05s', '1.05s']);
    expect(durations('infinity')).toEqual(['2s']);
    expect(durations('spinner')).toEqual(['2s', '1.5s', '1.5s']);
    expect(durations('plain')).toEqual(['2s', '1.5s', '1.5s']);
    // `Spinner` reaches the dots through the `not-eink:` variant, which Tailwind
    // emits as a second, separately ordered copy of the same pair.
    expect(durations('variant')).toEqual(['1.05s', '1.05s', '1.05s']);
    // Restoring it must not leak past the variant: e-ink still swaps in the
    // spinner, whose steady sweep survives a slow panel refresh.
    document.documentElement.setAttribute('data-eink', 'true');
    expect(durations('variant')).toEqual(['2s', '1.5s', '1.5s']);
  });

  it('keeps the Tailwind 3 default palette', () => {
    // Tailwind 4 ships an oklch palette that renders noticeably more vivid; the
    // app pins the v3 values (globals.css @theme) so no page changes color.
    const { getByTestId } = render(
      <>
        <div data-testid='green' className='bg-green-500' />
        <div data-testid='gray' className='text-gray-500' />
        <div data-testid='red' className='bg-red-500' />
      </>,
    );
    expect(getComputedStyle(getByTestId('green')).backgroundColor).toBe('rgb(34, 197, 94)');
    expect(getComputedStyle(getByTestId('gray')).color).toBe('rgb(107, 114, 128)');
    expect(getComputedStyle(getByTestId('red')).backgroundColor).toBe('rgb(239, 68, 68)');
  });

  it('renders the select picker in-page (#5587)', () => {
    const { getByTestId, getByLabelText } = render(
      <>
        <select data-testid='select' className='select'>
          <option>x</option>
        </select>
        <SettingsSelect
          value='a'
          onChange={() => {}}
          options={[{ value: 'a', label: 'A' }]}
          ariaLabel='Settings select'
        />
      </>,
    );
    expect(getComputedStyle(getByTestId('select')).appearance).toBe('base-select');
    // The settings primitive strips daisyUI's chevron and chrome; it must not
    // also strip the appearance, or the popup falls back to the OS one.
    expect(getComputedStyle(getByLabelText('Settings select')).appearance).toBe('base-select');
  });

  it('keeps picker options on one line', () => {
    // Because the picker is painted in-page, CSS on <option> is live, and
    // daisyUI 5 ships `:is(.select,.select select) option { white-space: normal }`.
    // A long entry — "Português (Brasil)", "System Language" — then wraps onto
    // several lines inside a narrow select, which is what the translator popup's
    // language and provider pickers are.
    const { getByTestId } = render(
      <select className='select'>
        <option data-testid='option'>Português (Brasil)</option>
      </select>,
    );
    expect(getComputedStyle(getByTestId('option')).whiteSpace).toBe('nowrap');
  });

  it('tracks the selected value, not the widest option, without base-select', () => {
    // Under `appearance: base-select` the selected value already drives the
    // width. An engine without it falls back to native select rendering, where
    // `w-auto` means the width of the widest *option* — and TranslatorPopup
    // hands this the whole language list, so a one-character value measured
    // 240px instead of 49px. `field-sizing: content` keeps the fallback sized to
    // the selection. Asserted through the fallback on purpose: under
    // base-select this passes with or without the fix and would guard nothing.
    const { getByTestId } = render(
      <div data-testid='row' style={{ width: 400 }}>
        <Select
          value='a'
          onChange={() => {}}
          options={[
            { value: 'a', label: 'A' },
            { value: 'long', label: 'Português (Brasil) and a very long unselected label' },
          ]}
        />
      </div>,
    );
    const select = getByTestId('row').querySelector('select')!;
    const withBaseSelect = select.getBoundingClientRect().width;

    select.style.appearance = 'none';
    const withoutBaseSelect = select.getBoundingClientRect().width;

    expect(withoutBaseSelect).toBeLessThanOrEqual(withBaseSelect + 1);
  });

  it('anchors the settings picker to the whole control, chevron included', () => {
    // SettingsSelect suppresses daisyUI's in-select chevron and renders a
    // separate 20px MdArrowDropDown *outside* the <select>. The picker's
    // implicit anchor is the <select>, so it lands short of the control's
    // visible trailing edge. Measured on device: <select> right 913px, wrapper
    // right 968px, picker right 910px -- 20px adrift of the chevron the user
    // reads as the edge of the control. Anchoring to the wrapper lands it at
    // 965px, flush.
    const { getByLabelText } = render(
      <SettingsSelect
        value='a'
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
        ariaLabel='Anchored select'
      />,
    );
    const select = getByLabelText('Anchored select');
    const wrapper = select.parentElement!;
    const css = (el: Element, prop: string, pseudo?: string) =>
      getComputedStyle(el as HTMLElement, pseudo)
        .getPropertyValue(prop)
        .trim();

    expect(css(wrapper, 'anchor-name')).toBe('--settings-select');
    // Scoped, so a page full of these rows resolves each picker to its own
    // wrapper rather than to the last one in tree order.
    expect(css(wrapper, 'anchor-scope')).toBe('--settings-select');
    expect(css(select, 'position-anchor', '::picker(select)')).toBe('--settings-select');
  });

  it('sizes Select to its value so the label ends against the chevron', () => {
    // daisyUI 5 gives `.select` `width: clamp(3rem,20rem,100%)`, so the box
    // stretches to its max width whatever the value is and the label sits at the
    // far start of a wide box. v4 hugged the content, which is what made the
    // component's `text-align-last: end` read as end-aligned. The value itself
    // cannot be aligned under `appearance: base-select`: it is painted into a
    // UA-generated <selectedcontent> in the shadow root, so neither
    // `text-align-last` nor an author rule on `selectedcontent` reaches it.
    const { getByTestId } = render(
      <div
        data-testid='row'
        style={{ width: 400, display: 'flex', justifyContent: 'space-between' }}
      >
        <span>Translated Text</span>
        <Select value='a' onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />
      </div>,
    );
    const row = getByTestId('row').getBoundingClientRect();
    const select = getByTestId('row').querySelector('select')!.getBoundingClientRect();
    // Hugging the value, not filling the row.
    expect(select.width).toBeLessThan(row.width / 2);
    // And still parked at the row's end, where the chevron is.
    expect(Math.round(select.right)).toBe(Math.round(row.right));
  });

  it('lines the picker up with the end of the select', () => {
    // daisyUI already end-aligns the picker (`position-area: self-start
    // span-self-start`) but then insets it: `margin-inline: 8px` plus
    // `translate: -8px` (mirrored as `translate: .5rem` under [dir=rtl]). That
    // is 16px of drift, so the popup visibly fails to line up with the value it
    // belongs to. Zeroing both is what makes it flush; `margin-inline-end` and
    // `translate: none` are both direction-agnostic, so RTL stays correct.
    const { getByTestId } = render(
      <select data-testid='select' className='select'>
        <option>A</option>
      </select>,
    );
    const picker = getComputedStyle(getByTestId('select'), '::picker(select)');
    expect(picker.translate).toBe('none');
    expect(picker.marginInlineEnd).toBe('0px');

    // The RTL mirror must not reintroduce the nudge either.
    document.documentElement.setAttribute('dir', 'rtl');
    const rtl = getComputedStyle(getByTestId('select'), '::picker(select)');
    expect(rtl.translate).toBe('none');
    document.documentElement.removeAttribute('dir');
  });
});
