// @vitest-environment node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mergeMainIntoPr } from '../../../scripts/worktree-merge-main';

// `pnpm worktree:new <PR#>` merges origin/main into the PR head (#7565). A
// rebase rewrote the contributor's commits, so a push needed --force and local
// checks never saw a conflict with main.

// A git hook (pre-push runs this suite) exports GIT_DIR and friends. Left in
// place they point every command below at the real repository, not the temp
// one: a run once reset the checkout's config and branches.
const hookEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const key of Object.keys(process.env).filter((name) => name.startsWith('GIT_'))) {
    hookEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterAll(() => Object.assign(process.env, hookEnv));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: string) =>
  execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim();

/** A repo on a PR head that diverged from origin/main; returns both commits. */
const divergedRepo = (prLine: string, mainLine: string) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-merge-'));
  dirs.push(cwd);
  git(cwd, 'init -q -b main');
  // Every command below must act on this repository and nothing else.
  expect(git(cwd, 'rev-parse --absolute-git-dir')).toBe(path.join(fs.realpathSync(cwd), '.git'));
  git(cwd, 'config user.email test@example.com');
  git(cwd, 'config user.name Test');
  git(cwd, 'config commit.gpgsign false');
  const commit = (file: string, text: string) => {
    fs.writeFileSync(path.join(cwd, file), text);
    git(cwd, `add ${file}`);
    git(cwd, `commit -q -m "${file}: ${text}"`);
    return git(cwd, 'rev-parse HEAD');
  };
  commit('shared.txt', 'base\n');
  git(cwd, 'checkout -q -b pr');
  const prHead = commit(prLine.split(':')[0]!, `${prLine.split(':')[1]}\n`);
  git(cwd, 'checkout -q main');
  const main = commit(mainLine.split(':')[0]!, `${mainLine.split(':')[1]}\n`);
  git(cwd, `update-ref refs/remotes/origin/main ${main}`);
  git(cwd, 'checkout -q pr');
  return { cwd, prHead, main };
};

const isAncestor = (cwd: string, commit: string) => {
  try {
    git(cwd, `merge-base --is-ancestor ${commit} HEAD`);
    return true;
  } catch {
    return false;
  }
};

describe('mergeMainIntoPr', () => {
  it('keeps the PR commits and adds main, so a push is a fast-forward', () => {
    const { cwd, prHead, main } = divergedRepo('pr.txt:feature', 'main.txt:upstream');
    expect(mergeMainIntoPr(cwd)).toBe(true);
    expect(isAncestor(cwd, prHead)).toBe(true);
    expect(isAncestor(cwd, main)).toBe(true);
  });

  it('merges a diverged PR when merge.ff is set to only', () => {
    const { cwd, prHead, main } = divergedRepo('pr.txt:feature', 'main.txt:upstream');
    git(cwd, 'config merge.ff only');
    expect(mergeMainIntoPr(cwd)).toBe(true);
    expect(isAncestor(cwd, prHead)).toBe(true);
    expect(isAncestor(cwd, main)).toBe(true);
  });

  it('leaves a conflicting PR on its own head with no merge in progress', () => {
    const { cwd, prHead } = divergedRepo('shared.txt:from the PR', 'shared.txt:from main');
    expect(mergeMainIntoPr(cwd)).toBe(false);
    expect(git(cwd, 'rev-parse HEAD')).toBe(prHead);
    expect(fs.existsSync(path.join(cwd, '.git', 'MERGE_HEAD'))).toBe(false);
    expect(git(cwd, 'status --porcelain')).toBe('');
  });
});
