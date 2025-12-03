import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ReplacementOptions from '@/app/reader/components/annotator/ReplacementOptions';

describe('ReplacementOptions Component', () => {
  const mockHandlers = {
    onFixOnce: vi.fn(),
    onFixInBook: vi.fn(),
    onFixInLibrary: vi.fn(),
    onClose: vi.fn(),
  };

  const defaultProps = {
    isVertical: false,
    style: { left: '100px', top: '100px' },
    selectedText: 'test word',
    ...mockHandlers,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup(); // ADD THIS!
  });

  describe('Rendering', () => {
    it('should render all three replacement options', () => {
      render(<ReplacementOptions {...defaultProps} />);

      expect(screen.getByText('Fix this once')).toBeTruthy();
      expect(screen.getByText('Fix in this book')).toBeTruthy();
      expect(screen.getByText('Fix in library')).toBeTruthy();
    });

    it('should not render "Fix all future" option', () => {
      render(<ReplacementOptions {...defaultProps} />);

      expect(screen.queryByText('Fix all future')).toBeNull();
    });

    it('should apply custom styles', () => {
      const customStyle = { left: '200px', top: '300px', width: '250px' };
      const { container } = render(<ReplacementOptions {...defaultProps} style={customStyle} />);

      const menuElement = container.querySelector('.replacement-options');
      expect(menuElement).toBeTruthy();
    });
  });

  describe('Button Click Handlers', () => {
    it('should call onFixOnce when "Fix this once" is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const button = screen.getByText('Fix this once');
      fireEvent.click(button);

      expect(mockHandlers.onFixOnce).toHaveBeenCalledTimes(1);
    });

    it('should call onFixInBook when "Fix in this book" is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const button = screen.getByText('Fix in this book');
      fireEvent.click(button);

      expect(mockHandlers.onFixInBook).toHaveBeenCalledTimes(1);
    });

    it('should call onFixInLibrary when "Fix in library" is clicked', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const button = screen.getByText('Fix in library');
      fireEvent.click(button);

      expect(mockHandlers.onFixInLibrary).toHaveBeenCalledTimes(1);
    });
  });

  describe('Click Outside Behavior', () => {
    it('should call onClose when clicking outside the menu', () => {
      const { container } = render(
        <div>
          <div data-testid="outside">Outside element</div>
          <ReplacementOptions {...defaultProps} />
        </div>
      );

      const outsideElement = screen.getByTestId('outside');
      fireEvent.mouseDown(outsideElement);

      expect(mockHandlers.onClose).toHaveBeenCalled();
    });

    it('should not call onClose when clicking inside the menu', () => {
      render(<ReplacementOptions {...defaultProps} />);

      const button = screen.getByText('Fix this once');
      fireEvent.mouseDown(button);

      expect(mockHandlers.onClose).not.toHaveBeenCalled();
    });
  });
});