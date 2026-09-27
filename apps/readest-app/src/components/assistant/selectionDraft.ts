import type { AISelectionPayload } from '@/services/ai/types';
import type { SelectionContext } from '@/store/notebookStore';

export const buildSelectionPayload = (
  questionAnchor: SelectionContext | null,
  attachments: SelectionContext[],
): AISelectionPayload => ({
  questionAnchor,
  attachments: attachments.filter((item) => item.id !== questionAnchor?.id),
});
