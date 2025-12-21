'use client';

import type { FC } from 'react';
import {
  ActionBarPrimitive,
  AssistantIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantState,
} from '@assistant-ui/react';
import {
  ArrowUpIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react';

import { MarkdownText } from '@/components/assistant-ui/markdown-text';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type { ScoredChunk } from '@/services/ai/types';

interface ThreadProps {
  sources?: ScoredChunk[];
  onClear?: () => void;
}

export const Thread: FC<ThreadProps> = ({ sources = [], onClear }) => {
  return (
    <ThreadPrimitive.Root className='flex h-full w-full flex-col items-stretch bg-base-100 px-3'>
      <ThreadPrimitive.Empty>
        <div className='flex h-full flex-col items-center justify-center animate-in fade-in duration-300'>
          <div className='mb-4 rounded-full bg-base-content/10 p-3'>
            <BookOpenIcon className='size-6 text-base-content' />
          </div>
          <h3 className='mb-1 text-sm font-medium text-base-content'>Ask about this book</h3>
          <p className='mb-4 text-xs text-base-content/60'>Get answers based on the book content</p>
          <Composer onClear={onClear} />
        </div>
      </ThreadPrimitive.Empty>

      <AssistantIf condition={(s) => s.thread.isEmpty === false}>
        <ThreadPrimitive.Viewport className='flex grow flex-col overflow-y-auto pt-2 scroll-smooth'>
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              EditComposer,
              AssistantMessage: () => <AssistantMessage sources={sources} />,
            }}
          />
          <p className='mx-auto w-full p-1 text-center text-[10px] text-base-content/40'>
            AI can make mistakes. Verify with the book.
          </p>
        </ThreadPrimitive.Viewport>
        <Composer onClear={onClear} />
      </AssistantIf>
    </ThreadPrimitive.Root>
  );
};

interface ComposerProps {
  onClear?: () => void;
}

