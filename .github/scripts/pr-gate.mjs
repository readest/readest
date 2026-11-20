// Gate for pull requests from outside contributors: the PR must link an issue,
// and every non-merge commit must end with an attribution line naming both the
// coding agent and the model (see CONTRIBUTING.md).
//
//   node pr-gate.mjs           check only; exits 1 when the gate fails
//   node pr-gate.mjs --report  also labels the PR and comments on it
//
// It reads the PR through the API only and never runs the PR's code, so it is
// safe under pull_request_target.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXEMPT = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
// Co-Authored-By: <agent> (<model>) <email>
const ATTRIBUTION = /^co-authored-by:[ \t]*[^\s(][^(\n]*\([ \t]*[^\s()][^()\n]*\)[ \t]*<[^<>\s]+>[ \t]*$/im;
const MARKER = '<!-- pr-gate -->';
const LABELS = { missingIssue: 'needs-issue', unattributed: 'needs-attribution' };
const GUIDE = 'https://github.com/readest/readest/blob/main/CONTRIBUTING.md';

export const hasAttribution = (message) => ATTRIBUTION.test(message);

// Returns null when the author is exempt.
export function findProblems(pr, commits, linkedIssues) {
  if (EXEMPT.has(pr.author_association) || pr.user.type === 'Bot') return null;
  return {
    missingIssue: linkedIssues === 0,
    unattributed: commits
      .filter((c) => c.parents.length < 2 && !hasAttribution(c.commit.message))
      .map((c) => c.sha.slice(0, 7)),
    // The API lists at most 250 commits; fail closed on the rest.
    truncated: commits.length < pr.commits,
  };
}

const failed = (p) => p && (p.missingIssue || p.unattributed.length > 0 || p.truncated);

function commentBody(p) {
  const lines = [MARKER, 'Thanks for the PR! Before CI runs, it needs:', ''];
  if (p.missingIssue) {
    lines.push(
      '- **A linked issue.** Open or find the issue this PR addresses and add `Fixes #<number>` to the PR description.',
    );
  }
  if (p.unattributed.length) {
    lines.push(
      `- **An attribution line in every commit** naming both the coding agent and the model, e.g. \`Co-Authored-By: Claude Code (Claude Opus 5.5) <noreply@anthropic.com>\`. Missing in: ${p.unattributed.join(', ')}. Amend the commits and force-push.`,
    );
  }
  if (p.truncated) {
    lines.push('- **At most 250 commits.** GitHub only lists the first 250, so the rest can\'t be checked. Squash them.');
  }
  lines.push('', `CI is skipped until these are fixed. See [CONTRIBUTING.md](${GUIDE}).`);
  return lines.join('\n');
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).pull_request;
  if (!pr) return; // push or schedule: nothing to gate

  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
    });
    if (!res.ok && res.status !== 404) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status}`);
    return res.status === 204 || res.status === 404 ? null : res.json();
  };

  const commits = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/repos/${repo}/pulls/${pr.number}/commits?per_page=100&page=${page}`);
    commits.push(...batch);
    if (batch.length < 100) break;
  }
  const [owner, name] = repo.split('/');
  const { data } = await api('/graphql', {
    method: 'POST',
    body: JSON.stringify({
      query:
        'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences{totalCount}}}}',
      variables: { owner, name, number: pr.number },
    }),
  });
  const linked = data.repository.pullRequest.closingIssuesReferences.totalCount;
  const problems = findProblems(pr, commits, linked);

  if (process.argv.includes('--report') && problems) {
    const issue = `/repos/${repo}/issues/${pr.number}`;
    for (const [key, label] of Object.entries(LABELS)) {
      const on = key === 'missingIssue' ? problems.missingIssue : problems.unattributed.length > 0;
      if (on) await api(`${issue}/labels`, { method: 'POST', body: JSON.stringify({ labels: [label] }) });
      else await api(`${issue}/labels/${label}`, { method: 'DELETE' });
    }
    const comments = await api(`${issue}/comments?per_page=100`);
    const existing = comments.find((c) => c.user.type === 'Bot' && c.body.startsWith(MARKER));
    if (failed(problems)) {
      const body = JSON.stringify({ body: commentBody(problems) });
      if (existing) await api(`/repos/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', body });
      else await api(`${issue}/comments`, { method: 'POST', body });
    } else if (existing) {
      // Linking an issue doesn't trigger CI, so re-run the jobs the gate skipped.
      // The comment goes last: if a re-run fails, the next event retries it.
      const { workflow_runs } = await api(
        `/repos/${repo}/actions/runs?event=pull_request&head_sha=${pr.head.sha}`,
      );
      for (const run of workflow_runs.filter((r) => r.conclusion === 'failure')) {
        await api(`/repos/${repo}/actions/runs/${run.id}/rerun-failed-jobs`, { method: 'POST' });
      }
      await api(`/repos/${repo}/issues/comments/${existing.id}`, { method: 'DELETE' });
    }
  }

  if (failed(problems)) {
    console.error(commentBody(problems).replace(MARKER, '').trim());
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
