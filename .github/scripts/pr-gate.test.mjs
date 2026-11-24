// Run with: node --test .github/scripts/pr-gate.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findProblems, hasAttribution } from './pr-gate.mjs';

const outside = { author_association: 'CONTRIBUTOR', user: { type: 'User' }, commits: 1 };
const commit = (sha, message, parents = 1) => ({
  sha,
  commit: { message },
  parents: Array.from({ length: parents }, () => ({})),
});
const attributed = 'fix: x\n\nCo-Authored-By: Claude Code (Claude Opus 5.5) <noreply@anthropic.com>';

test('accepts a line naming both the agent and the model', () => {
  assert.ok(hasAttribution(attributed));
  assert.ok(hasAttribution('fix\n\nco-authored-by: Codex (gpt-5) <codex@example.com>\n'));
});

test('rejects a line naming only one of them, or no line', () => {
  assert.ok(!hasAttribution('fix\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'));
  assert.ok(!hasAttribution('fix\n\nCo-Authored-By: Claude Code () <noreply@anthropic.com>'));
  assert.ok(!hasAttribution('fix\n\nCo-Authored-By: (Claude Opus 5.5) <noreply@anthropic.com>'));
  assert.ok(!hasAttribution('fix: Co-Authored-By: Claude Code (Opus) <a@b.c> in the subject'));
  assert.ok(!hasAttribution('fix: a plain commit'));
});

test('an outside PR with a linked issue and attributed commits passes', () => {
  const problems = findProblems(outside, [commit('a'.repeat(40), attributed)], 1);
  assert.deepEqual(problems, { missingIssue: false, unattributed: [], truncated: false });
});

test('an outside PR without a linked issue fails', () => {
  assert.equal(findProblems(outside, [commit('a'.repeat(40), attributed)], 0).missingIssue, true);
});

test('lists every unattributed commit and skips merge commits', () => {
  const problems = findProblems(
    outside,
    [
      commit('1111111aaaa', 'feat: no line'),
      commit('2222222bbbb', "Merge branch 'main'", 2),
      commit('3333333cccc', attributed),
      commit('4444444dddd', 'fix: no line either'),
    ],
    1,
  );
  assert.equal(problems.truncated, false);
  assert.deepEqual(problems.unattributed, ['1111111', '4444444']);
});

test('fails when the API returned fewer commits than the PR has (250 cap)', () => {
  const problems = findProblems({ ...outside, commits: 251 }, [commit('a'.repeat(40), attributed)], 1);
  assert.equal(problems.truncated, true);
});

test('owners, members, collaborators and bots are exempt', () => {
  const bare = [commit('1111111aaaa', 'feat: no line')];
  for (const author_association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.equal(findProblems({ author_association, user: { type: 'User' } }, bare, 0), null);
  }
  assert.equal(findProblems({ author_association: 'NONE', user: { type: 'Bot' } }, bare, 0), null);
});
