// @vitest-environment happy-dom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Escape (and Android Back, which the dialog routes the same way) leaves one
 * settings level at a time. Settings nests its pages inside a single dialog —
 * Font → Manage Fonts, TTS → Voice Library, Integrations → Data Flow — and the
 * dialog used to close outright from any depth, dropping the reader back into
 * the book.
 */

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

import Dialog from '@/components/Dialog';
import SubPageHeader from '@/components/settings/SubPageHeader';
import {
  SettingsSubPageBackScope,
  resetSettingsSubPageBackStack,
  stepBackSettingsSubPage,
} from '@/components/settings/settingsSubPageBack';

/** The wiring SettingsDialog uses: step out of a sub-page, else close. */
const SettingsShell: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({
  onClose,
  children,
}) => (
  <Dialog
    isOpen={true}
    onClose={onClose}
    onBack={() => {
      if (stepBackSettingsSubPage()) return;
      onClose();
    }}
  >
    <SettingsSubPageBackScope>{children}</SettingsSubPageBackScope>
  </Dialog>
);

const pressEscape = () => fireEvent.keyDown(window, { key: 'Escape' });

beforeEach(() => {
  resetSettingsSubPageBackStack();
});

afterEach(() => {
  cleanup();
  resetSettingsSubPageBackStack();
});

describe('Settings back stack', () => {
  it('steps out of a sub-page instead of closing the dialog', () => {
    const onClose = vi.fn();
    const Panel = () => {
      const [sub, setSub] = useState(false);
      return sub ? (
        <SubPageHeader
          parentLabel='Font'
          currentLabel='Custom Fonts'
          onBack={() => setSub(false)}
        />
      ) : (
        <button onClick={() => setSub(true)}>Manage Fonts</button>
      );
    };
    render(
      <SettingsShell onClose={onClose}>
        <Panel />
      </SettingsShell>,
    );

    fireEvent.click(screen.getByText('Manage Fonts'));
    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Custom Fonts')).toBeNull();
    expect(screen.getByText('Manage Fonts')).toBeTruthy();
  });

  it('closes the dialog once the panel itself is showing', () => {
    const onClose = vi.fn();
    render(
      <SettingsShell onClose={onClose}>
        <p>Font panel</p>
      </SettingsShell>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('steps back one level at a time through nested pages', () => {
    const onClose = vi.fn();
    const Panel = () => {
      const [depth, setDepth] = useState(0);
      if (depth === 0) return <button onClick={() => setDepth(1)}>Voice Library</button>;
      if (depth === 1)
        return (
          <div>
            <SubPageHeader
              parentLabel='TTS'
              currentLabel='Voice Library'
              onBack={() => setDepth(0)}
            />
            <button onClick={() => setDepth(2)}>Open service editor</button>
          </div>
        );
      return (
        <SubPageHeader
          parentLabel='Voice Library'
          currentLabel='Custom service'
          onBack={() => setDepth(1)}
        />
      );
    };
    render(
      <SettingsShell onClose={onClose}>
        <Panel />
      </SettingsShell>,
    );

    fireEvent.click(screen.getByText('Voice Library'));
    fireEvent.click(screen.getByText('Open service editor'));

    pressEscape();
    expect(screen.queryByText('Custom service')).toBeNull();
    expect(screen.getByText('Voice Library')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    expect(screen.getByText('Voice Library')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves headers outside Settings out of the stack', () => {
    // Reading stats and the catalog manager render the same header inside a
    // dialog that already carries its own onBack; Escape there must close that
    // dialog, not reach into a Settings level left behind.
    const onClose = vi.fn();
    render(
      <Dialog isOpen={true} onClose={onClose}>
        <SubPageHeader parentLabel='Stats' currentLabel='Monthly' onBack={vi.fn()} />
      </Dialog>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
