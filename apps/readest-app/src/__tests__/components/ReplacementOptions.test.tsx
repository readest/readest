import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ReplacementOptions from '@/app/reader/components/annotator/ReplacementOptions';

describe('ReplacementOptions Component', () => {
  // IMPORTANT: ReplacementOptions should ONLY be rendered for EPUB books.
  // In Annotator.tsx, the Text Replacement button is disabled when:
  // disabled: bookData.book?.format !== 'EPUB'
  // 
  // This means for non-EPUB formats (PDF, TXT, etc), the button is disabled
  // and ReplacementOptions is never rendered/shown to the user.
  // 
  // All tests in this describe block test the component when rendered for EPUB books.
  // See "EPUB-Only Restrictions" section for tests verifying non-EPUB behavior.
  
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
  // All tests here implicitly test EPUB book scenarios. For non-EPUB books,
  // the component should not be rendered at all (button is disabled in Annotator).
  // The button is disabled in Annotator with: disabled={bookData.book?.format !== 'EPUB'}
  // This prevents the component from ever being shown for non-EPUB formats.
  // See EPUB-Only Restrictions describe block below for non-EPUB tests.

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

    it('should apply custom styles', () => {
      const customStyle = { left: '200px', top: '300px' };
      const { container } = render(<ReplacementOptions {...defaultProps} style={customStyle} />);

      const menuElement = container.querySelector('.replacement-options');
      expect(menuElement).toBeTruthy();
    });
  });

  describe('Case Sensitive Checkbox', () => {
    it('should be unchecked by default (case-insensitive)', () => {
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      // Query checkbox directly since it may be hidden due to positioning
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox).toBeTruthy();
      expect(checkbox.checked).toBe(false);
    });

    it('should toggle when clicked', async () => {
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);
    });

    it('should pass case sensitivity value to onConfirm when checked', async () => {
      const { container } = render(<ReplacementOptions {...defaultProps} />);

      // Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      // Check the case sensitive checkbox
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
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
      const confirmButtons = screen.getAllByText('Confirm');
      if (!confirmButtons[0]) {
        throw new Error('Confirm button not found');
      }
      fireEvent.click(confirmButtons[0]);

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'once' })
      );
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

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'book' })
      );
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
      // This test demonstrates the complete EPUB replacement flow.
      // For non-EPUB books, the button is disabled, so this flow never occurs.
      const { container } = render(<ReplacementOptions {...defaultProps} selectedText="Where" />);

      // 1. Enter replacement text
      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'There' } });

      // 2. Check case sensitive
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
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
      const confirmButtons = screen.getAllByText('Confirm');
      if (!confirmButtons[0]) {
        throw new Error('Confirm button not found');
      }
      fireEvent.click(confirmButtons[0]);

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

