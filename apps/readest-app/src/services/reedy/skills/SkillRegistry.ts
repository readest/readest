import type { DatabaseService } from '@/types/database';
import type { SkillInstructions } from '../context/layers/SkillLayer';
import { BUILTIN_SKILLS } from './builtins';
import type { Skill, UpsertSkillArgs } from './types';

/**
 * DB-backed skill catalog (Phase 5.1).
 *
 * On first init() call the registry seeds the three built-in skills
 * (spoiler-free, chapter-summary, quote-finder) so a fresh reedy.db
 * always has them. Re-seeding is idempotent: builtin rows that already
 * exist are left alone (so user-edited instructions survive across
 * upgrades). User-defined skills (post-MVP) live in the same table with
 * builtin=0; the seeding pass only touches builtin=1 rows.
 *
 * The registry doesn't enforce the toolAllowlist itself — that's the
 * runtime's job when constructing the per-turn ToolSet (Phase 2.6 +
 * Phase 5 follow-up). This file just stores and retrieves.
 */
export class SkillRegistry {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Seed the built-in skills if they aren't present yet. Safe to call on
   * every app boot. Returns the count of newly inserted rows.
   */
  async init(): Promise<number> {
    let inserted = 0;
    for (const skill of BUILTIN_SKILLS) {
      const existing = await this.getById(skill.id);
      if (existing) continue;
      await this.insert(skill);
      inserted++;
    }
    return inserted;
  }

  async list(): Promise<Skill[]> {
    const rows = await this.db.select<SkillRowSql>(
      'SELECT * FROM reedy_skills ORDER BY builtin DESC, name ASC',
    );
    return rows.map(toSkill);
  }

  async listEnabled(): Promise<Skill[]> {
    const rows = await this.db.select<SkillRowSql>(
      'SELECT * FROM reedy_skills WHERE enabled = 1 ORDER BY builtin DESC, name ASC',
    );
    return rows.map(toSkill);
  }

  async getById(id: string): Promise<Skill | null> {
    const rows = await this.db.select<SkillRowSql>('SELECT * FROM reedy_skills WHERE id = ?', [id]);
    return rows[0] ? toSkill(rows[0]) : null;
  }

  /**
   * Upsert a skill. Built-in skills always overwrite; user skills replace
   * the prior row when the id matches.
   */
  async upsert(args: UpsertSkillArgs): Promise<Skill> {
    await this.db.execute(
      `INSERT INTO reedy_skills (id, name, description, instructions, tool_allowlist, builtin, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         instructions = excluded.instructions,
         tool_allowlist = excluded.tool_allowlist,
         builtin = excluded.builtin,
         enabled = excluded.enabled`,
      [
        args.id,
        args.name,
        args.description,
        args.instructions,
        args.toolAllowlist ? JSON.stringify(args.toolAllowlist) : null,
        args.builtin === false ? 0 : 1,
        args.enabled === false ? 0 : 1,
      ],
    );
    const row = await this.getById(args.id);
    if (!row) throw new Error(`SkillRegistry: row vanished after upsert id=${args.id}`);
    return row;
  }

  /** Toggle the `enabled` flag without touching anything else. */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const exists = await this.getById(id);
    if (!exists) return false;
    await this.db.execute('UPDATE reedy_skills SET enabled = ? WHERE id = ?', [
      enabled ? 1 : 0,
      id,
    ]);
    return true;
  }

  /**
   * Delete a skill. Built-in skills can be deleted too — `init()` will
   * re-seed them on next boot. Returns true if a row was removed.
   */
  async delete(id: string): Promise<boolean> {
    const exists = await this.getById(id);
    if (!exists) return false;
    await this.db.execute('DELETE FROM reedy_skills WHERE id = ?', [id]);
    return true;
  }

  /**
   * Resolve the active skill into the shape the Phase 2.5 SkillLayer
   * consumes. Returns null when the skill id is unknown, disabled, or
   * null/undefined — callers can then pass `null` to createSkillLayer.
   */
  async resolveActiveSkill(id: string | null | undefined): Promise<SkillInstructions | null> {
    if (!id) return null;
    const skill = await this.getById(id);
    if (!skill || !skill.enabled) return null;
    return { id: skill.id, instructions: skill.instructions };
  }

  private async insert(skill: Skill): Promise<void> {
    await this.db.execute(
      `INSERT INTO reedy_skills (id, name, description, instructions, tool_allowlist, builtin, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        skill.id,
        skill.name,
        skill.description,
        skill.instructions,
        skill.toolAllowlist ? JSON.stringify(skill.toolAllowlist) : null,
        skill.builtin ? 1 : 0,
        skill.enabled ? 1 : 0,
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface SkillRowSql {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tool_allowlist: string | null;
  builtin: number;
  enabled: number;
  [key: string]: unknown;
}

function toSkill(row: SkillRowSql): Skill {
  let allowlist: string[] | null = null;
  if (row.tool_allowlist) {
    try {
      const parsed = JSON.parse(row.tool_allowlist);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        allowlist = parsed;
      }
    } catch {
      // Corrupted JSON — fall back to null (no allowlist).
      allowlist = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    toolAllowlist: allowlist,
    builtin: row.builtin === 1,
    enabled: row.enabled === 1,
  };
}
