import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { DatabaseService } from '@/types/database';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import { SkillRegistry } from '@/services/reedy/skills/SkillRegistry';
import { BUILTIN_SKILLS } from '@/services/reedy/skills/builtins';

describe('SkillRegistry', () => {
  let svc: DatabaseService;
  let registry: SkillRegistry;

  beforeEach(async () => {
    svc = await NodeDatabaseService.open(':memory:', { experimental: ['index_method'] });
    await migrate(svc, getMigrations('reedy'));
    registry = new SkillRegistry(svc);
  });

  afterEach(async () => {
    await svc.close();
  });

  describe('migration', () => {
    it('creates reedy_skills table', async () => {
      const tables = await svc.select(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='reedy_skills'",
      );
      expect(tables).toHaveLength(1);
    });
  });

  describe('init()', () => {
    it('seeds every built-in skill on first boot and reports the inserted count', async () => {
      const inserted = await registry.init();
      expect(inserted).toBe(BUILTIN_SKILLS.length);
      const ids = (await registry.list()).map((s) => s.id);
      for (const builtin of BUILTIN_SKILLS) {
        expect(ids).toContain(builtin.id);
      }
    });

    it('is idempotent — re-running init() on a populated DB inserts nothing', async () => {
      await registry.init();
      const inserted = await registry.init();
      expect(inserted).toBe(0);
      const skills = await registry.list();
      expect(skills.length).toBe(BUILTIN_SKILLS.length);
    });

    it('leaves user-edited built-in instructions untouched on re-seed', async () => {
      await registry.init();
      await registry.upsert({
        id: 'spoiler-free',
        name: 'Spoiler-free (custom)',
        description: 'edited',
        instructions: 'EDITED INSTRUCTIONS',
        builtin: true,
        enabled: true,
      });
      await registry.init();
      const after = await registry.getById('spoiler-free');
      expect(after?.instructions).toBe('EDITED INSTRUCTIONS');
    });
  });

  describe('list / listEnabled / getById', () => {
    it('list returns built-in skills first, then alphabetical', async () => {
      await registry.init();
      const out = await registry.list();
      // Built-ins are ordered by name within their group (all built-in
      // for now): chapter-summary < quote-finder < spoiler-free
      expect(out.slice(0, BUILTIN_SKILLS.length).every((s) => s.builtin)).toBe(true);
      const names = out.slice(0, 3).map((s) => s.name);
      expect(names).toEqual([...names].sort());
    });

    it('listEnabled hides disabled skills', async () => {
      await registry.init();
      await registry.setEnabled('quote-finder', false);
      const out = await registry.listEnabled();
      expect(out.map((s) => s.id)).not.toContain('quote-finder');
      const all = await registry.list();
      expect(all.map((s) => s.id)).toContain('quote-finder');
    });

    it('getById returns null for unknown ids', async () => {
      expect(await registry.getById('missing')).toBeNull();
    });
  });

  describe('upsert / setEnabled / delete', () => {
    it('upsert creates a user skill with builtin=false by default', async () => {
      const out = await registry.upsert({
        id: 'my-skill',
        name: 'My Skill',
        description: 'whatever',
        instructions: 'do whatever',
        builtin: false,
      });
      expect(out.builtin).toBe(false);
      expect(out.enabled).toBe(true);
    });

    it('upsert round-trips toolAllowlist as a string array', async () => {
      await registry.upsert({
        id: 'restricted',
        name: 'Restricted',
        description: 'd',
        instructions: 'i',
        toolAllowlist: ['lookupPassage', 'getReadingContext'],
        builtin: false,
      });
      const got = await registry.getById('restricted');
      expect(got?.toolAllowlist).toEqual(['lookupPassage', 'getReadingContext']);
    });

    it('upsert replaces an existing row in place', async () => {
      await registry.init();
      await registry.upsert({
        id: 'spoiler-free',
        name: 'Replaced name',
        description: 'replaced',
        instructions: 'replaced instructions',
      });
      const after = await registry.getById('spoiler-free');
      expect(after?.name).toBe('Replaced name');
      expect(after?.instructions).toBe('replaced instructions');
    });

    it('setEnabled flips the enabled flag and reports whether the row existed', async () => {
      await registry.init();
      expect(await registry.setEnabled('chapter-summary', false)).toBe(true);
      expect((await registry.getById('chapter-summary'))?.enabled).toBe(false);
      expect(await registry.setEnabled('does-not-exist', true)).toBe(false);
    });

    it('delete removes the row and returns whether anything matched', async () => {
      await registry.init();
      expect(await registry.delete('spoiler-free')).toBe(true);
      expect(await registry.getById('spoiler-free')).toBeNull();
      expect(await registry.delete('spoiler-free')).toBe(false);
    });

    it('init() re-plants a built-in skill that was deleted', async () => {
      await registry.init();
      await registry.delete('spoiler-free');
      const inserted = await registry.init();
      expect(inserted).toBe(1);
      expect(await registry.getById('spoiler-free')).not.toBeNull();
    });
  });

  describe('resolveActiveSkill', () => {
    it('returns null for null/undefined ids', async () => {
      expect(await registry.resolveActiveSkill(null)).toBeNull();
      expect(await registry.resolveActiveSkill(undefined)).toBeNull();
    });

    it('returns null when the skill is disabled or unknown', async () => {
      await registry.init();
      await registry.setEnabled('quote-finder', false);
      expect(await registry.resolveActiveSkill('quote-finder')).toBeNull();
      expect(await registry.resolveActiveSkill('missing')).toBeNull();
    });

    it('returns { id, instructions } for active skills (shape SkillLayer wants)', async () => {
      await registry.init();
      const out = await registry.resolveActiveSkill('spoiler-free');
      expect(out?.id).toBe('spoiler-free');
      expect(typeof out?.instructions).toBe('string');
      expect(out!.instructions.length).toBeGreaterThan(0);
    });
  });

  describe('toolAllowlist corruption handling', () => {
    it('falls back to null when the stored JSON is malformed', async () => {
      // Bypass upsert to plant a row with bad JSON directly.
      await svc.execute(
        `INSERT INTO reedy_skills
           (id, name, description, instructions, tool_allowlist, builtin, enabled)
         VALUES (?, ?, ?, ?, ?, 0, 1)`,
        ['bad-json', 'Bad', 'd', 'i', '{not valid json'],
      );
      const got = await registry.getById('bad-json');
      expect(got?.toolAllowlist).toBeNull();
    });
  });
});
