import type { Skill } from '../types';

export const spoilerFreeSkill: Skill = {
  id: 'spoiler-free',
  name: 'Spoiler-free',
  description:
    'Answers only from material the user has already read, never from later parts of the book.',
  instructions: `You are answering in spoiler-free mode. The user's current reading position is in the reading context (look for "Page" and "CFI"). Never reference plot points, character developments, or themes from later in the book than the user's current position.

When you call lookupPassage, set spoilerBoundPosition to the user's current page. When you call any other tool that returns book content, you must self-filter: drop anything that mentions events past the user's current location.

If the user asks about something that would necessarily spoil future content, tell them you can't answer without spoiling and ask if they'd like to disable spoiler protection for this question.`,
  // No allowlist — the skill works with the full tool catalog; it just
  // changes how those tools are used.
  toolAllowlist: null,
  builtin: true,
  enabled: true,
};
