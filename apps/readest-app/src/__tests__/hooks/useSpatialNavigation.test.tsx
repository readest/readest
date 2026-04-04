import { cleanup, render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import {
  useSpatialNavigation,
  _resetLastKeyboardTime,
} from '@/app/reader/hooks/useSpatialNavigation';

function TestToolbar({ isVisible }: { isVisible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useSpatialNavigation(ref, isVisible);

  return (
    <div ref={ref} data-testid='toolbar'>
      <button data-testid='btn-1'>Button 1</button>
      <button data-testid='btn-2'>Button 2</button>
      <button data-testid='btn-3'>Button 3</button>
      <button disabled data-testid='btn-disabled'>
        Disabled
      </button>
    </div>
  );
}

function TestHeaderFooter({ isVisible }: { isVisible: boolean }) {
  const headerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useSpatialNavigation(headerRef, isVisible);
  useSpatialNavigation(footerRef, isVisible);

  return (
    <>
      <div ref={headerRef} className='header-bar' data-testid='header'>
        <button data-testid='header-btn-1'>H1</button>
        <button data-testid='header-btn-2'>H2</button>
      </div>
      <div ref={footerRef} className='footer-bar' data-testid='footer'>
        <button data-testid='footer-btn-1'>F1</button>
        <button data-testid='footer-btn-2'>F2</button>
      </div>
    </>
  );
}

function pressKey(element: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  const spy = vi.spyOn(event, 'stopPropagation');
  element.dispatchEvent(event);
  return { event, stopPropagationCalled: spy.mock.calls.length > 0 };
}

function simulateKeyboardActivation() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

async function waitForAutoFocus() {
  await act(() => new Promise((r) => setTimeout(r, 150)));
}

describe('useToolbarKeyNavigation', () => {
  beforeEach(() => {
    _resetLastKeyboardTime();
  });
  afterEach(() => cleanup());

  describe('auto-focus', () => {
    it('focuses first enabled button when keyboard-activated', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();
      expect(document.activeElement).toBe(document.querySelector('[data-testid="btn-1"]'));
    });

    it('does not auto-focus when not visible', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={false} />);
      await waitForAutoFocus();
      expect(document.activeElement).not.toBe(document.querySelector('[data-testid="btn-1"]'));
    });

    it('does not auto-focus when mouse-activated (no recent keyboard)', async () => {
      // No simulateKeyboardActivation() — simulates mouse hover activation
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();
      expect(document.activeElement).not.toBe(document.querySelector('[data-testid="btn-1"]'));
    });
  });

  describe('left/right navigation', () => {
    it('ArrowRight moves focus to the next button', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();

      const btn1 = document.querySelector<HTMLElement>('[data-testid="btn-1"]')!;
      const btn2 = document.querySelector<HTMLElement>('[data-testid="btn-2"]')!;
      expect(document.activeElement).toBe(btn1);

      pressKey(btn1, 'ArrowRight');
      expect(document.activeElement).toBe(btn2);
    });

    it('ArrowLeft moves focus to the previous button', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();

      const btn1 = document.querySelector<HTMLElement>('[data-testid="btn-1"]')!;
      const btn2 = document.querySelector<HTMLElement>('[data-testid="btn-2"]')!;

      btn2.focus();
      pressKey(btn2, 'ArrowLeft');
      expect(document.activeElement).toBe(btn1);
    });

    it('ArrowRight does not go past the last enabled button', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();

      const btn3 = document.querySelector<HTMLElement>('[data-testid="btn-3"]')!;
      btn3.focus();
      pressKey(btn3, 'ArrowRight');
      expect(document.activeElement).toBe(btn3);
    });

    it('ArrowLeft does not go before the first button', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();

      const btn1 = document.querySelector<HTMLElement>('[data-testid="btn-1"]')!;
      pressKey(btn1, 'ArrowLeft');
      expect(document.activeElement).toBe(btn1);
    });

    it('ArrowRight calls stopPropagation', async () => {
      simulateKeyboardActivation();
      render(<TestToolbar isVisible={true} />);
      await waitForAutoFocus();

      const btn1 = document.querySelector<HTMLElement>('[data-testid="btn-1"]')!;
      const { stopPropagationCalled } = pressKey(btn1, 'ArrowRight');
      expect(stopPropagationCalled).toBe(true);
    });
  });

  describe('up/down navigation between header and footer', () => {
    it('ArrowDown from header focuses first footer button', async () => {
      render(<TestHeaderFooter isVisible={true} />);
      await waitForAutoFocus();

      const headerBtn = document.querySelector<HTMLElement>('[data-testid="header-btn-1"]')!;
      const footerBtn1 = document.querySelector<HTMLElement>('[data-testid="footer-btn-1"]')!;

      headerBtn.focus();
      pressKey(headerBtn, 'ArrowDown');
      expect(document.activeElement).toBe(footerBtn1);
    });

    it('ArrowUp from footer focuses first header button', async () => {
      render(<TestHeaderFooter isVisible={true} />);
      await waitForAutoFocus();

      const headerBtn1 = document.querySelector<HTMLElement>('[data-testid="header-btn-1"]')!;
      const footerBtn = document.querySelector<HTMLElement>('[data-testid="footer-btn-1"]')!;

      footerBtn.focus();
      pressKey(footerBtn, 'ArrowUp');
      expect(document.activeElement).toBe(headerBtn1);
    });

    it('ArrowDown from header calls stopPropagation', async () => {
      render(<TestHeaderFooter isVisible={true} />);
      await waitForAutoFocus();

      const headerBtn = document.querySelector<HTMLElement>('[data-testid="header-btn-1"]')!;
      headerBtn.focus();

      const { stopPropagationCalled } = pressKey(headerBtn, 'ArrowDown');
      expect(stopPropagationCalled).toBe(true);
    });
  });
});
