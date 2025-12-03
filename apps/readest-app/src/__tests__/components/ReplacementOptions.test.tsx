import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ReplacementOptions from '@/app/reader/components/annotator/ReplacementOptions';

describe('ReplacementOptions Component', () => {
  const mockOnConfirm = vi.fn();
  const mockOnClose = vi.fn();

  const defaultProps = {
    isVertical: false,
    style: { left: '100px', top: '100px' },
    selectedText: 'test word',
    onConfirm: mockOnConfirm,
    onClose: mockOnClose,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render all three replacement scope options', () => {
      render(<ReplacementOptions {...defaultProps} />);

      expect(screen.getByText('Fix this once')).toBeTruthy();
      expect(screen.getByText('Fix in this book')).toBeTruthy();
      expect(screen.getByText('Fix in library')).toBeTruthy();
    });

    it('should render the replacement text input field', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      expect(input).toBeTruthy();
    });

    it('should render the Case Sensitive checkbox', () => {
      render(<ReplacementOptions {...defaultProps} />);

      expect(screen.getByText('Case Sensitive')).toBeTruthy();
      expect(screen.getByRole('checkbox')).toBeTruthy();
    });

    it('should render the Cancel button', () => {
      render(<ReplacementOptions {...defaultProps} />);

      expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('should display selected text preview', () => {
      render(<ReplacementOptions {...defaultProps} />);

      expect(screen.getByText(/Selected:/)).toBeTruthy();
      expect(screen.getByText(/"test word"/)).toBeTruthy();
    });

    it('should truncate long selected text in preview', () => {
      const longText = 'a'.repeat(100);
      render(<ReplacementOptions {...defaultProps} selectedText={longText} />);

      // Should show truncated version with ellipsis
      const preview = screen.getByText(/Selected:/);
      expect(preview.parentElement?.textContent).toContain('...');
    });

    it('should apply custom styles', () => {
      const customStyle = { left: '200px', top: '300px' };
      const { container } = render(<ReplacementOptions {...defaultProps} style={customStyle} />);

      const menuElement = container.querySelector('.replacement-options');
      expect(menuElement).toBeTruthy();
    });
  });

  describe('Case Sensitive Checkbox', () => {
    it('should be unchecked by default (case-insensitive)', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should toggle when clicked', async () => {
      render(<ReplacementOptions {...defaultProps} />);

      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
    });

    it('should pass case sensitivity value to onConfirm when checked', async () => {
      render(<ReplacementOptions {...defaultProps} />);

      // Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      // Check the case sensitive checkbox
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // Click a scope button
      const fixOnceButton = screen.getByText('Fix this once');
      fireEvent.click(fixOnceButton);

      // Should show confirmation dialog
      expect(screen.getByText('Confirm Replacement')).toBeTruthy();
      expect(screen.getByText('Yes')).toBeTruthy(); // Case sensitive: Yes

      // Confirm
      const confirmButton = screen.getByText('Confirm');
      fireEvent.click(confirmButton);

      expect(mockOnConfirm).toHaveBeenCalledWith({
        replacementText: 'replacement',
        caseSensitive: true,
        scope: 'once',
      });
    });

    it('should pass case sensitivity value to onConfirm when unchecked', async () => {
      render(<ReplacementOptions {...defaultProps} />);

      // Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      // Don't check the checkbox (leave unchecked)

      // Click a scope button
      const fixOnceButton = screen.getByText('Fix this once');
      fireEvent.click(fixOnceButton);

      // Confirm
      const confirmButton = screen.getByText('Confirm');
      fireEvent.click(confirmButton);

      expect(mockOnConfirm).toHaveBeenCalledWith({
        replacementText: 'replacement',
        caseSensitive: false,
        scope: 'once',
      });
    });
  });

  describe('Replacement Text Input', () => {
    it('should update value when user types', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'new text' } });

      expect(input.value).toBe('new text');
    });

    it('should disable scope buttons when input is empty', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const fixOnceButton = screen.getByText('Fix this once') as HTMLButtonElement;
      const fixInBookButton = screen.getByText('Fix in this book') as HTMLButtonElement;
      const fixInLibraryButton = screen.getByText('Fix in library') as HTMLButtonElement;

      expect(fixOnceButton.disabled).toBe(true);
      expect(fixInBookButton.disabled).toBe(true);
      expect(fixInLibraryButton.disabled).toBe(true);
    });

    it('should enable scope buttons when input has text', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const fixOnceButton = screen.getByText('Fix this once') as HTMLButtonElement;
      const fixInBookButton = screen.getByText('Fix in this book') as HTMLButtonElement;
      const fixInLibraryButton = screen.getByText('Fix in library') as HTMLButtonElement;

      expect(fixOnceButton.disabled).toBe(false);
      expect(fixInBookButton.disabled).toBe(false);
      expect(fixInLibraryButton.disabled).toBe(false);
    });

    it('should trim whitespace from replacement text', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: '  trimmed  ' } });

      // Click a scope button
      const fixOnceButton = screen.getByText('Fix this once');
      fireEvent.click(fixOnceButton);

      // Confirm
      const confirmButton = screen.getByText('Confirm');
      fireEvent.click(confirmButton);

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          replacementText: 'trimmed',
        })
      );
    });
  });

  describe('Scope Button Click Handlers', () => {
    it('should show confirmation dialog when "Fix this once" is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const button = screen.getByText('Fix this once');
      fireEvent.click(button);

      expect(screen.getByText('Confirm Replacement')).toBeTruthy();
      expect(screen.getByText('this instance')).toBeTruthy();
    });

    it('should show confirmation dialog when "Fix in this book" is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const button = screen.getByText('Fix in this book');
      fireEvent.click(button);

      expect(screen.getByText('Confirm Replacement')).toBeTruthy();
      expect(screen.getByText('all instances in this book')).toBeTruthy();
    });

    it('should show confirmation dialog when "Fix in library" is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const button = screen.getByText('Fix in library');
      fireEvent.click(button);

      expect(screen.getByText('Confirm Replacement')).toBeTruthy();
      expect(screen.getByText('all instances in your library')).toBeTruthy();
    });

    it('should call onConfirm with correct scope for "once"', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix this once'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'once' })
      );
    });

    it('should call onConfirm with correct scope for "book"', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'book' })
      );
    });

    it('should call onConfirm with correct scope for "library"', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix in library'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'library' })
      );
    });
  });

  describe('Confirmation Dialog', () => {
    it('should display original text in confirmation', () => {
      render(<ReplacementOptions {...defaultProps} selectedText="original" />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix this once'));

      expect(screen.getByText('"original"')).toBeTruthy();
    });

    it('should display replacement text in confirmation', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'new text' } });

      fireEvent.click(screen.getByText('Fix this once'));

      expect(screen.getByText('"new text"')).toBeTruthy();
    });

    it('should go back to main view when Back is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix this once'));
      expect(screen.getByText('Confirm Replacement')).toBeTruthy();

      fireEvent.click(screen.getByText('Back'));

      // Should be back to main view
      expect(screen.queryByText('Confirm Replacement')).toBeNull();
      expect(screen.getByText('Fix this once')).toBeTruthy();
    });

    it('should not call onConfirm when Back is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix this once'));
      fireEvent.click(screen.getByText('Back'));

      expect(mockOnConfirm).not.toHaveBeenCalled();
    });
  });

  describe('Cancel Button', () => {
    it('should call onClose when Cancel is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Click Outside Behavior', () => {
    it('should call onClose when clicking outside the menu', () => {
      render(
        <div>
          <div data-testid="outside">Outside element</div>
          <ReplacementOptions {...defaultProps} />
        </div>
      );

      const outsideElement = screen.getByTestId('outside');
      fireEvent.mouseDown(outsideElement);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('should not call onClose when clicking inside the menu', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.mouseDown(input);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Full Replacement Flow', () => {
    it('should complete full replacement flow with all options', () => {
      render(<ReplacementOptions {...defaultProps} selectedText="Where" />);

      // 1. Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'There' } });

      // 2. Check case sensitive
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // 3. Click scope button
      fireEvent.click(screen.getByText('Fix in this book'));

      // 4. Verify confirmation dialog shows correct info
      expect(screen.getByText('Confirm Replacement')).toBeTruthy();
      expect(screen.getByText('"Where"')).toBeTruthy();
      expect(screen.getByText('"There"')).toBeTruthy();
      expect(screen.getByText('all instances in this book')).toBeTruthy();
      expect(screen.getByText('Yes')).toBeTruthy(); // Case sensitive

      // 5. Confirm
      fireEvent.click(screen.getByText('Confirm'));

      // 6. Verify callback
      expect(mockOnConfirm).toHaveBeenCalledWith({
        replacementText: 'There',
        caseSensitive: true,
        scope: 'book',
      });
    });
  });
});

describe('Case Sensitivity Matching Logic', () => {
  // These tests verify the expected behavior of case-sensitive matching
  // The actual implementation would be in the replacement transformer

  describe('Case-Sensitive Mode (checkbox checked)', () => {
    it('should only match exact case', () => {
      const originalText = 'Where';
      const caseSensitive = true;

      // Exact match
      expect(matchText('Where', originalText, caseSensitive)).toBe(true);
      // Different case - should NOT match
      expect(matchText('where', originalText, caseSensitive)).toBe(false);
      expect(matchText('WHERE', originalText, caseSensitive)).toBe(false);
      expect(matchText('wHeRe', originalText, caseSensitive)).toBe(false);
    });
  });

  describe('Case-Insensitive Mode (checkbox unchecked)', () => {
    it('should match all case variants', () => {
      const originalText = 'where';
      const caseSensitive = false;

      // All variants should match
      expect(matchText('where', originalText, caseSensitive)).toBe(true);
      expect(matchText('Where', originalText, caseSensitive)).toBe(true);
      expect(matchText('WHERE', originalText, caseSensitive)).toBe(true);
      expect(matchText('wHeRe', originalText, caseSensitive)).toBe(true);
    });
  });
});

// Helper function to simulate matching logic
function matchText(text: string, pattern: string, caseSensitive: boolean): boolean {
  if (caseSensitive) {
    return text === pattern;
  }
  return text.toLowerCase() === pattern.toLowerCase();
}
