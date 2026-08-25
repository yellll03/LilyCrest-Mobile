// Regression coverage for scripts/gitBuildIdentity.js — the dirty-working-
// tree detection behind app.config.js's extra.gitCommit. Without this, a
// locally built APK's embedded commit hash could be claimed to uniquely
// identify the source it was compiled from even when the working tree had
// uncommitted changes on top of that commit — which is exactly what
// happened with the f32b9471 APK built earlier in this project's history.
const { isLocalWorkingTreeDirty, resolveGitCommit } = require('../../scripts/gitBuildIdentity');

function fakeRun(map) {
  return (command) => {
    const key = Object.keys(map).find((k) => command.startsWith(k));
    if (!key) throw new Error(`unexpected command: ${command}`);
    const result = map[key];
    if (result instanceof Error) throw result;
    return result;
  };
}

describe('isLocalWorkingTreeDirty', () => {
  it('is false when `git status --porcelain` prints nothing', () => {
    const run = fakeRun({ 'git status --porcelain': '' });
    expect(isLocalWorkingTreeDirty('/repo', run)).toBe(false);
  });

  it('is true when `git status --porcelain` reports any change', () => {
    const run = fakeRun({ 'git status --porcelain': ' M src/foo.js\n' });
    expect(isLocalWorkingTreeDirty('/repo', run)).toBe(true);
  });

  it('is true (fails toward dirty, not clean) when git cannot be run at all', () => {
    const run = fakeRun({ 'git status --porcelain': new Error('git not found') });
    expect(isLocalWorkingTreeDirty('/repo', run)).toBe(true);
  });
});

describe('resolveGitCommit', () => {
  it('on EAS (EAS_BUILD_GIT_COMMIT_HASH set) trusts the hash directly and never checks dirty state', () => {
    const run = jest.fn(() => { throw new Error('must not be called on EAS'); });
    const commit = resolveGitCommit({
      env: { EAS_BUILD_GIT_COMMIT_HASH: 'abcdef1234567890' },
      run,
    });
    expect(commit).toBe('abcdef123');
    expect(run).not.toHaveBeenCalled();
  });

  it('appends -dirty when the local tree has uncommitted changes', () => {
    const run = fakeRun({
      'git rev-parse --short HEAD': 'f32b947\n',
      'git status --porcelain': ' M frontend/app.config.js\n',
    });
    expect(resolveGitCommit({ env: {}, run })).toBe('f32b947-dirty');
  });

  it('reports the bare SHA with no suffix when the local tree is clean', () => {
    const run = fakeRun({
      'git rev-parse --short HEAD': 'f32b947\n',
      'git status --porcelain': '',
    });
    expect(resolveGitCommit({ env: {}, run })).toBe('f32b947');
  });

  it('falls back to "unknown" if git itself is unavailable', () => {
    const run = fakeRun({
      'git rev-parse --short HEAD': new Error('git not found'),
    });
    expect(resolveGitCommit({ env: {}, run })).toBe('unknown');
  });
});