const Composer: FC<ComposerProps> = ({ onClear }) => {
  const isEmpty = useAssistantState((s) => s.composer.isEmpty);
  const isRunning = useAssistantState((s) => s.thread.isRunning);

  return (
    <ComposerPrimitive.Root
      className='group/composer mx-auto mb-2 w-full animate-in fade-in slide-in-from-bottom-2 duration-300'
      data-empty={isEmpty}
      data-running={isRunning}
    >
      <div className='overflow-hidden rounded-2xl bg-base-200 shadow-sm ring-1 ring-base-content/10 ring-inset transition-all duration-200 focus-within:ring-base-content/20'>
        <div className='flex items-end gap-0.5 p-1.5'>
          {onClear && (
            <button
              type='button'
              onClick={onClear}
              className='mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-base-content transition-colors hover:bg-base-300'
              aria-label='Clear chat'
            >
              <Trash2Icon className='size-3.5' />
            </button>
          )}

          <ComposerPrimitive.Input
            placeholder='Ask about this book...'
            rows={1}
            className='my-1 h-5 max-h-[200px] min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 text-base-content outline-none placeholder:text-base-content/40'
          />

          <div className='relative mb-0.5 size-7 shrink-0 rounded-full bg-base-content text-base-100'>
            <ComposerPrimitive.Send className='absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out group-data-[empty=true]/composer:scale-0 group-data-[running=true]/composer:scale-0 group-data-[empty=true]/composer:opacity-0 group-data-[running=true]/composer:opacity-0'>
              <ArrowUpIcon className='size-3.5' />
            </ComposerPrimitive.Send>

            <ComposerPrimitive.Cancel className='absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out group-data-[running=false]/composer:scale-0 group-data-[running=false]/composer:opacity-0'>
              <SquareIcon className='size-3' fill='currentColor' />
            </ComposerPrimitive.Cancel>

            {/* Placeholder when empty and not running */}
            <div className='absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out group-data-[empty=false]/composer:scale-0 group-data-[running=true]/composer:scale-0 group-data-[empty=false]/composer:opacity-0 group-data-[running=true]/composer:opacity-0'>
              <ArrowUpIcon className='size-3.5 opacity-40' />
            </div>
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
};

interface AssistantMessageProps {
  sources?: ScoredChunk[];
}

const AssistantMessage: FC<AssistantMessageProps> = ({ sources = [] }) => {
  return (
    <MessagePrimitive.Root className='group/message relative mx-auto mb-1 flex w-full flex-col pb-0.5 animate-in fade-in slide-in-from-bottom-1 duration-200'>
      <div className='flex flex-col items-start'>
        {sources.length > 0 && <SourcesDisplay sources={sources} />}

        <div className='w-full max-w-none'>
          <div className='prose prose-xs text-sm text-base-content [&_*]:!text-base-content [&_a]:!text-primary [&_code]:!text-base-content'>
            <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          </div>
        </div>

        <div className='mt-0.5 flex h-6 w-full items-center justify-start gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100'>
          <ActionBarPrimitive.Root className='-ml-1 flex items-center gap-0.5'>
            <BranchPicker />
            <ActionBarPrimitive.Reload className='flex size-6 items-center justify-center rounded-full text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content'>
              <RefreshCwIcon className='size-3' />
            </ActionBarPrimitive.Reload>
            <ActionBarPrimitive.Copy className='flex size-6 items-center justify-center rounded-full text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content'>
              <AssistantIf condition={({ message }) => message.isCopied}>
                <CheckIcon className='size-3' />
              </AssistantIf>
              <AssistantIf condition={({ message }) => !message.isCopied}>
                <CopyIcon className='size-3' />
              </AssistantIf>
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

interface SourcesDisplayProps {
  sources: ScoredChunk[];
}

const SourcesDisplay: FC<SourcesDisplayProps> = ({ sources }) => {
  return (
    <Collapsible className='mb-2 w-full'>
      <CollapsibleTrigger className='flex items-center gap-1.5 text-[11px] text-base-content/60 transition-colors hover:text-base-content'>
        <BookOpenIcon className='size-2.5' />
        <span>{sources.length} sources from book</span>
      </CollapsibleTrigger>
      <CollapsibleContent className='mt-1.5 space-y-1'>
        {sources.map((source, i) => (
          <div
            key={source.id || i}
            className='rounded-lg border border-base-content/10 bg-base-200/50 px-2 py-1.5 text-[11px]'
          >
            <div className='font-medium text-base-content'>
              {source.chapterTitle || `Section ${source.sectionIndex + 1}`}
            </div>
            <div className='mt-0.5 line-clamp-2 text-base-content/60'>{source.text}</div>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className='group/message relative mx-auto mb-1 flex w-full flex-col pb-0.5 animate-in fade-in slide-in-from-bottom-1 duration-200'>
      <div className='flex flex-col items-end'>
        <div className='relative max-w-[90%] rounded-2xl rounded-br-md border border-base-content/10 bg-base-200 px-3 py-2 text-base-content'>
          <div className='prose prose-xs text-sm text-base-content [&_*]:!text-base-content'>
            <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          </div>
        </div>
        <div className='mt-0.5 flex h-6 items-center justify-end gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100'>
          <ActionBarPrimitive.Root className='flex items-center gap-0.5'>
            <ActionBarPrimitive.Edit className='flex size-6 items-center justify-center rounded-full text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content'>
              <PencilIcon className='size-3' />
            </ActionBarPrimitive.Edit>
            <ActionBarPrimitive.Copy className='flex size-6 items-center justify-center rounded-full text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content'>
              <AssistantIf condition={({ message }) => message.isCopied}>
                <CheckIcon className='size-3' />
              </AssistantIf>
              <AssistantIf condition={({ message }) => !message.isCopied}>
                <CopyIcon className='size-3' />
              </AssistantIf>
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className='mx-auto flex w-full flex-col py-2'>
      <ComposerPrimitive.Root className='ml-auto flex w-full max-w-[90%] flex-col overflow-hidden rounded-2xl border border-base-content/10 bg-base-200'>
        <ComposerPrimitive.Input className='min-h-10 w-full resize-none bg-transparent p-3 text-sm text-base-content outline-none' />
        <div className='mx-2 mb-2 flex items-center gap-1.5 self-end'>
          <ComposerPrimitive.Cancel asChild>
            <Button variant='ghost' size='sm' className='h-7 px-2 text-xs'>
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size='sm' className='h-7 px-2 text-xs'>Update</Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<{ className?: string }> = ({ className }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn('mr-0.5 inline-flex items-center text-[10px] text-base-content/40', className)}
    >
      <BranchPickerPrimitive.Previous asChild>
        <button
          type='button'
          className='flex size-6 items-center justify-center rounded-full transition-colors hover:bg-base-200 hover:text-base-content'
        >
          <ChevronLeftIcon className='size-3' />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className='font-medium'>
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button
          type='button'
          className='flex size-6 items-center justify-center rounded-full transition-colors hover:bg-base-200 hover:text-base-content'
        >
          <ChevronRightIcon className='size-3' />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
