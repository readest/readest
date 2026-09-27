import { describe, expect, test, vi } from 'vitest';
import type { AIConversation } from '@/services/ai/types';
import {
  addConversationMarker,
  conversationIdFromMarkerValue,
  drawConversationDot,
  getConversationMarkersForSection,
  syncConversationMarkers,
  toConversationMarker,
} from '@/services/ai/conversationMarkers';

const anchoredConversation = (id: string, cfi: string, index = 1): AIConversation => ({
  id,
  bookHash: 'book-hash',
  title: `Conversation ${id}`,
  anchor: {
    id: `${id}:anchor`,
    bookKey: 'book-hash-0',
    text: 'A selection that spans multiple rendered lines',
    page: 2,
    index,
    cfi,
  },
  createdAt: 100,
  updatedAt: 100,
});

describe('AI conversation markers', () => {
  test('creates one uniquely keyed marker per anchored conversation', () => {
    const first = toConversationMarker(
      anchoredConversation('conversation:/one', 'epubcfi(/6/4!/4/2:0,/1:0,/1:40)'),
    );
    const second = toConversationMarker(
      anchoredConversation('conversation-two', 'epubcfi(/6/4!/4/4:0,/1:0,/1:12)'),
    );

    expect(first?.value).not.toBe(second?.value);
    expect(conversationIdFromMarkerValue(first?.value)).toBe('conversation:/one');
    expect(conversationIdFromMarkerValue(second?.value)).toBe('conversation-two');
  });

  test('returns each thread once and skips unanchored conversations', () => {
    const conversation = anchoredConversation(
      'conversation-one',
      'epubcfi(/6/4!/4/2:0,/1:0,/5:12)',
    );
    const unanchored: AIConversation = {
      id: 'unanchored',
      bookHash: 'book-hash',
      title: 'Unanchored',
      createdAt: 100,
      updatedAt: 100,
    };

    const markers = getConversationMarkersForSection([conversation, conversation, unanchored], 1);

    expect(markers).toHaveLength(1);
    expect(markers[0]?.id).toBe('conversation-one');
  });

  test('adds and removes only changed markers', async () => {
    const overlayer = { add: vi.fn(), remove: vi.fn() };
    const range = document.createRange();
    const anchor = vi.fn(() => range);
    const view = {
      resolveNavigation: vi.fn(() => ({ index: 1, anchor })),
      renderer: {
        getContents: vi.fn(() => [{ index: 1, doc: document, overlayer }]),
      },
    };
    const conversation = anchoredConversation('one', 'epubcfi(/6/4!/4/2:0)');

    const first = syncConversationMarkers(view as never, new Map(), [conversation], 'book-hash');
    await vi.waitFor(() => expect(overlayer.add).toHaveBeenCalledTimes(1));
    expect(view.resolveNavigation).toHaveBeenCalledWith('epubcfi(/6/4!/4/2:0)');

    view.resolveNavigation.mockClear();
    const stable = syncConversationMarkers(view as never, first, [conversation], 'book-hash');
    expect(view.resolveNavigation).not.toHaveBeenCalled();

    syncConversationMarkers(view as never, stable, [], 'book-hash');
    await vi.waitFor(() =>
      expect(overlayer.remove).toHaveBeenCalledWith('foliate-ai-conversation:one'),
    );
  });

  test('draws one accessible hit target at the first rendered line', () => {
    const rects = [
      { left: 80, top: 30, right: 180, bottom: 50, width: 100, height: 20 },
      { left: 80, top: 55, right: 160, bottom: 75, width: 80, height: 20 },
    ];

    const group = drawConversationDot(rects, { color: '#2563eb' });

    expect(group.querySelectorAll('circle')).toHaveLength(2);
    expect(group.querySelector('circle:last-child')?.getAttribute('fill')).toBe('#2563eb');
    expect(rects).toHaveLength(1);
    expect(rects[0]).toMatchObject({ left: 53, top: 25, width: 30, height: 30 });
  });

  test('adds a marker directly to the resolved section overlayer', async () => {
    const overlayer = { add: vi.fn(), remove: vi.fn() };
    const range = document.createRange();
    const anchor = vi.fn(() => range);
    const view = {
      resolveNavigation: vi.fn(() => ({ index: 2, anchor })),
      renderer: {
        getContents: vi.fn(() => [{ index: 2, doc: document, overlayer }]),
      },
    };
    const marker = toConversationMarker(
      anchoredConversation('source-thread', 'epubcfi(/6/6!/4/2:0)', 2),
    )!;

    await addConversationMarker(view as never, marker);

    expect(anchor).toHaveBeenCalledWith(document);
    expect(overlayer.add).toHaveBeenCalledWith(marker.value, range, drawConversationDot, {
      color: '#2563eb',
    });
  });
});
