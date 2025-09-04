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
          adjustHeight();
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
      if (editorRef.current) {
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
      adjustHeight();
      onChange(e.target.value);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape' && onEscape) {
        onEscape();
        return;
      }

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSave) {
        e.preventDefault();
        onSave();
        return;
      }
    };

    return (
      <textarea
        ref={editorRef}
        className={clsx(
          'textarea textarea-ghost min-h-[1em] resize-none !outline-none',
          'inset-0 w-full rounded-none border-0 bg-transparent p-0',
          'content font-size-sm',
          className,
        )}
        dir='auto'
        rows={minRows}
        spellCheck={spellCheck}
        disabled={disabled}
        onChange={handleChange}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || ''}
      />
    );
  },
);

TextEditor.displayName = 'TextEditor';

export default TextEditor;
