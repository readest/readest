import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';

/**
 * Scope switcher for issue #5306: the Background Image picker edits either the
 * library's or the reader's background. The two scopes are an ARIA radiogroup
 * of two text segments in the section header, so the separation is visible
 * regardless of which page the settings dialog was opened from.
 */

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

import BackgroundTextureSelector from '@/components/settings/theme/BackgroundTextureSelector';

afterEach(() => cleanup());

const baseProps = {
  predefinedTextures: [{ id: 'none' }, { id: 'paper', url: '/textures/paper.png' }],
  customTextures: [],
  scope: 'library' as const,
  selectedTextureId: 'none',
  backgroundOpacity: 0.6,
  backgroundSize: 'cover',
  onScopeChange: vi.fn(),
  onTextureSelect: vi.fn(),
  onOpacityChange: vi.fn(),
  onSizeChange: vi.fn(),
  onImportImage: vi.fn(),
  onDeleteTexture: vi.fn(),
};

describe('BackgroundTextureSelector scope switcher', () => {
  it('renders Library and Reader as a radiogroup of two segments', () => {
    render(<BackgroundTextureSelector {...baseProps} />);

    expect(screen.getByRole('radiogroup', { name: 'Background Image' })).not.toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('marks the selected scope via aria-checked', () => {
    render(<BackgroundTextureSelector {...baseProps} scope='reader' />);

    expect(screen.getByRole('radio', { name: 'Reader' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Library' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('fires onScopeChange with the clicked scope', () => {
    const onScopeChange = vi.fn();
    render(<BackgroundTextureSelector {...baseProps} onScopeChange={onScopeChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Reader' }));
    expect(onScopeChange).toHaveBeenCalledWith('reader');
  });

  it('keeps ThemeModeSelector anatomy: h-9 segments, eink-bordered track, eink-inverted thumb', () => {
    render(<BackgroundTextureSelector {...baseProps} />);

    expect(screen.getByRole('radiogroup', { name: 'Background Image' }).className).toContain(
      'eink-bordered',
    );
    for (const segment of screen.getAllByRole('radio')) {
      expect(segment.className).toContain('h-9');
    }
    expect(screen.getByRole('radio', { name: 'Library' }).className).toContain('eink-inverted');
  });
});
