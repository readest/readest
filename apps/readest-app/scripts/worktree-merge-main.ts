import { execSync, type StdioOptions } from 'node:child_process';

/**
 * Merge origin/main into the PR checkout at `cwd`, keeping the PR's commits
 * as pushed so `git push` to the fork stays a fast-forward. Returns false,
 * with the checkout back on the PR head, when the PR conflicts with main.
 */
export const mergeMainIntoPr = (cwd: string, stdio: StdioOptions = 'pipe'): boolean => {
  try {
    // --ff overrides a merge.ff=only setting, which would refuse the merge commit.
    execSync('git merge --no-edit --ff origin/main', { stdio, cwd });
    return true;
  } catch {
    execSync('git merge --abort', { stdio, cwd });
    return false;
  }
};
