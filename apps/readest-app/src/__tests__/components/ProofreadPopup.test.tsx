import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { EnvProvider } from '@/context/EnvContext';
import ProofreadPopup from '@/app/reader/components/annotator/ProofreadPopup';

vi.mock('@/services/environment', async () => {
  const actual = await vi.importActual('@/services/environment');

  const mockAppService = {
    init: vi.fn().mockResolvedValue(undefined),
    // Add any other methods from AppService interface
  };

  return {
    ...actual,
    default: {
      getAppService: vi.fn().mockResolvedValue(mockAppService),
    },
  };
});

global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderWithProviders(ui: React.ReactNode) {
  return render(<EnvProvider>{ui}</EnvProvider>);
}

describe('ProofreadPopup Component', () => {
  const mockOnConfirm = vi.fn();
  const mockOnClose = vi.fn();

  const defaultProps = {
    bookKey: 'test-book',
    isVertical: false,
    selectedText: 'test word',
    selection: {
      key: 'test-book',
      text: 'test word',
      cfi: 'epubcfi(/6/2[chapter1]!/4/1:0)',
      range: {
        deleteContents: vi.fn(),
        insertNode: vi.fn(),
        startContainer: document.createTextNode('test word here'),
        endContainer: document.createTextNode('test word here'),
        startOffset: 5,
        endOffset: 9,
      } as unknown as Range,
      index: 0,
    },
    position: { point: { x: 100, y: 100 } },
    trianglePosition: { point: { x: 100, y: 100 } },
    popupWidth: 440,
    popupHeight: 200,
    onConfirm: mockOnConfirm,
    onDismiss: mockOnClose,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render default replacement scope options', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      expect(screen.getByText('Current selection')).toBeTruthy();
    });

    it('should render the replacement text input field', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter text...');
      expect(input).toBeTruthy();
    });

    it('should render the case sensitive checkbox', () => {
      const { container } = renderWithProviders(<ProofreadPopup {...defaultProps} />);

      expect(screen.getByText('Case sensitive:')).toBeTruthy();
      expect(container.querySelector('input[type="checkbox"]')).toBeTruthy();
    });

    it('should render the Apply button', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      expect(screen.getByText('Apply')).toBeTruthy();
    });

    it('should display selected text preview', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      expect(screen.getByText(/Selected text:/)).toBeTruthy();
      expect(screen.getByText(/"test word"/)).toBeTruthy();
    });
  });

  describe('Case Sensitive Checkbox', () => {
    it('should be checked by default (case-sensitive)', () => {
      const { container } = renderWithProviders(<ProofreadPopup {...defaultProps} />);

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('should toggle when clicked', async () => {
      const { container } = renderWithProviders(<ProofreadPopup {...defaultProps} />);

      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(false);

      fireEvent.click(checkbox);
      expect(checkbox.checked).toBe(true);
    });
  });

  describe('Replacement Text Input', () => {
    it('should update value when user types', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter text...') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'new text' } });

      expect(input.value).toBe('new text');
    });

    it('should trim whitespace from replacement text', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter text...');
      fireEvent.change(input, { target: { value: '  trimmed  ' } });

      const confirmButton = screen.getByText('Apply');
      fireEvent.click(confirmButton);

      expect(mockOnConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          replacement: 'trimmed',
        }),
      );
    });
  });

  describe('Scope Selection Handlers', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const createValidSelection = () => ({
      ...defaultProps,
      selection: {
        ...defaultProps.selection,
        text: 'word',
        cfi: 'epubcfi(/6/4[chap01ref]!/4/2/1:0)',
        range: {
          deleteContents: vi.fn(),
          insertNode: vi.fn(),
          startContainer: document.createTextNode('test word here'),
          endContainer: document.createTextNode('test word here'),
          startOffset: 5,
          endOffset: 9,
        } as unknown as Range,
      },
    });

    it('should call onConfirm with correct scope for "selection"', async () => {
      renderWithProviders(<ProofreadPopup {...createValidSelection()} />);

      const input = screen.getByPlaceholderText('Enter text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const applyButton = screen.getByText('Apply');
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({ scope: 'selection' }));
      });
    });

    it('should call onConfirm with correct scope for "book"', async () => {
      renderWithProviders(<ProofreadPopup {...createValidSelection()} />);

      const input = screen.getByPlaceholderText('Enter text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const scopeSelect = screen.getByRole('combobox');
      fireEvent.change(scopeSelect, { target: { value: 'book' } });

      const applyButton = screen.getByText('Apply');
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({ scope: 'book' }));
      });
    });

    it('should call onConfirm with correct scope for "library"', async () => {
      renderWithProviders(<ProofreadPopup {...createValidSelection()} />);

      const input = screen.getByPlaceholderText('Enter text...');
      fireEvent.change(input, { target: { value: 'replacement' } });

      const scopeSelect = screen.getByRole('combobox');
      fireEvent.change(scopeSelect, { target: { value: 'library' } });

      const applyButton = screen.getByText('Apply');
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({ scope: 'library' }));
      });
    });
  });

  describe('Click Outside Behavior', () => {
    it('should not call onClose when clicking inside the menu', () => {
      renderWithProviders(<ProofreadPopup {...defaultProps} />);

      const input = screen.getByPlaceholderText('Enter text...');
      fireEvent.mouseDown(input);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
