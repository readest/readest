'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Streamdown } from 'streamdown';

/**
 * User-message text rendering. Bare react-markdown with GFM but no
 * remark-math / rehype-raw / rehype-katex / harden-react-markdown —
 * the user message is whatever they typed; we don't expect math or HTML
 * from them. Inline-styled overrides match the legacy MarkdownText
 * compact look.
 *
 * Memoized on `text` so repeated re-renders of the parent thread don't
 * re-tokenize unchanged user messages.
 */
export const UserTextPart = memo(function UserTextPart({ text }: { text: string }) {
  return (
    <div className='prose prose-sm dark:prose-invert max-w-none break-words whitespace-pre-wrap'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span className='inline'>{children}</span>,
          a: ({ href, children }) => (
            <a href={href} target='_blank' rel='noopener noreferrer'>
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className='bg-base-300/50 text-base-content rounded px-1.5 py-0.5 font-mono text-sm'>
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

/**
 * Assistant-message text rendering via Streamdown — handles
 * streaming-aware markdown (fade-in spans, partial-token safety) so we
 * don't get half-formatted output flickering as deltas arrive.
 *
 * Memoized on `text` for the same reason as UserTextPart. The agent
 * runtime coalesces consecutive text deltas in the store reducer, so
 * the text grows monotonically per assistant message.
 */
export const AssistantTextPart = memo(function AssistantTextPart({ text }: { text: string }) {
  return (
    <div className='prose prose-sm dark:prose-invert max-w-none break-words'>
      <Streamdown>{text}</Streamdown>
    </div>
  );
});
