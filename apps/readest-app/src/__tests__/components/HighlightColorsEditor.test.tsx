import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import HighlightColorsEditor from '@/components/settings/color/HighlightColorsEditor';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import type { DefaultHighlightColor, HighlightColor, UserHighlightColor } from '@/types/book';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// Mocked SketchPicker that tracks mount/unmount via a shared module-level
// registry, so we can detect whether the picker was remounted across a hex
// change. Each mount gets a unique id; a mount is "alive" while its cleanup
// hasn't run.
const mountLog: Array<{ id: number; alive: boolean }> = [];
let nextMountId = 0;

vi.mock('react-color', () => ({
  SketchPicker: ({
    color,
    onChange,
  }: {
    color: string;
    onChange: (c: { hex: string }) => void;
  }) => {
    const [mountId] = useState(() => {
      const id = nextMountId++;
      mountLog.push({ id, alive: true });
      return id;
    });
    React.useEffect(() => {
      return () => {
        const entry = mountLog.find((m) => m.id === mountId);
        if (entry) entry.alive = false;
      };
    }, [mountId]);
    return (
      <div
        data-testid='mock-sketch-picker'
        data-mount-id={mountId}
        data-color={color}
        // Expose a way to trigger onChange as if from a drag.
        onClick={() => onChange({ hex: '#112233' })}
      />
    );
  },
  ColorResult: undefined,
}));

afterEach(() => {
  cleanup();
  mountLog.length = 0;
  nextMountId = 0;
});

const Harness: React.FC<{ initialUserColors: UserHighlightColor[] }> = ({ initialUserColors }) => {
  const [userColors, setUserColors] = useState<UserHighlightColor[]>(initialUserColors);
  const [customColors, setCustomColors] =
    useState<Record<HighlightColor, string>>(HIGHLIGHT_COLOR_HEX);
  const [labels, setLabels] = useState<Partial<Record<DefaultHighlightColor, string>>>({});

  return (
    <HighlightColorsEditor
      customHighlightColors={customColors}
      userHighlightColors={userColors}
      defaultHighlightLabels={labels}
      highlightOpacity={0.3}
      isEink={false}
      onCustomHighlightColorsChange={setCustomColors}
      onUserHighlightColorsChange={setUserColors}
      onDefaultHighlightLabelsChange={setLabels}
      onOpacityChange={() => {}}
    />
  );
};

describe('HighlightColorsEditor — user color SketchPicker stability', () => {
  it('keeps the SketchPicker mounted when the user-color hex updates (so drag is not interrupted)', () => {
    render(<Harness initialUserColors={[{ hex: '#aabbcc' }]} />);

    // ColorInput swatchOnly renders a circular button per color, all with
    // aria-label "Edit color". Default palette is rendered first, then the
    // "add new" swatch in the Custom Colors header (aria-label "Add custom
    // color"), then the existing user colors. Find the last "Edit color"
    // button — that's the user color we care about.
    const editColorButtons = screen.getAllByLabelText('Edit color');
    const userSwatch = editColorButtons[editColorButtons.length - 1]! as HTMLButtonElement;
    expect(userSwatch.style.backgroundColor).toBe('rgb(170, 187, 204)');

    // Open the SketchPicker for this user color.
    fireEvent.click(userSwatch);

    const picker = screen.getByTestId('mock-sketch-picker');
    const initialMountId = picker.getAttribute('data-mount-id');
    expect(initialMountId).not.toBeNull();

    // Simulate an onChange coming from the SketchPicker during drag.
    // (In the real picker this fires continuously as the user drags.)
    fireEvent.click(picker);

    // After the hex update, the picker should STILL be mounted (same id).
    // If the parent row unmounted due to `key={hex}` changing, the original
    // mount would be gone and React would have mounted a fresh one — the
    // drag's window-level mouse listeners would be torn down with it.
    const sameMount = mountLog.find((m) => String(m.id) === initialMountId);
    expect(sameMount, 'SketchPicker mount with initial id should still exist').toBeDefined();
    expect(sameMount!.alive, 'SketchPicker should not be unmounted on hex change').toBe(true);

    // And a picker for the new color should still be visible in the DOM.
    const pickerAfter = screen.queryByTestId('mock-sketch-picker');
    expect(pickerAfter).not.toBeNull();
    expect(pickerAfter!.getAttribute('data-color')).toBe('#112233');
    expect(pickerAfter!.getAttribute('data-mount-id')).toBe(initialMountId);
  });
});
