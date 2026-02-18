'use client';

import { useEffect, useRef, type FC } from 'react';
import {
  ActionBarPrimitive,
  AssistantIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantState,
  useThreadViewport,
  useThread,
} from '@assistant-ui/react';
import {
  ArrowUpIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  Trash2Icon,
} from 'lucide-react';

import { MarkdownText } from './MarkdownText';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/tailwind';
import type { ScoredChunk } from '@/services/ai/types';

interface ThreadProps {
  sources?: ScoredChunk[];
  onClear?: () => void;
  onResetIndex?: () => void;
  isLoadingHistory?: boolean;
  hasStoredMessages?: boolean;
}

const ScrollToBottomButton: FC = () => {
  const isAtBottom = useThreadViewport((v) => v.isAtBottom);
  const lastMessageRole = useThread((t) => t.messages.at(-1)?.role);
  const isRunning = useThread((t) => t.isRunning);

  // Don't show button if last message is user with no AI response yet
  if (lastMessageRole === 'user' && !isRunning) return null;

  return (
    <ThreadPrimitive.ScrollToBottom
      className={cn(
        'absolute bottom-4 left-1/2 z-10',
        'flex items-center justify-center rounded-full p-2',
        'bg-base-300 text-base-content',
        'hover:bg-base-200',
        'border-base-content/10 border',
        'shadow-sm',
        'active:scale-[0.97]',
        'transition-[opacity,filter,transform] duration-150 ease-out',
        isAtBottom
          ? 'pointer-events-none -translate-x-1/2 scale-90 opacity-0 blur-sm'
          : '-translate-x-1/2 scale-100 opacity-100 blur-0',
      )}
      style={{
        animation: isAtBottom ? 'none' : 'subtleBounce 2.5s ease-in-out infinite',
      }}
      aria-hidden={isAtBottom}
      aria-label='Scroll to bottom'
    >
      <ChevronDownIcon className='size-4' />
      <style>{`
        @keyframes subtleBounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50% { transform: translateX(-50%) translateY(1px); }
        }
      `}</style>
    </ThreadPrimitive.ScrollToBottom>
  );
};

export const Thread: FC<ThreadProps> = ({
  sources = [],
  onClear,
  onResetIndex,
  isLoadingHistory = false,
  hasStoredMessages = false,
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const isInitialMount = useRef(true);
  const messageCount = useThread((t) => t.messages.length);
  const lastMessageRole = useThread((t) => t.messages.at(-1)?.role);
  const isRunning = useThread((t) => t.isRunning);
  const isThreadEmpty = useAssistantState((s) => s.thread.isEmpty);

  const hideEmptyState = isLoadingHistory || (hasStoredMessages && isThreadEmpty);
  const showEmptyState = isThreadEmpty && !hideEmptyState;

  useEffect(() => {
    if (isInitialMount.current && messageCount > 0 && viewportRef.current) {
      isInitialMount.current = false;
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      });
    }
  }, [messageCount]);

  useEffect(() => {
    if (lastMessageRole === 'user' && viewportRef.current && !isInitialMount.current) {
      requestAnimationFrame(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;

        const messages = viewport.querySelectorAll('[data-message-role="user"]');
        const lastUserMessage = messages[messages.length - 1];
        if (lastUserMessage) {
          lastUserMessage.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
          });
        }
      });
    }
  }, [messageCount, lastMessageRole]);

  const getSpacerHeight = () => {
    if (lastMessageRole === 'user' && !isRunning) {
      return 'min-h-8';
    }
    if (isRunning) {
      return 'min-h-[50vh]';
    }
    if (lastMessageRole === 'assistant') {
      return 'min-h-4';
    }
    return 'min-h-4';
  };

  return (
    <ThreadPrimitive.Root className='bg-base-100 relative flex h-full w-full flex-col items-stretch px-3'>
      {showEmptyState && (
        <ThreadPrimitive.Empty>
          <div className='animate-in fade-in flex h-full flex-col items-center justify-center duration-300'>
            <div className='bg-base-content/10 mb-4 rounded-full p-3'>
              <BookOpenIcon className='text-base-content size-6' />
            </div>
            <h3 className='text-base-content mb-1 text-sm font-medium'>Ask about this book</h3>
            <p className='text-base-content/60 mb-4 text-xs'>
              Get answers based on the book content
            </p>
            <Composer onClear={onClear} onResetIndex={onResetIndex} />
          </div>
        </ThreadPrimitive.Empty>
      )}

      <AssistantIf condition={(s) => s.thread.isEmpty === false}>
        <div className='relative min-h-0 flex-1 transition-opacity duration-300'>
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            autoScroll={false}
            className='absolute inset-0 flex flex-col overflow-y-auto scroll-smooth pt-2'
          >
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                EditComposer,
                AssistantMessage: () => <AssistantMessage sources={sources} />,
              }}
            />
            <p className='text-base-content/40 mx-auto w-full p-1 text-center text-[10px]'>
              AI can make mistakes. Verify with the book.
            </p>
            <div
              className={cn('flex-shrink transition-all duration-300', getSpacerHeight())}
              aria-hidden='true'
            />
          </ThreadPrimitive.Viewport>

          <ScrollToBottomButton />
        </div>

        <Composer onClear={onClear} onResetIndex={onResetIndex} />
      </AssistantIf>
    </ThreadPrimitive.Root>
  );
};

interface ComposerProps {
  onClear?: () => void;
  onResetIndex?: () => void;
}

