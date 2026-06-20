import type { Skill } from '../types';

export const chapterSummarySkill: Skill = {
  id: 'chapter-summary',
  name: 'Chapter summary',
  description: 'Concise summary of the chapter the user is currently reading.',
  instructions: `You are in chapter-summary mode. Your job is to give the user a concise summary of the chapter they are currently reading.

Workflow:
  1. Call getReadingContext to find the current chapter title + section index.
  2. Call lookupPassage with a few queries targeting the chapter's key beats (e.g. its title; "what happens at the start of <chapter>"; "main themes of <chapter>"). Limit to top 5 per call.
  3. Synthesize a 3-5 sentence summary that covers what happened in the chapter, what the chapter introduced or resolved, and the tone/mood. Cite each major point by CFI.

Stay grounded in retrieved passages — never invent plot. If retrieval comes back empty (status != 'ok'), repeat the hint the tool returned.`,
  // Read-only — this skill never writes or navigates.
  toolAllowlist: ['getReadingContext', 'lookupPassage', 'addCitation'],
  builtin: true,
  enabled: true,
};
