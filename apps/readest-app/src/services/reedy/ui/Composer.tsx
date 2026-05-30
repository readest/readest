'use client';

import { useCallback, useState, type KeyboardEvent } from 'react';
import { Send, Square, WandSparkles } from 'lucide-react';

/**
 * Minimal Skill shape the composer's chip row renders. The full Skill
 * type (Phase 5 — separate PR) is a strict superset; the composer only
 * touches these fields, so we declare locally to avoid a cross-branch
 * dependency.
 */
export interface ComposerSkill {
  id: string;
  name: string;
  description: string;
}
type Skill = ComposerSkill;

/**
 * Multi-line input + send/abort button + skill chip row (Phase 4.2.h).
 *
 * Keyboard:
 *   - Cmd/Ctrl + Enter → send
 *   - Esc              → abort if a turn is running, otherwise blur
 *   - Enter alone      → newline (per the plan's UX)
 */
export function Composer({
  isRunning,
  onSend,
  onAbort,
  disabled,
  skills,
  activeSkillId,
  onSkillSelect,
}: {
  isRunning: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  disabled?: boolean;
  skills?: Skill[];
  activeSkillId?: string | null;
  onSkillSelect?: (id: string | null) => void;
}) {
  const [text, setText] = useState('');

  const send = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (!disabled && !isRunning) send();
    } else if (e.key === 'Escape') {
      if (isRunning) {
        e.preventDefault();
        onAbort();
      }
    }
  };

  return (
    <div className='reedy-agent-composer border-base-content/10 bg-base-100 flex flex-col gap-2 border-t p-2'>
      {skills && skills.length > 0 && (
        <div className='flex flex-wrap items-center gap-1'>
          <span className='text-base-content/40 me-1 text-[10px] uppercase'>Skill</span>
          <button
            type='button'
            className={chipClass(activeSkillId == null)}
            onClick={() => onSkillSelect?.(null)}
          >
            None
          </button>
          {skills.map((s) => (
            <button
              key={s.id}
              type='button'
              className={chipClass(activeSkillId === s.id)}
              onClick={() => onSkillSelect?.(s.id)}
              title={s.description}
            >
              <WandSparkles className='size-3' />
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className='border-base-content/10 bg-base-200/40 eink-bordered flex items-end gap-1 rounded-md border px-2 py-1.5'>
        <textarea
          className='text-base-content placeholder:text-base-content/40 max-h-40 min-h-[1.75rem] flex-1 resize-none bg-transparent text-sm outline-none'
          rows={1}
          placeholder='Ask Reedy about this book…'
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {isRunning ? (
          <button
            type='button'
            className='btn btn-primary btn-sm size-7 min-h-0 rounded-full p-0'
            onClick={onAbort}
            title='Stop (Esc)'
            aria-label='Stop'
          >
            <Square className='size-3' />
          </button>
        ) : (
          <button
            type='button'
            className='btn btn-primary btn-sm size-7 min-h-0 rounded-full p-0 disabled:opacity-40'
            onClick={send}
            disabled={disabled || text.trim().length === 0}
            title='Send (⌘/Ctrl + Enter)'
            aria-label='Send'
          >
            <Send className='size-3' />
          </button>
        )}
      </div>
    </div>
  );
}

function chipClass(active: boolean): string {
  return [
    'border-base-content/10 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
    active ? 'bg-primary text-primary-content border-primary' : 'bg-base-100 hover:bg-base-200',
  ].join(' ');
}
