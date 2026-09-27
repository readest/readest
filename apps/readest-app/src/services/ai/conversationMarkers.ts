import type { AIConversation } from './types';
import type { FoliateView } from '@/types/view';

export const AI_CONVERSATION_PREFIX = 'foliate-ai-conversation:';

export interface ConversationMarker {
  id: string;
  value: string;
  cfi: string;
  conversationId: string;
}

interface ConversationMarkerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ConversationMarkerOptions {
  color?: string;
  radius?: number;
  offset?: number;
}

export const drawConversationDot = (
  rects: ConversationMarkerRect[],
  options: ConversationMarkerOptions = {},
): SVGGElement => {
  const { color = '#2563eb', radius = 7, offset = 12 } = options;
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const firstRect = rects[0];
  if (!firstRect) return group;

  const centerX = Math.max(radius + 2, firstRect.left - offset);
  const centerY = firstRect.top + firstRect.height / 2;
  const hitPadding = 8;
  rects.splice(0, rects.length, {
    left: centerX - radius - hitPadding,
    top: centerY - radius - hitPadding,
    right: centerX + radius + hitPadding,
    bottom: centerY + radius + hitPadding,
    width: (radius + hitPadding) * 2,
    height: (radius + hitPadding) * 2,
  });

  const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  halo.setAttribute('cx', String(centerX));
  halo.setAttribute('cy', String(centerY));
  halo.setAttribute('r', String(radius + 4));
  halo.setAttribute('fill', 'white');
  halo.setAttribute('opacity', '.9');

  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', String(centerX));
  dot.setAttribute('cy', String(centerY));
  dot.setAttribute('r', String(radius));
  dot.setAttribute('fill', color);
  dot.setAttribute('stroke', 'white');
  dot.setAttribute('stroke-width', '2');
  group.append(halo, dot);
  return group;
};

const markerValue = (conversationId: string) =>
  `${AI_CONVERSATION_PREFIX}${encodeURIComponent(conversationId)}`;

export const conversationIdFromMarkerValue = (value?: string): string | null => {
  if (!value?.startsWith(AI_CONVERSATION_PREFIX)) return null;
  try {
    return decodeURIComponent(value.slice(AI_CONVERSATION_PREFIX.length));
  } catch {
    return null;
  }
};

export const toConversationMarker = (conversation: AIConversation): ConversationMarker | null => {
  if (!conversation.anchor?.cfi) return null;
  return {
    id: conversation.id,
    value: markerValue(conversation.id),
    cfi: conversation.anchor.cfi,
    conversationId: conversation.id,
  };
};

export const getConversationMarkersForSection = (
  conversations: AIConversation[],
  sectionIndex: number,
): ConversationMarker[] => {
  const seen = new Set<string>();
  const markers: ConversationMarker[] = [];
  for (const conversation of conversations) {
    if (seen.has(conversation.id) || conversation.anchor?.index !== sectionIndex) continue;
    const marker = toConversationMarker(conversation);
    if (!marker) continue;
    seen.add(conversation.id);
    markers.push(marker);
  }
  return markers;
};

export const addConversationMarker = async (
  view: FoliateView | null,
  marker: ConversationMarker,
  remove = false,
): Promise<void> => {
  if (!view) return;
  const { index, anchor } = await view.resolveNavigation(marker.cfi);
  const content = view.renderer
    .getContents()
    .find((item) => item.index === index && item.overlayer);
  if (!content?.overlayer) return;
  if (remove) {
    content.overlayer.remove(marker.value);
    return;
  }
  if (!anchor) return;
  const range = anchor(content.doc);
  if (range) {
    content.overlayer.add(marker.value, range, drawConversationDot, { color: '#2563eb' });
  }
};

export const syncConversationMarkers = (
  view: FoliateView | null,
  previous: Map<string, ConversationMarker>,
  conversations: AIConversation[],
  bookHash: string,
): Map<string, ConversationMarker> => {
  const next = new Map<string, ConversationMarker>();
  for (const conversation of conversations) {
    if (conversation.bookHash !== bookHash) continue;
    const marker = toConversationMarker(conversation);
    if (marker) next.set(conversation.id, marker);
  }
  for (const [id, marker] of previous) {
    const replacement = next.get(id);
    if (!replacement || replacement.value !== marker.value || replacement.cfi !== marker.cfi) {
      void addConversationMarker(view, marker, true);
    }
  }
  for (const [id, marker] of next) {
    const current = previous.get(id);
    if (!current || current.value !== marker.value || current.cfi !== marker.cfi) {
      void addConversationMarker(view, marker);
    }
  }
  return next;
};
