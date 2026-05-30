import { chapterSummarySkill } from './chapterSummary';
import { quoteFinderSkill } from './quoteFinder';
import { spoilerFreeSkill } from './spoilerFree';
import type { Skill } from '../types';

/** The three v1 seed skills SkillRegistry plants on first boot. */
export const BUILTIN_SKILLS: Skill[] = [spoilerFreeSkill, chapterSummarySkill, quoteFinderSkill];

export { spoilerFreeSkill, chapterSummarySkill, quoteFinderSkill };