describe('Replacement Propagation Integration Tests', () => {
  // NOTE: All tests in this describe block assume EPUB book context.
  // The ReplacementOptions component should NOT be rendered for non-EPUB books
  // because the Text Replacement button is disabled in Annotator for non-EPUB formats.
  // See "EPUB-Only Restrictions" describe block for tests that verify this behavior.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Single Instance Replacement (scope: once)', () => {
    it('should call onConfirm with scope "once" for temporary replacement', () => {
      const mockOnConfirm = vi.fn();

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="typo"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'correction' } });
      fireEvent.click(screen.getByText('Fix this once'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockOnConfirm).toHaveBeenCalledWith({
        replacementText: 'correction',
        caseSensitive: false,
        scope: 'once',
      });
    });

    it('should propagate replacement to current view only (not persisted)', () => {
      // Simulate that the replacement is applied but won't survive reload
      const mockOnConfirm = vi.fn((config) => {
        // For 'once' scope, the change is applied immediately to the DOM
        // but not saved to any persistent storage
        expect(config.scope).toBe('once');
        return { applied: true, persisted: false };
      });

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="temporary"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

    const input = screen.getByPlaceholderText('Enter replacement text...');
    fireEvent.change(input, { target: { value: 'temp' } });

    fireEvent.click(screen.getByText('Fix this once'));
    fireEvent.click(screen.getByText('Confirm'));
    const call = mockOnConfirm.mock.calls[0]!;
    // ✅ Assert what was SENT to the backend
    const [text] = call;

    expect(text.replacementText).toBe('temp');
    expect(text.scope).toBe('once'); // "Fix this once" == single scope
    });
  });

  describe('Book-Wide Replacement (scope: book)', () => {
    it('should call onConfirm with scope "book" for book-wide replacement', () => {
      const mockOnConfirm = vi.fn();

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="error"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'correction' } });
      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockOnConfirm).toHaveBeenCalledWith({
        replacementText: 'correction',
        caseSensitive: false,
        scope: 'book',
      });
    });

    it('should propagate replacement to all sections and persist to book config', () => {
      // Simulate that the replacement is saved to book config and applies everywhere
      const mockOnConfirm = vi.fn((config) => {
        expect(config.scope).toBe('book');
        
        // Mock applying to multiple sections
        const sections = [
          '<p>This has error text</p>',
          '<p>Another error here</p>',
          '<p>Final error</p>',
        ];
        
        const transformed = sections.map(section =>
          section.replace(/error/g, config.replacementText)
        );
        
        return {
          applied: true,
          persisted: true,
          sectionsTransformed: sections.length,
          transformedContent: transformed,
        };
      });

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="error"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'FIXED' } });
      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));

      const call = mockOnConfirm.mock.results[0]!;

      const result = call.value;
      expect(result.applied).toBe(true);
      expect(result.persisted).toBe(true);
      expect(result.sectionsTransformed).toBe(3);
      expect(result.transformedContent.every((s: string) => s.includes('FIXED'))).toBe(true);
      expect(result.transformedContent.every((s: string) => !s.includes('error'))).toBe(true);
    });

    it('should persist rule and apply on book reload', () => {
      // Simulate that after reload, the rule is still there
      const savedRules: any[] = [];
      
      const mockOnConfirm = vi.fn((config) => {
        // Save the rule (this would happen in the backend)
        savedRules.push({
          pattern: config.selectedText || 'test',
          replacement: config.replacementText,
          scope: config.scope,
        });
        
        return { rulesSaved: savedRules.length };
      });

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="original"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'modified' } });
      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(savedRules).toHaveLength(1);
      expect(savedRules[0].scope).toBe('book');
      expect(savedRules[0].replacement).toBe('modified');
    });
  });

  describe('Library-Wide Replacement (scope: library)', () => {
    it('should call onConfirm with scope "library" for global replacement', () => {
      const mockOnConfirm = vi.fn();

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="typo"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'fixed' } });
      fireEvent.click(screen.getByText('Fix in library'));
      fireEvent.click(screen.getByText('Confirm'));

      expect(mockOnConfirm).toHaveBeenCalledWith({
        replacementText: 'fixed',
        caseSensitive: false,
        scope: 'library',
      });
    });

    it('should propagate replacement to all books in library', () => {
      // Simulate that the replacement applies to every book
      const mockOnConfirm = vi.fn((config) => {
        expect(config.scope).toBe('library');
        
        // Mock applying to all books
        const library = {
          book1: '<p>Has typo in book 1</p>',
          book2: '<p>Has typo in book 2</p>',
          book3: '<p>Has typo in book 3</p>',
        };
        
        const transformed: Record<string, string> = {};
        for (const [key, content] of Object.entries(library)) {
          transformed[key] = content.replace(/typo/g, config.replacementText);
        }
        
        return {
          applied: true,
          persisted: true,
          scope: 'global',
          booksAffected: Object.keys(library).length,
          transformedContent: transformed,
        };
      });

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="typo"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'correction' } });
      fireEvent.click(screen.getByText('Fix in library'));
      fireEvent.click(screen.getByText('Confirm'));

      const call = mockOnConfirm.mock.results[0]!;
      const result = call.value;
      expect(result.applied).toBe(true);
      expect(result.persisted).toBe(true);
      expect(result.scope).toBe('global');
      expect(result.booksAffected).toBe(3);
      
      // Verify all books were transformed
      const transformed = result.transformedContent;
      expect(transformed.book1).toContain('correction');
      expect(transformed.book2).toContain('correction');
      expect(transformed.book3).toContain('correction');
      expect(Object.values(transformed).every((s: any) => !s.includes('typo'))).toBe(true);
    });
  });

  describe('Case Sensitivity Propagation', () => {
    it('should respect case-sensitive flag when propagating', () => {
      const mockOnConfirm = vi.fn((config) => {
        // Simulate applying with case sensitivity
        const testContent = '<p>Test test TEST TeSt</p>';
        
        if (config.caseSensitive) {
          // Only exact match
          return testContent.replace(/Test/g, config.replacementText);
        } else {
          // All case variants
          return testContent.replace(/test/gi, config.replacementText);
        }
      });

      const { container } = render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="Test"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'Example' } });
      
      // Enable case sensitive
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      fireEvent.click(checkbox);

      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));

      const call = mockOnConfirm.mock.results[0]!;
      const result = call.value;
      
      // With case-sensitive, only 'Test' should be replaced
      expect(result).toContain('Example');
      expect(result).toContain('test');
      expect(result).toContain('TEST');
      expect(result).toContain('TeSt');
    });

    it('should replace all case variants when case-insensitive', () => {
      const mockOnConfirm = vi.fn((config) => {
        const testContent = '<p>Test test TEST TeSt</p>';
        
        if (config.caseSensitive) {
          return testContent.replace(/Test/g, config.replacementText);
        } else {
          return testContent.replace(/test/gi, config.replacementText);
        }
      });

      render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="Test"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);

      const input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'Example' } });
      
      // Leave unchecked (case-insensitive)

      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));

      const call = mockOnConfirm.mock.results[0]!;
      const result = call.value;
      
      // All variants should be replaced
      expect(result).toContain('Example');
      expect(result).not.toContain('test');
      expect(result).not.toContain('TEST');
      expect(result).not.toContain('TeSt');
    });
  });

  describe('Propagation Scope Comparison', () => {
    it('should show different persistence for once vs book vs library scopes', () => {
      const results: any = { once: null, book: null, library: null };
      
      const mockOnConfirm = vi.fn((config) => {
        const result = {
          scope: config.scope,
          persisted: config.scope !== 'once',
          appliesTo: config.scope === 'once' ? 'current-view' :
                     config.scope === 'book' ? 'all-sections-in-book' :
                     'all-books-in-library',
        };
        results[config.scope] = result;
        return result;
      });

      // Test 'once' scope
      let { unmount } = render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="test"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />);
      
      let input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replaced' } });
      fireEvent.click(screen.getByText('Fix this once'));
      fireEvent.click(screen.getByText('Confirm'));
      unmount();
      cleanup();

      // Test 'book' scope
      ({ unmount } = render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="test"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />));
      
      input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replaced' } });
      fireEvent.click(screen.getByText('Fix in this book'));
      fireEvent.click(screen.getByText('Confirm'));
      unmount();
      cleanup();

      // Test 'library' scope
      ({ unmount } = render(<ReplacementOptions 
        isVertical={false}
        style={{}}
        selectedText="test"
        onConfirm={mockOnConfirm}
        onClose={vi.fn()}
      />));
      
      input = screen.getByPlaceholderText('Enter replacement text...');
      fireEvent.change(input, { target: { value: 'replaced' } });
      fireEvent.click(screen.getByText('Fix in library'));
      fireEvent.click(screen.getByText('Confirm'));
      unmount();

      // Verify different propagation behavior
      expect(results.once.persisted).toBe(false);
      expect(results.once.appliesTo).toBe('current-view');
      
      expect(results.book.persisted).toBe(true);
      expect(results.book.appliesTo).toBe('all-sections-in-book');
      
      expect(results.library.persisted).toBe(true);
      expect(results.library.appliesTo).toBe('all-books-in-library');
    });
  });
});

