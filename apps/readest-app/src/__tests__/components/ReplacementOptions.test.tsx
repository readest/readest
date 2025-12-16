import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ReplacementOptions from '@/app/reader/components/annotator/ReplacementOptions';

describe('ReplacementOptions Component', () => {
  // IMPORTANT: ReplacementOptions should ONLY be rendered for EPUB books.
  // for non-EPUB formats (PDF, TXT, etc), the button is disabled
  // and ReplacementOptions is never rendered/shown to the user.
  //

  const mockOnConfirm = vi.fn();
  const mockOnClose = vi.fn();

  const defaultProps = {
    isVertical: false,
    style: { left: '100px', top: '100px' },
    selectedText: 'test word',
    onConfirm: mockOnConfirm,
    onClose: mockOnClose,
  };

  // Note: ReplacementOptions component should only be rendered for EPUB books.
  // All tests here implicitly test EPUB book scenarios.

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
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      expect(screen.getByText('Case Sensitive')).toBeTruthy();
      expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
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
  });

  describe('Case Sensitive Checkbox', () => {
    it('should be checked by default (case-sensitive)', () => {
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('should toggle when clicked', async () => {
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
    });

    it('should pass case sensitivity value to onConfirm when checked', async () => {
      render(<ReplacementOptions {...defaultProps} />);

      // Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      // Checkbox is checked by default (case sensitive = true)

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
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      // Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      // Uncheck the checkbox (default is true, so we click to toggle to false)
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(checkbox);

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
        }),
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
      const confirmButtons = screen.getAllByText('Confirm');
      if (!confirmButtons[0]) {
        throw new Error('Confirm button not found');
      }
      fireEvent.click(confirmButtons[0]);

      expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({ scope: 'once' }));
    });

    it('should call onConfirm with correct scope for "book"', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix in this book'));
      const confirmButtons = screen.getAllByText('Confirm');
      if (!confirmButtons[0]) {
        throw new Error('Confirm button not found');
      }
      fireEvent.click(confirmButtons[0]);

      expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({ scope: 'book' }));
    });

    it('should call onConfirm with correct scope for "library"', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      fireEvent.click(screen.getByText('Fix in library'));
      const confirmButtons = screen.getAllByText('Confirm');
      if (!confirmButtons[0]) {
        throw new Error('Confirm button not found');
      }
      fireEvent.click(confirmButtons[0]);

      expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({ scope: 'library' }));
    });
  });

  describe('Confirmation Dialog', () => {
    it('should display original text in confirmation', () => {
      render(<ReplacementOptions {...defaultProps} selectedText='original' />);

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
          <div data-testid='outside'>Outside element</div>
          <ReplacementOptions {...defaultProps} />
        </div>,
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
});
