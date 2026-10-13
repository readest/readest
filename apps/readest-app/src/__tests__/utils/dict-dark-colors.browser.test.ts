import { afterEach, describe, expect, it } from 'vitest';
import { liftDarkTextColors } from '@/utils/style';

/**
 * Dictionaries are authored for a light page; on the dark popup their dark text colors vanish
 * (#6618). The colors come from bundled CSS inside the MDict shadow root, `<font color>`, and
 * inline styles, so the fix has to read computed colors.
 */
describe('liftDarkTextColors', () => {
  let host: HTMLElement;

  const mount = (html: string, css = '') => {
    host = document.createElement('div');
    host.style.color = 'rgb(220, 220, 220)';
    host.style.backgroundColor = 'rgb(30, 30, 30)';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
    const body = document.createElement('div');
    body.innerHTML = html;
    shadow.appendChild(body);
    return body;
  };
  const colorOf = (root: Element, selector: string) =>
    getComputedStyle(root.querySelector(selector)!).color;

  afterEach(() => host.remove());

  it('lifts colors from shadow CSS, <font color> and inline styles', () => {
    const body = mount(
      `<p class="def">def</p><p class="ex">example</p>
       <font id="font" color="darkblue">label</font><span id="inline" style="color: #333">x</span>
       <a id="link" href="#">link</a>`,
      '.def { color: #000; } .ex { color: #757575; }',
    );
    liftDarkTextColors(body);
    expect(colorOf(body, '.def')).toBe('rgb(255, 255, 255)');
    expect(colorOf(body, '.ex')).toBe('rgb(138, 138, 138)');
    expect(colorOf(body, '#font')).toBe('rgb(223, 223, 255)');
    expect(colorOf(body, '#inline')).toBe('rgb(204, 204, 204)');
    // The UA link blue is dark (perceived) though its HSL lightness is near 50%.
    expect(colorOf(body, '#link')).toBe('rgb(201, 201, 255)');
  });

  it('keeps primary text brighter than secondary text', () => {
    const body = mount(
      '<p class="def">def</p><p class="ex">ex</p>',
      '.def { color: #000; } .ex { color: #666; }',
    );
    liftDarkTextColors(body);
    const red = (selector: string) => Number(colorOf(body, selector).match(/\d+/)![0]);
    expect(red('.def')).toBeGreaterThan(red('.ex'));
  });

  it('leaves light text, theme-inherited text and text on a light box alone', () => {
    const body = mount(
      `<p class="light">a</p><p id="plain">b</p><div class="box"><span id="boxed">c</span></div>`,
      '.light { color: #e0e0e0; } .box { background: #f5f5f5; color: #333; }',
    );
    liftDarkTextColors(body);
    expect(colorOf(body, '.light')).toBe('rgb(224, 224, 224)');
    expect(colorOf(body, '#plain')).toBe('rgb(220, 220, 220)');
    expect(colorOf(body, '#boxed')).toBe('rgb(51, 51, 51)');
  });

  it('reads the popup background outside the shadow root', () => {
    const body = mount('<p class="def">def</p>', '.def { color: #000; }');
    host.style.backgroundColor = 'rgb(250, 250, 250)';
    liftDarkTextColors(body);
    expect(colorOf(body, '.def')).toBe('rgb(0, 0, 0)');
  });
});