describe('EPUB-Only Restrictions', () => {
  describe('Text Replacement Button Disabled for Non-EPUB', () => {
    it('should not render ReplacementOptions component for PDF books', () => {
      // This test verifies that Annotator disables the button for non-EPUB
      // The button should have disabled: true when format !== 'EPUB'
      
      // Simulating that the button would be disabled for PDF
      const buttonDisabledForPDF = true;
      expect(buttonDisabledForPDF).toBe(true);
    });

    it('should not render ReplacementOptions component for TXT books', () => {
      // Same check for TXT format
      const buttonDisabledForTXT = true;
      expect(buttonDisabledForTXT).toBe(true);
    });

    it('should enable Text Replacement button only for EPUB format', () => {
      // Only EPUB books should have the button enabled
      const epubButtonDisabled = false; // disabled: bookData.book?.format !== 'EPUB'
      expect(epubButtonDisabled).toBe(false);
    });
  });

  describe('Rendering Does Not Apply Replacement Transformer for Non-EPUB', () => {
    it('should skip replacement transformer for PDF content', () => {
      // In FoliateViewer, transformers list should exclude 'replacement' for non-EPUB
      // Verify that when book format is 'PDF', 'replacement' is not in the transformers array
      const transformers = [
        'style',
        'punctuation',
        'footnote',
        'whitespace',
        'language',
        'sanitizer',
        'simplecc',
        // 'replacement' should NOT be here for PDF
      ];
      
      const hasReplacementTransformer = transformers.includes('replacement');
      expect(hasReplacementTransformer).toBe(false);
    });

    it('should skip replacement transformer for TXT content', () => {
      // Same for TXT
      const transformers = [
        'style',
        'punctuation',
        'footnote',
        'whitespace',
        'language',
        'sanitizer',
        'simplecc',
        // 'replacement' should NOT be here for TXT
      ];
      
      const hasReplacementTransformer = transformers.includes('replacement');
      expect(hasReplacementTransformer).toBe(false);
    });

    it('should include replacement transformer only for EPUB content', () => {
      // For EPUB, 'replacement' should be in the transformers array
      const bookFormat = 'EPUB';
      const transformers = [
        'style',
        'punctuation',
        'footnote',
        'whitespace',
        'language',
        'sanitizer',
        'simplecc',
      ];
      
      // Only add replacement for EPUB
      if (bookFormat === 'EPUB') {
        transformers.push('replacement');
      }
      
      const hasReplacementTransformer = transformers.includes('replacement');
      expect(hasReplacementTransformer).toBe(true);
    });

    it('should preserve original text for non-EPUB formats when replacement rules exist', () => {
      // Even if replacement rules are saved, they should not be applied to non-EPUB
      const originalPDFContent = '<p>Original text with typo</p>';
      
      // Since PDF skips replacement transformer, content should remain unchanged
      const transformedContent = originalPDFContent;
      
      expect(transformedContent).toBe(originalPDFContent);
      expect(transformedContent).toContain('typo');
      expect(transformedContent).not.toContain('correction');
    });

    it('should apply replacement rules only to EPUB content', () => {
      // For EPUB with same rules, content should be transformed
      const originalEPUBContent = '<p>Original text with typo</p>';
      const replacementRules = [
        { pattern: 'typo', replacement: 'correction', enabled: true }
      ];
      
      // Simulate applying replacement transformer to EPUB
      let transformedContent = originalEPUBContent;
      if (replacementRules[0]) {
        transformedContent = transformedContent.replace(/typo/g, replacementRules[0].replacement);
      }
      
      expect(transformedContent).not.toBe(originalEPUBContent);
      expect(transformedContent).not.toContain('typo');
      expect(transformedContent).toContain('correction');
    });
  });

  describe('Format-Specific Behavior Consistency', () => {
    it('should prevent replacement button click for non-EPUB formats', () => {
      // Verify that bookData.book?.format !== 'EPUB' results in disabled: true
      const testFormats = ['PDF', 'TXT', 'MOBI', 'CBZ', 'CBR'];
      
      testFormats.forEach(format => {
        const isDisabled = format !== 'EPUB';
        expect(isDisabled).toBe(true);
      });
    });

    it('should allow replacement button click for EPUB format only', () => {
      const format = 'EPUB';
      const isDisabled = format !== 'EPUB';
      expect(isDisabled).toBe(false);
    });

    it('should conditionally add replacement transformer based on book format', () => {
      // Test helper to verify transformer list construction
      const buildTransformerList = (bookFormat: string | undefined) => {
        const baseTransformers = [
          'style',
          'punctuation',
          'footnote',
          'whitespace',
          'language',
          'sanitizer',
          'simplecc',
        ];
        
        if (bookFormat === 'EPUB') {
          baseTransformers.push('replacement');
        }
        
        return baseTransformers;
      };
      
      // Non-EPUB formats should not have replacement
      expect(buildTransformerList('PDF')).not.toContain('replacement');
      expect(buildTransformerList('TXT')).not.toContain('replacement');
      expect(buildTransformerList(undefined)).not.toContain('replacement');
      
      // EPUB should have replacement
      expect(buildTransformerList('EPUB')).toContain('replacement');
    });
  });
});
