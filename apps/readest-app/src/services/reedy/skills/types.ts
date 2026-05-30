/**
 * A skill is a persisted bundle of instructions + optional tool allowlist
 * the user picks from the Composer chip row. The active skill's
 * instructions are pushed through the Phase 2.5 SkillLayer; the
 * allowlist (if any) filters the per-turn ToolSet so the model only
 * sees the relevant subset.
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  /**
   * When non-null, the runtime restricts the ToolSet to these tool names.
   * `null` means every registered tool is available.
   */
  toolAllowlist: string[] | null;
  /** Seeded by SkillRegistry on first boot; user-defined skills set false. */
  builtin: boolean;
  enabled: boolean;
}

export interface UpsertSkillArgs {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolAllowlist?: string[] | null;
  builtin?: boolean;
  enabled?: boolean;
}
