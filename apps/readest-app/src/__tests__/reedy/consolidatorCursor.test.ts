import { describe, it, expect } from 'vitest';
import { sliceSinceLastId } from '@/services/reedy/memory/consolidatorCursor';
import type { ReedyMessage } from '@/services/reedy/store/reedyStore';

function user(id: string, text: string, ts = 0): ReedyMessage {
  return { id, role: 'user', text, createdAt: ts };
}

function assistant(id: string, parts: Array<{ type: 'text'; text: string }>, ts = 0): ReedyMessage {
  return {
    id,
    role: 'assistant',
    parts,
    createdAt: ts,
  };
}

describe('sliceSinceLastId', () => {
  const log: ReedyMessage[] = [
    user('u1', 'hi'),
    assistant('a1', [{ type: 'text', text: 'hello' }]),
    user('u2', 'tell me more'),
    assistant('a2', [
      { type: 'text', text: 'sure, ' },
      { type: 'text', text: 'here we go' },
    ]),
  ];

  it('returns the full log when afterId is null (no prior consolidation)', () => {
    const out = sliceSinceLastId(log, null);
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('returns only messages strictly after afterId', () => {
    const out = sliceSinceLastId(log, 'a1');
    expect(out.map((m) => m.id)).toEqual(['u2', 'a2']);
  });

  it('returns [] when afterId is the last message', () => {
    const out = sliceSinceLastId(log, 'a2');
    expect(out).toEqual([]);
  });

  it('falls back to the full log when afterId is not in the messages (lost cursor)', () => {
    const out = sliceSinceLastId(log, 'cursor-from-deleted-session');
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('flattens assistant text parts into one content string per message', () => {
    const out = sliceSinceLastId(log, 'u2');
    expect(out[0]).toMatchObject({ id: 'a2', role: 'assistant', content: 'sure, here we go' });
  });

  it('passes user text through unchanged', () => {
    const out = sliceSinceLastId(log, null);
    const u = out.find((m) => m.id === 'u1')!;
    expect(u).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('emits an empty string for assistant messages that only carry non-text parts', () => {
    const onlyTool: ReedyMessage = {
      id: 'a-tool',
      role: 'assistant',
      parts: [
        {
          type: 'tool_call',
          id: 'tc1',
          name: 'find',
          args: {},
          permission: 'read',
          state: 'pending',
        },
      ],
      createdAt: 0,
    };
    const out = sliceSinceLastId([onlyTool], null);
    expect(out[0]).toMatchObject({ id: 'a-tool', role: 'assistant', content: '' });
  });
});
