import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '@/services/reedy/tools/ToolRegistry';
import type { ReedyTool, ToolContext } from '@/services/reedy/tools/types';
import type { ReedyToolError } from '@/services/reedy/runtime/errors';

function ctxFor(overrides: Partial<ToolContext> = {}): ToolContext {
  const controller = new AbortController();
  return {
    bookHash: 'bk1',
    sessionId: 's1',
    assistantMessageId: 'm1',
    signal: controller.signal,
    requestPermission: vi.fn(async () => true),
    ...overrides,
  };
}

function readTool(name = 'lookupPassage'): ReedyTool<{ q: string }, { hit: string }> {
  return {
    name,
    description: 'find passages',
    permission: 'read',
    parallelSafe: true,
    inputSchema: z.object({ q: z.string().min(1) }),
    async run(args) {
      return { hit: args.q };
    },
  };
}

describe('ToolRegistry', () => {
  let reg: ToolRegistry;

  beforeEach(() => {
    reg = new ToolRegistry();
  });

  describe('basic CRUD', () => {
    it('register + get + list round-trip', () => {
      const t = readTool();
      reg.register(t);
      expect(reg.get('lookupPassage')).toBe(t);
      expect(reg.list()).toHaveLength(1);
    });

    it('throws when registering the same name twice', () => {
      reg.register(readTool());
      expect(() => reg.register(readTool())).toThrow(/already registered/);
    });

    it('unregister returns whether the name existed', () => {
      reg.register(readTool());
      expect(reg.unregister('lookupPassage')).toBe(true);
      expect(reg.unregister('lookupPassage')).toBe(false);
    });
  });

  describe('Zod validation', () => {
    it('throws ReedyToolError with kind=tool_invalid_args on malformed args', async () => {
      reg.register(readTool());
      let caught: ReedyToolError | undefined;
      try {
        await reg.invoke('lookupPassage', { q: '' }, ctxFor());
      } catch (err) {
        caught = err as ReedyToolError;
      }
      expect(caught).toBeDefined();
      expect(caught!.kind).toBe('tool_invalid_args');
      expect(caught!.toolName).toBe('lookupPassage');
    });
  });

  describe('permission gate', () => {
    it('read-only tools skip the permission prompt', async () => {
      reg.register(readTool());
      const reqPerm = vi.fn(async () => true);
      const ctx = ctxFor({ requestPermission: reqPerm });
      await reg.invoke('lookupPassage', { q: 'hi' }, ctx);
      expect(reqPerm).not.toHaveBeenCalled();
    });

    it('navigate / write tools prompt for permission and throw on denial', async () => {
      const navTool: ReedyTool<{ cfi: string }, void> = {
        name: 'navigateToCfi',
        description: 'go to CFI',
        permission: 'navigate',
        parallelSafe: false,
        inputSchema: z.object({ cfi: z.string() }),
        async run() {},
      };
      reg.register(navTool);
      const ctx = ctxFor({ requestPermission: vi.fn(async () => false) });

      await expect(reg.invoke('navigateToCfi', { cfi: 'x' }, ctx)).rejects.toMatchObject({
        kind: 'tool_permission_denied',
      });
    });
  });

  describe('per-call timeout', () => {
    it('throws ReedyToolError with kind=tool_timeout when the tool exceeds timeoutMs', async () => {
      const slow: ReedyTool<{ q: string }, string> = {
        name: 'slow',
        description: 'slow',
        permission: 'read',
        parallelSafe: true,
        timeoutMs: 20,
        inputSchema: z.object({ q: z.string() }),
        async run(_args, ctx) {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 100);
            ctx.signal.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new Error('aborted'));
            });
          });
          return 'done';
        },
      };
      reg.register(slow);
      await expect(reg.invoke('slow', { q: 'x' }, ctxFor())).rejects.toMatchObject({
        kind: 'tool_timeout',
      });
    });
  });

  describe('abort propagation', () => {
    it('throws ReedyToolError with kind=tool_aborted when the turn signal fires', async () => {
      const controller = new AbortController();
      const t: ReedyTool<{ q: string }, string> = {
        name: 'wait',
        description: 'wait',
        permission: 'read',
        parallelSafe: true,
        inputSchema: z.object({ q: z.string() }),
        async run(_args, ctx) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 100);
            ctx.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(new Error('aborted'));
            });
          });
          return 'ok';
        },
      };
      reg.register(t);
      const pending = reg.invoke('wait', { q: 'x' }, ctxFor({ signal: controller.signal }));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ kind: 'tool_aborted' });
    });
  });

  describe('parallel serialization', () => {
    it('parallelSafe=false serializes overlapping invocations of the same tool', async () => {
      let active = 0;
      let maxActive = 0;
      const t: ReedyTool<{ q: string }, void> = {
        name: 'serial',
        description: 'serial',
        permission: 'read',
        parallelSafe: false,
        inputSchema: z.object({ q: z.string() }),
        async run() {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
        },
      };
      reg.register(t);
      const ctx = ctxFor();
      await Promise.all([
        reg.invoke('serial', { q: 'a' }, ctx),
        reg.invoke('serial', { q: 'b' }, ctx),
        reg.invoke('serial', { q: 'c' }, ctx),
      ]);
      expect(maxActive).toBe(1);
    });

    it('parallelSafe=true allows overlapping invocations of the same tool', async () => {
      let active = 0;
      let maxActive = 0;
      const t: ReedyTool<{ q: string }, void> = {
        name: 'par',
        description: 'par',
        permission: 'read',
        parallelSafe: true,
        inputSchema: z.object({ q: z.string() }),
        async run() {
          active++;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 10));
          active--;
        },
      };
      reg.register(t);
      const ctx = ctxFor();
      await Promise.all([
        reg.invoke('par', { q: 'a' }, ctx),
        reg.invoke('par', { q: 'b' }, ctx),
        reg.invoke('par', { q: 'c' }, ctx),
      ]);
      expect(maxActive).toBeGreaterThan(1);
    });
  });

  describe('toVercelToolSet', () => {
    it('returns a Vercel ToolSet shape with one entry per registered tool', () => {
      reg.register(readTool('a'));
      reg.register(readTool('b'));
      const set = reg.toVercelToolSet(ctxFor()) as Record<string, { execute?: unknown }>;
      expect(Object.keys(set).sort()).toEqual(['a', 'b']);
      expect(typeof set['a']!.execute).toBe('function');
    });
  });

  describe('unknown / runtime errors', () => {
    it('invoking an unregistered name throws tool_unknown', async () => {
      await expect(reg.invoke('missing', {}, ctxFor())).rejects.toMatchObject({
        kind: 'tool_unknown',
      });
    });

    it('a thrown tool error is wrapped as tool_runtime_error with cause preserved', async () => {
      const root = new Error('explode');
      const t: ReedyTool<{ q: string }, void> = {
        name: 'boom',
        description: 'boom',
        permission: 'read',
        parallelSafe: true,
        inputSchema: z.object({ q: z.string() }),
        async run() {
          throw root;
        },
      };
      reg.register(t);
      let caught: ReedyToolError | undefined;
      try {
        await reg.invoke('boom', { q: 'x' }, ctxFor());
      } catch (err) {
        caught = err as ReedyToolError;
      }
      expect(caught!.kind).toBe('tool_runtime_error');
      expect(caught!.cause).toBe(root);
    });
  });
});
