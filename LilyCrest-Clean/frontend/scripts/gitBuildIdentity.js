// Shared by app.config.js (to compute extra.gitCommit) and directly unit
// tested here — kept out of app.config.js itself because that file is only
// ever exercised indirectly (via `expo config` / source-text assertions),
// which can't easily mock child_process to prove the dirty-detection branch
// actually works.
const { execSync } = require('child_process');

// EAS build workers clone the repo fresh from git for every build, so a
// commit hash from EAS_BUILD_GIT_COMMIT_HASH always identifies an exactly
// clean tree — no local modifications can be present. A local build has no
// such guarantee: the checked-out HEAD commit does not by itself prove what
// was actually compiled if the working tree has uncommitted changes on top
// of it. `git status --porcelain` already respects .gitignore, so build
// output/.expo/Gradle caches never trip this — only tracked modifications
// and untracked *source* files do.
//
// This repo's actual git root is one level up from `cwd` (frontend/), and a
// sibling directory there can independently be dirty (e.g. another checked-
// out worktree) without that having any bearing on what this app build
// actually bundles. `-- .` scopes the status check to cwd's own subtree so
// unrelated sibling state can never falsely mark this build dirty.
function isLocalWorkingTreeDirty(cwd = process.cwd(), run = execSync) {
  try {
    const output = run('git status --porcelain -- .', { cwd }).toString();
    return output.trim().length > 0;
  } catch (_error) {
    // If git status can't even run, we can't vouch for cleanliness either —
    // fail toward "assume dirty" rather than silently claiming clean.
    return true;
  }
}

// A `-dirty` suffix means the SHA alone does not uniquely identify the
// artifact — some uncommitted change may also be compiled in.
function resolveGitCommit({
  env = process.env,
  cwd = process.cwd(),
  run = execSync,
} = {}) {
  if (env.EAS_BUILD_GIT_COMMIT_HASH) return env.EAS_BUILD_GIT_COMMIT_HASH.slice(0, 9);
  try {
    const sha = run('git rev-parse --short HEAD', { cwd }).toString().trim();
    return isLocalWorkingTreeDirty(cwd, run) ? `${sha}-dirty` : sha;
  } catch (_error) {
    return 'unknown';
  }
}

module.exports = { isLocalWorkingTreeDirty, resolveGitCommit };
