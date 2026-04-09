import { execSync, type StdioOptions } from 'node:child_process';
import path from 'node:path';

const SKIPPED_SUBMODULES = ['apps/readest-app/.claude/skills/gstack', 'packages/simplecc-wasm'];

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: pnpm worktree:rm <branch-name|pr-number>');
  process.exit(1);
}

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const gitStdio: StdioOptions = ['inherit', process.stderr, process.stderr];

// Resolve worktree path from the argument
let dirName: string;
if (/^\d+$/.test(arg)) {
  dirName = `readest-pr-${arg}`;
} else {
  dirName = `readest-${arg.replace(/\//g, '-')}`;
}
const worktreePath = path.join(path.dirname(repoRoot), dirName);

// Check the worktree exists
const worktrees = execSync('git worktree list --porcelain', { encoding: 'utf8', cwd: repoRoot });
const found = worktrees.split('\n').some((line) => line === `worktree ${worktreePath}`);
if (!found) {
  console.error(`error: no worktree found at ${worktreePath}`);
  process.exit(1);
}

console.error(`Removing worktree: ${worktreePath}`);

// Deinit only submodules we manage — skipped ones were never initialized
const initedSubs = execSync('git config --file .gitmodules --get-regexp "submodule\\..*\\.path"', {
  encoding: 'utf8',
  cwd: worktreePath,
})
  .trim()
  .split('\n')
  .map((line) => line.split(/\s+/)[1]!)
  .filter((p) => !SKIPPED_SUBMODULES.includes(p));
for (const sub of initedSubs) {
  execSync(`git -C "${worktreePath}" submodule deinit --force -- "${sub}"`, {
    stdio: gitStdio,
    cwd: repoRoot,
  });
}
execSync(`git worktree remove --force "${worktreePath}"`, { stdio: gitStdio, cwd: repoRoot });

console.error('Done.');
