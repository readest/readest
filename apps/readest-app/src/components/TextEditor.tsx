import clsx from 'clsx';
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';

interface TextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onSave?: () => void;
  onEscape?: () => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  disabled?: boolean;
  maxRows?: number;
  minRows?: number;
  autoResize?: boolean;
  ariaLabel?: string;
  onSelect?: (start: number, end: number) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: (value: string) => void;
  // Read Aloud holds the view still while this editor has focus (#6837). The
  // Notebook turns it off: it stays open while the page turns (#7663).
  holdsReadAloud?: boolean;
}

export interface TextEditorRef {
  focus: () => void;
  blur: () => void;
  getValue: () => string;
  setValue: (value: string) => void;
  getElement: () => HTMLTextAreaElement | null;
}

const TextEditor = forwardRef<TextEditorRef, TextEditorProps>(
  (
    {
      value,
      onChange,
      onBlur,
      onSave,
      onEscape,
      placeholder,
      className,
      autoFocus = false,
      spellCheck = false,
      disabled = false,
      maxRows,
      minRows = 1,
      autoResize = true,
      ariaLabel,
      onSelect,
      onCompositionStart,
      onCompositionEnd,
      holdsReadAloud = true,
    },
    ref,
  ) => {
    const editorRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      blur: () => {
        editorRef.current?.blur();
      },
      getValue: () => {
        return editorRef.current?.value || '';
      },
      setValue: (newValue: string) => {
        if (editorRef.current) {
          editorRef.current.value = newValue;
          if (autoResize) adjustHeight();
        }
      },
      getElement: () => editorRef.current,
    }));

    useEffect(() => {
      if (autoFocus && editorRef.current) {
        editorRef.current.focus();
      }
    }, [autoFocus]);

    useEffect(() => {
      if (autoResize && editorRef.current) {
        editorRef.current.value = value;
        adjustHeight();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const adjustHeight = () => {
      if (editorRef.current) {
        editorRef.current.style.height = 'auto';
        const scrollHeight = editorRef.current.scrollHeight;

        // Calculate max height based on maxRows
        let maxHeight = Infinity;
        if (maxRows) {
          const lineHeight = parseInt(getComputedStyle(editorRef.current).lineHeight);
          maxHeight = lineHeight * maxRows;
        }

        // Calculate min height based on minRows
        const lineHeight = parseInt(getComputedStyle(editorRef.current).lineHeight) || 20;
        const minHeight = lineHeight * minRows;

        const finalHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
        editorRef.current.style.height = `${finalHeight}px`;
      }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (autoResize) adjustHeight();
      onChange(e.target.value);
    };

    // Runs in the capture phase: the note popup and sheet stop every keydown
    // inside them. A key handled here stops too, or the host closes on the
    // same Escape and the note is cancelled twice.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }

      const isComposing = e.nativeEvent.isComposing || e.keyCode === 229;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSave && !isComposing) {
        e.preventDefault();
        e.stopPropagation();
        onSave();
        return;
      }
    };

    return (
      <textarea
        ref={editorRef}
        className={clsx(
          'textarea textarea-ghost min-h-[1em] resize-none outline-hidden!',
          'inset-0 w-full rounded-none border-0 bg-transparent p-0',
          'content font-size-sm',
          className,
        )}
        data-note-editor={holdsReadAloud ? '' : undefined}
        dir='auto'
        rows={minRows}
        spellCheck={spellCheck}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={handleChange}
        onBlur={onBlur}
        onKeyDownCapture={handleKeyDown}
        onSelect={(event) =>
          onSelect?.(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)
        }
        onCompositionStart={onCompositionStart}
        onCompositionEnd={(event) => onCompositionEnd?.(event.currentTarget.value)}
        defaultValue={value}
        placeholder={placeholder || ''}
      />
    );
  },
);

TextEditor.displayName = 'TextEditor';

export default TextEditor;
