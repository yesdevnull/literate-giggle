'use strict';

const { buildMoveEntries, moveFile } = require('./moveFile');

// ─── buildMoveEntries ────────────────────────────────────────────────────────

describe('buildMoveEntries', () => {
  const FROM = 'src/old.js';
  const TO = 'src/new.js';
  const SHA = 'abc123def456abc123def456abc123def456abc1';

  test('returns a deletion entry with sha: null for the source path', () => {
    const { deletionEntry } = buildMoveEntries(FROM, TO, SHA);
    expect(deletionEntry).toEqual({
      path: FROM,
      mode: '100644',
      type: 'blob',
      sha: null,
    });
  });

  test('returns a creation entry with the existing blob SHA at the destination path', () => {
    const { creationEntry } = buildMoveEntries(FROM, TO, SHA);
    expect(creationEntry).toEqual({
      path: TO,
      mode: '100644',
      type: 'blob',
      sha: SHA,
    });
  });

  test('uses the provided mode for both entries', () => {
    const mode = '100755';
    const { deletionEntry, creationEntry } = buildMoveEntries(FROM, TO, SHA, mode);
    expect(deletionEntry.mode).toBe(mode);
    expect(creationEntry.mode).toBe(mode);
  });

  test('throws when fromPath is empty', () => {
    expect(() => buildMoveEntries('', TO, SHA)).toThrow(TypeError);
  });

  test('throws when toPath is empty', () => {
    expect(() => buildMoveEntries(FROM, '', SHA)).toThrow(TypeError);
  });

  test('throws when blobSha is empty', () => {
    expect(() => buildMoveEntries(FROM, TO, '')).toThrow(TypeError);
  });

  test('throws when fromPath and toPath are identical', () => {
    expect(() => buildMoveEntries(FROM, FROM, SHA)).toThrow(
      'fromPath and toPath must be different'
    );
  });
});

// ─── moveFile ────────────────────────────────────────────────────────────────

describe('moveFile', () => {
  const OWNER = 'acme';
  const REPO = 'widgets';
  const FROM = 'lib/old.js';
  const TO = 'lib/new.js';
  const BLOB_SHA = 'blobsha1blobsha1blobsha1blobsha1blobsha12';
  const BASE_TREE = 'basetreeshababasetreeshababasetreeshaba12';
  const PARENT_SHA = 'parentsha1parentsha1parentsha1parentsha1';
  const NEW_TREE_SHA = 'newtreeshanewtreeshanewtreeshanewtreesha';
  const NEW_COMMIT_SHA = 'newcommitshanecommitshanecommitshanecomm';

  function makeOctokit({ createTreeSha = NEW_TREE_SHA, createCommitSha = NEW_COMMIT_SHA } = {}) {
    return {
      rest: {
        git: {
          createBlob: jest.fn(),
          createTree: jest.fn().mockResolvedValue({ data: { sha: createTreeSha } }),
          createCommit: jest.fn().mockResolvedValue({ data: { sha: createCommitSha } }),
        },
      },
    };
  }

  test('calls createTree with deletion and creation entries — no createBlob call', async () => {
    const octokit = makeOctokit();

    await moveFile(octokit, {
      owner: OWNER,
      repo: REPO,
      fromPath: FROM,
      toPath: TO,
      blobSha: BLOB_SHA,
      baseTreeSha: BASE_TREE,
      parentSha: PARENT_SHA,
      message: 'move lib/old.js → lib/new.js',
    });

    // Pure move — createBlob must NOT have been called.
    expect(octokit.rest.git.createBlob).not.toHaveBeenCalled();
    expect(octokit.rest.git.createTree).toHaveBeenCalledTimes(1);

    const [callArgs] = octokit.rest.git.createTree.mock.calls;
    expect(callArgs[0]).toMatchObject({
      owner: OWNER,
      repo: REPO,
      base_tree: BASE_TREE,
      tree: [
        { path: FROM, mode: '100644', type: 'blob', sha: null },
        { path: TO,   mode: '100644', type: 'blob', sha: BLOB_SHA },
      ],
    });
  });

  test('calls createCommit with the new tree SHA and parent SHA', async () => {
    const octokit = makeOctokit();

    await moveFile(octokit, {
      owner: OWNER,
      repo: REPO,
      fromPath: FROM,
      toPath: TO,
      blobSha: BLOB_SHA,
      baseTreeSha: BASE_TREE,
      parentSha: PARENT_SHA,
      message: 'move lib/old.js → lib/new.js',
    });

    expect(octokit.rest.git.createCommit).toHaveBeenCalledWith({
      owner: OWNER,
      repo: REPO,
      message: 'move lib/old.js → lib/new.js',
      tree: NEW_TREE_SHA,
      parents: [PARENT_SHA],
    });
  });

  test('returns the new tree SHA and commit SHA', async () => {
    const octokit = makeOctokit();

    const result = await moveFile(octokit, {
      owner: OWNER,
      repo: REPO,
      fromPath: FROM,
      toPath: TO,
      blobSha: BLOB_SHA,
      baseTreeSha: BASE_TREE,
      parentSha: PARENT_SHA,
      message: 'move',
    });

    expect(result).toEqual({ treeSha: NEW_TREE_SHA, commitSha: NEW_COMMIT_SHA });
  });

  test('respects a custom file mode', async () => {
    const octokit = makeOctokit();

    await moveFile(octokit, {
      owner: OWNER,
      repo: REPO,
      fromPath: FROM,
      toPath: TO,
      blobSha: BLOB_SHA,
      baseTreeSha: BASE_TREE,
      parentSha: PARENT_SHA,
      message: 'move exec',
      mode: '100755',
    });

    const [callArgs] = octokit.rest.git.createTree.mock.calls;
    expect(callArgs[0].tree[0].mode).toBe('100755');
    expect(callArgs[0].tree[1].mode).toBe('100755');
  });

  test('propagates errors from createTree', async () => {
    const octokit = {
      rest: {
        git: {
          createBlob: jest.fn(),
          createTree: jest.fn().mockRejectedValue(new Error('API rate limit')),
          createCommit: jest.fn(),
        },
      },
    };

    await expect(
      moveFile(octokit, {
        owner: OWNER,
        repo: REPO,
        fromPath: FROM,
        toPath: TO,
        blobSha: BLOB_SHA,
        baseTreeSha: BASE_TREE,
        parentSha: PARENT_SHA,
        message: 'move',
      })
    ).rejects.toThrow('API rate limit');

    expect(octokit.rest.git.createCommit).not.toHaveBeenCalled();
  });
});
