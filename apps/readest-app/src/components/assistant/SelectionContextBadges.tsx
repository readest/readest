import type { AISelectionPayload } from '@/services/ai/types';

export function SelectionContextBadges({ selection }: { selection?: AISelectionPayload }) {
  if (!selection) return null;
  const contexts = [
    ...(selection.questionAnchor ? [{ context: selection.questionAnchor, label: '问题目标' }] : []),
    ...selection.attachments
      .filter((context) => context.id !== selection.questionAnchor?.id)
      .map((context) => ({ context, label: '附件' })),
  ];
  if (contexts.length === 0) return null;

  return (
    <div
      className='mb-1 flex max-w-[90%] flex-wrap justify-end gap-1'
      data-testid='message-selection'
    >
      {contexts.map(({ context, label }) => (
        <div
          key={`${label}:${context.id}`}
          className='eink-bordered border-base-content/10 bg-base-100 flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-xs'
          title={context.text}
        >
          <span className='text-base-content/60 shrink-0'>{label}</span>
          <span className='max-w-40 truncate'>{context.text}</span>
        </div>
      ))}
    </div>
  );
}
