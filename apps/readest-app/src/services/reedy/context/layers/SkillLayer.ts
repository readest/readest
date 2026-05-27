import type { PromptLayer } from './types';

export interface SkillInstructions {
  /** Stable id for the active skill, surfaced in the truncated[] report. */
  id: string;
  /** Free-form instructions appended to the system prompt. */
  instructions: string;
}

/**
 * The active skill's instructions, sandwiched between Policy and per-turn
 * context. Not expendable — if the user picked a skill they care about its
 * directives surviving budget pressure. Returns null when no skill is
 * active (default chat).
 */
export function createSkillLayer(skill: SkillInstructions | null): PromptLayer {
  return {
    name: skill ? `skill:${skill.id}` : 'skill:none',
    renderPriority: 10,
    shrinkPriority: 998,
    expendable: false,
    render() {
      if (!skill) return null;
      const trimmed = skill.instructions.trim();
      return trimmed.length > 0 ? `Active skill: ${skill.id}\n\n${trimmed}` : null;
    },
    shrink() {
      return this.render();
    },
  };
}
