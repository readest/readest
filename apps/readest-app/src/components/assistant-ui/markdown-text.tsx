'use client';

import '@assistant-ui/react-markdown/styles/dot.css';

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { type FC, memo, useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';

import { TooltipIconButton } from '@/components/assistant-ui/tooltip-icon-button';
import { cn } from '@/lib/utils';

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className='aui-md' components={defaultComponents} />
  );
};

export const MarkdownText = memo(MarkdownTextImpl);

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard();
  const onCopy = () => {
    if (!code || isCopied) return;
    copyToClipboard(code);
  };

  return (
    <div className='mt-4 flex items-center justify-between gap-4 rounded-t-lg bg-muted px-4 py-2 text-sm font-semibold text-foreground'>
      <span className='lowercase [&>span]:text-xs'>{language}</span>
      <TooltipIconButton tooltip='Copy' onClick={onCopy}>
        {!isCopied && <CopyIcon className='size-3' />}
        {isCopied && <CheckIcon className='size-3' />}
      </TooltipIconButton>
    </div>
  );
};

const useCopyToClipboard = ({ copiedDuration = 3000 }: { copiedDuration?: number } = {}) => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const copyToClipboard = (value: string) => {
    if (!value) return;

    navigator.clipboard.writeText(value).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), copiedDuration);
    });
  };

  return { isCopied, copyToClipboard };
};

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        'mb-4 scroll-m-20 text-2xl font-bold tracking-tight last:mb-0',
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        'mb-3 mt-6 scroll-m-20 text-xl font-semibold tracking-tight first:mt-0 last:mb-0',
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        'mb-2 mt-4 scroll-m-20 text-lg font-semibold tracking-tight first:mt-0 last:mb-0',
        className,
      )}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p className={cn('mb-3 leading-7 first:mt-0 last:mb-0', className)} {...props} />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn('font-medium text-primary underline underline-offset-4', className)}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote className={cn('border-l-2 pl-4 italic', className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn('my-3 ml-6 list-disc [&>li]:mt-1', className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn('my-3 ml-6 list-decimal [&>li]:mt-1', className)} {...props} />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn('my-4 border-b', className)} {...props} />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        'overflow-x-auto rounded-b-lg rounded-t-none bg-zinc-900 p-4 text-sm text-zinc-100',
        className,
      )}
      {...props}
    />
  ),
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock();
    return (
      <code
        className={cn(
          !isCodeBlock && 'rounded border bg-muted px-1 py-0.5 font-mono text-sm',
          className,
        )}
        {...props}
      />
    );
  },
  CodeHeader,
});