const Composer: FC<ComposerProps> = ({ onClear, onResetIndex }) => {
  const isEmpty = useAssistantState((s) => s.composer.isEmpty);
  const isRunning = useAssistantState((s) => s.thread.isRunning);

  return (
    <ComposerPrimitive.Root
      className='group/composer animate-in fade-in slide-in-from-bottom-2 mx-auto mb-2 w-full duration-300'
      data-empty={isEmpty}
      data-running={isRunning}
    >
      <div className='bg-base-200 ring-base-content/10 focus-within:ring-base-content/20 overflow-hidden rounded-2xl shadow-sm ring-1 ring-inset transition-all duration-200'>
        <div className='flex items-end gap-0.5 p-1.5'>
          {onClear && (
            <button
              type='button'
              onClick={onClear}
              className='text-base-content hover:bg-base-300 mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors'
              aria-label='Clear chat'
            >
              <Trash2Icon className='size-3.5' />
            </button>
          )}

          {onResetIndex && (
            <button
              type='button'
              onClick={onResetIndex}
              className='text-base-content hover:bg-base-300 mb-0.5 flex size-7 shrink-0 items-center justify-center rounded-full transition-colors'
              title='Re-index book'
              aria-label='Re-index book'
            >
              <RefreshCwIcon className='size-3.5' />
            </button>
          )}

          <ComposerPrimitive.Input
            placeholder='Ask about this book...'
            rows={1}
            className='text-base-content placeholder:text-base-content/40 my-1 h-5 max-h-[200px] min-w-0 flex-1 resize-none bg-transparent text-sm leading-5 outline-none'
          />

          <div className='bg-base-content text-base-100 relative mb-0.5 size-7 shrink-0 rounded-full'>
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
    <MessagePrimitive.Root className='group/message animate-in fade-in slide-in-from-bottom-1 relative mx-auto mb-1 flex w-full flex-col pb-0.5 duration-200'>
      <div className='flex flex-col items-start'>
        <div className='w-full max-w-none'>
          <div className='prose prose-xs text-base-content [&_*]:!text-base-content [&_a]:!text-primary [&_code]:!text-base-content select-text text-sm'>
            <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          </div>
        </div>

        <AssistantIf condition={(s) => s.message.status?.type !== 'running'}>
          <div className='animate-in fade-in mt-0.5 flex h-6 w-full items-center justify-start gap-0.5 duration-300'>
            <ActionBarPrimitive.Root className='-ml-1 flex items-center gap-0.5'>
              <BranchPicker />
              {sources.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'
                      aria-label='View sources'
                    >
                      <BookOpenIcon className='size-3' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align='start'
                    className='bg-base-100 border-base-content/10 w-80 p-2'
                  >
                    <div className='text-base-content/60 mb-2 px-1 text-[11px] font-semibold'>
                      Sources from book
                    </div>
                    <div className='flex flex-col gap-1.5'>
                      {sources.map((source, i) => (
                        <div
                          key={source.id || i}
                          className='border-base-content/10 bg-base-200/50 rounded-lg border px-2 py-1.5 text-[11px]'
                        >
                          <div className='text-base-content font-medium'>
                            {source.chapterTitle ||
                              (typeof source.chapterNumber === 'number'
                                ? `Chapter ${source.chapterNumber}`
                                : `Section ${source.sectionIndex + 1}`)}
                          </div>
                          <div className='text-base-content/60 mt-0.5 line-clamp-3'>
                            {source.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <ActionBarPrimitive.Reload className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
                <RefreshCwIcon className='size-3' />
              </ActionBarPrimitive.Reload>
              <ActionBarPrimitive.Copy className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
                <AssistantIf condition={({ message }) => message.isCopied}>
                  <CheckIcon className='size-3' />
                </AssistantIf>
                <AssistantIf condition={({ message }) => !message.isCopied}>
                  <CopyIcon className='size-3' />
                </AssistantIf>
              </ActionBarPrimitive.Copy>
            </ActionBarPrimitive.Root>
          </div>
        </AssistantIf>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      className='group/message animate-in fade-in slide-in-from-bottom-1 relative mx-auto mb-1 flex w-full flex-col pb-0.5 duration-200'
      data-message-role='user'
    >
      <div className='flex flex-col items-end'>
        <div className='border-base-content/10 bg-base-200 text-base-content relative max-w-[90%] rounded-2xl rounded-br-md border px-3 py-2'>
          <div className='prose prose-xs text-base-content [&_*]:!text-base-content select-text text-sm'>
            <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
          </div>
        </div>
        <div className='mt-0.5 flex h-6 items-center justify-end gap-0.5'>
          <ActionBarPrimitive.Root className='flex items-center gap-0.5'>
            <ActionBarPrimitive.Edit className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
              <PencilIcon className='size-3' />
            </ActionBarPrimitive.Edit>
            <ActionBarPrimitive.Copy className='text-base-content/40 hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'>
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
      <ComposerPrimitive.Root className='border-base-content/10 bg-base-200 ml-auto flex w-full max-w-[90%] flex-col overflow-hidden rounded-2xl border'>
        <ComposerPrimitive.Input className='text-base-content min-h-10 w-full resize-none bg-transparent p-3 text-sm outline-none' />
        <div className='mx-2 mb-2 flex items-center gap-1.5 self-end'>
          <ComposerPrimitive.Cancel asChild>
            <Button variant='ghost' size='sm' className='h-7 px-2 text-xs'>
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size='sm' className='h-7 px-2 text-xs'>
              Update
            </Button>
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
      className={cn('text-base-content/40 mr-0.5 inline-flex items-center text-[10px]', className)}
    >
      <BranchPickerPrimitive.Previous asChild>
        <button
          type='button'
          className='hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'
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
          className='hover:bg-base-200 hover:text-base-content flex size-6 items-center justify-center rounded-full transition-colors'
        >
          <ChevronRightIcon className='size-3' />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
