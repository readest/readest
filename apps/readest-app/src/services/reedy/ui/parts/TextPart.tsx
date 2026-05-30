'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
 * Assistant-message text rendering — same react-markdown stack as
 * UserTextPart, slightly richer block styling (paragraphs render as
 * `<p>` instead of inline spans). The original plan called for
 * Streamdown's streaming-aware fade-in spans, but Streamdown statically
 * depends on Shiki whose TextMate grammars contain lookbehind regex
 * `(?<=...)` / `(?<!...)` patterns — the repo's `check:lookbehind-regex`
 * gate rejects them because some Chromium versions on older Android
 * webviews still don't support lookbehind syntax (see CI run that
 * landed this fix). Streaming-fade polish returns in a follow-up that
 * either tree-shakes Shiki out or uses a different streaming renderer.
 *
 * Memoized on `text` for the same reason as UserTextPart. The agent
 * runtime coalesces consecutive text deltas in the store reducer, so
 * the text grows monotonically per assistant message.
 */
export const AssistantTextPart = memo(function AssistantTextPart({ text }: { text: string }) {
  return (
    <div className='prose prose-sm dark:prose-invert max-w-none break-words'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target='_blank' rel='noopener noreferrer'>
              {children}
            </a>
          ),
          code: ({ children, className }) => {
            // Inline code: no className. Fenced blocks: get a language-x class.
            if (!className) {
              return (
                <code className='bg-base-300/50 text-base-content rounded px-1.5 py-0.5 font-mono text-sm'>
                  {children}
                </code>
              );
            }
            return <code className={className}>{children}</code>;
          },
          pre: ({ children }) => (
            <pre className='bg-base-300/40 my-2 overflow-auto rounded-md px-3 py-2 font-mono text-xs'>
              {children}
            </pre>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
