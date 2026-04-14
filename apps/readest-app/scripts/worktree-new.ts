import { execSync, type StdioOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Submodules skipped during worktree setup (shared via symlinks or pre-built)
const SKIPPED_SUBMODULES = [
  'apps/readest-app/.claude/skills/gstack', // shared via .claude symlink
  'packages/simplecc-wasm', // built assets already in public/vendor
];

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: pnpm worktree:new <branch-name|pr-number>');
  process.exit(1);
}

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// Git output goes to stderr so stdout carries only the path (enables: cd $(pnpm worktree:new <arg>))
const gitStdio: StdioOptions = ['inherit', process.stderr, process.stderr];

// Fetch origin so origin/main is up to date
console.error('--- Fetching origin ---');
execSync('git fetch origin', { stdio: gitStdio, cwd: repoRoot });

let localBranch: string;
let worktreePath: string;

if (/^\d+$/.test(arg)) {
  // PR number -- fetch and set up remote tracking so `git push` works (even for forks)
  localBranch = `pr-${arg}`;
  worktreePath = path.join(path.dirname(repoRoot), `readest-${localBranch}`);

  // Get PR metadata to determine the source repo and branch
  const prJson = execSync(
    `gh pr view ${arg} --json headRefName,headRepositoryOwner,headRepository`,
    {
      encoding: 'utf8',
      cwd: repoRoot,
    },
  );
  const pr = JSON.parse(prJson) as {
    headRefName: string;
    headRepositoryOwner: { login: string };
    headRepository: { name: string };
  };
  const forkOwner = pr.headRepositoryOwner.login;
  const forkRepo = pr.headRepository.name;
  const remoteBranch = pr.headRefName;

  // Use "origin" if the PR is from the same repo, otherwise add the fork as a remote
  const originUrl = execSync('git remote get-url origin', {
    encoding: 'utf8',
    cwd: repoRoot,
  }).trim();
  const isFromOrigin = originUrl.includes(`/${forkOwner}/${forkRepo}`);
  const remoteName = isFromOrigin ? 'origin' : forkOwner;

  if (!isFromOrigin) {
    try {
      execSync(`git remote get-url "${remoteName}"`, { encoding: 'utf8', cwd: repoRoot });
    } catch {
      execSync(`git remote add "${remoteName}" "https://github.com/${forkOwner}/${forkRepo}.git"`, {
        stdio: gitStdio,
        cwd: repoRoot,
      });
    }
  }

  execSync(`git fetch "${remoteName}" "${remoteBranch}:${localBranch}"`, {
    stdio: gitStdio,
    cwd: repoRoot,
  });
  execSync(`git worktree add "${worktreePath}" "${localBranch}"`, {
    stdio: gitStdio,
    cwd: repoRoot,
  });

  // Set upstream so `git push` targets the correct fork and branch.
  // Use git-config directly instead of `branch --set-upstream-to` because
  // the targeted fetch above doesn't create a remote-tracking ref.
  execSync(`git -C "${worktreePath}" config "branch.${localBranch}.remote" "${remoteName}"`);
  execSync(
    `git -C "${worktreePath}" config "branch.${localBranch}.merge" "refs/heads/${remoteBranch}"`,
  );
} else {
  // Branch name -- slashes replaced with dashes for the directory name
  localBranch = arg;
  worktreePath = path.join(path.dirname(repoRoot), `readest-${arg.replace(/\//g, '-')}`);

  if (fs.existsSync(worktreePath)) {
    console.error(`Worktree path already exists: ${worktreePath}`);
    console.error('Removing existing worktree...');
    // Deinit only submodules we manage — skipped ones were never initialized
    const initedSubs = execSync(
      'git config --file .gitmodules --get-regexp "submodule\\..*\\.path"',
      { encoding: 'utf8', cwd: worktreePath },
    )
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
  }

  // Check if the branch already exists
  const branchExists = execSync('git branch --list --format="%(refname:short)"', {
    encoding: 'utf8',
    cwd: repoRoot,
  })
    .split('\n')
    .includes(localBranch);

  if (branchExists) {
    execSync(`git worktree add "${worktreePath}" "${localBranch}"`, {
      stdio: gitStdio,
      cwd: repoRoot,
    });
  } else {
    execSync(`git worktree add -b "${localBranch}" "${worktreePath}" origin/main`, {
      stdio: gitStdio,
      cwd: repoRoot,
    });
  }
}

// Rebase onto origin/main so the worktree starts from the latest upstream
console.error('\n--- Rebasing onto origin/main ---');
execSync('git rebase origin/main', { stdio: gitStdio, cwd: worktreePath });

// Repoint submodule URLs to local .git/modules/ clones to avoid remote fetches.
// Submodules without a local cache fall back to the remote URL.
console.error('\n--- Initializing submodules (using local objects) ---');
const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf8', cwd: repoRoot }).trim();
const absGitDir = path.resolve(repoRoot, gitDir);
const submoduleNames = execSync(
  'git config --file .gitmodules --get-regexp "submodule\\..*\\.path"',
  { encoding: 'utf8', cwd: worktreePath },
)
  .trim()
  .split('\n')
  .map((line) => {
    // line: submodule.<name>.path <path>
    const match = line.match(/^submodule\.(.+)\.path\s+(.+)$/);
    return { name: match![1]!, subPath: match![2]! };
  })
  .filter(({ subPath }) => !SKIPPED_SUBMODULES.includes(subPath));

for (const { name, subPath } of submoduleNames) {
  const localModuleDir = path.join(absGitDir, 'modules', subPath);
  // Also check if the submodule has a full .git/ directory (cloned outside of git's modules cache)
  const subGitDir = path.join(repoRoot, subPath, '.git');
  let localDir: string | undefined;
  if (fs.existsSync(localModuleDir)) {
    localDir = localModuleDir;
    console.error(`  ${subPath} -> local (.git/modules)`);
  } else if (fs.existsSync(subGitDir)) {
    localDir = fs.statSync(subGitDir).isDirectory()
      ? subGitDir
      : path.resolve(
          path.join(repoRoot, subPath),
          fs.readFileSync(subGitDir, 'utf8').replace('gitdir: ', '').trim(),
        );
    console.error(`  ${subPath} -> local (standalone .git)`);
  } else {
    console.error(`  ${subPath} -> remote (no local cache)`);
  }
  if (localDir) {
    // Allow fetching any commit (not just branch tips) from the local source
    execSync(`git -C "${localDir}" config uploadpack.allowAnySHA1InWant true`);
    execSync(`git -C "${worktreePath}" config "submodule.${name}.url" "${localDir}"`);
  }
}

for (const { subPath } of submoduleNames) {
  execSync(
    `git -c protocol.file.allow=always submodule update --init --recursive -- "${subPath}"`,
    { stdio: gitStdio, cwd: worktreePath },
  );
}

// Restore original remote URLs so `git push` in submodules works correctly
for (const { name } of submoduleNames) {
  const origUrl = execSync(`git config --file .gitmodules "submodule.${name}.url"`, {
    encoding: 'utf8',
    cwd: worktreePath,
  }).trim();
  execSync(`git -C "${worktreePath}" config "submodule.${name}.url" "${origUrl}"`);
}

// Install dependencies
console.error('\n--- Installing dependencies ---');
execSync('pnpm install', { stdio: gitStdio, cwd: worktreePath });

// Copy .env* files from the app directory to the new worktree's app directory
const appRelPath = 'apps/readest-app';
const srcAppDir = path.join(repoRoot, appRelPath);
const dstAppDir = path.join(worktreePath, appRelPath);
const envFiles = fs.readdirSync(srcAppDir).filter((f) => f.startsWith('.env'));
if (envFiles.length > 0) {
  console.error(`\n--- Copying ${envFiles.length} .env* files ---`);
  for (const envFile of envFiles) {
    const src = path.join(srcAppDir, envFile);
    const dst = path.join(dstAppDir, envFile);
    if (!fs.existsSync(dst)) {
      fs.copyFileSync(src, dst);
      console.error(`  ${envFile}`);
    }
  }
}

// Symlink target so the worktree shares the Rust build cache
const srcTarget = path.join(repoRoot, 'target');
const dstTarget = path.join(worktreePath, 'target');
if (fs.existsSync(srcTarget) && !fs.existsSync(dstTarget)) {
  console.error('\n--- Symlinking src-tauri/target ---');
  fs.symlinkSync(srcTarget, dstTarget, 'junction');
}

// Initialize Tauri Android gen directory (needs platform-specific paths regenerated)
const genDir = path.join(dstAppDir, 'src-tauri', 'gen');
const androidGenDir = path.join(genDir, 'android');
if (fs.existsSync(androidGenDir)) {
  console.error('\n--- Initializing Tauri Android ---');
  fs.rmSync(androidGenDir, { recursive: true });
  execSync('pnpm tauri android init', { stdio: gitStdio, cwd: dstAppDir });
  execSync('pnpm tauri icon ../../data/icons/readest-book.png', {
    stdio: gitStdio,
    cwd: dstAppDir,
  });
  execSync(`git checkout ${appRelPath}/src-tauri/gen/android ${appRelPath}/src-tauri/icons`, {
    stdio: gitStdio,
    cwd: worktreePath,
  });
}

// Symlink Tauri gen/apple and gen/schemas from the main worktree
for (const sub of ['apple', 'schemas', 'android/keystore.properties']) {
  const src = path.join(srcAppDir, 'src-tauri', 'gen', sub);
  const dst = path.join(genDir, sub);
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    console.error(`  Symlinking src-tauri/gen/${sub}`);
    fs.symlinkSync(src, dst, 'junction');
  }
}

// Copy public/vendor to the new worktree (built assets not in git)
const srcVendor = path.join(srcAppDir, 'public', 'vendor');
const dstVendor = path.join(dstAppDir, 'public', 'vendor');
if (fs.existsSync(srcVendor) && !fs.existsSync(dstVendor)) {
  console.error('\n--- Copying public/vendor ---');
  fs.cpSync(srcVendor, dstVendor, { recursive: true });
}

// Print path to stdout -- allows: cd $(pnpm worktree:new <arg>)
process.stdout.write(worktreePath + '\n');
