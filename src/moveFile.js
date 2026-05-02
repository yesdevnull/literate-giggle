'use strict';

/**
 * Builds the tree entries required to perform a pure file move via the
 * GitHub Trees API.
 *
 * A "pure move" reuses the existing blob SHA at the destination path and
 * marks the source path for deletion (sha: null).  No create-blob call is
 * needed because the file content is unchanged.
 *
 * Documented pattern:
 *   https://docs.github.com/en/rest/git/trees#create-a-tree
 *
 * @param {string} fromPath  - Current file path in the tree.
 * @param {string} toPath    - Destination file path in the tree.
 * @param {string} blobSha   - Existing blob SHA for the file content.
 * @param {string} [mode]    - Git file mode (default: '100644').
 * @returns {{ deletionEntry: object, creationEntry: object }}
 */
function buildMoveEntries(fromPath, toPath, blobSha, mode = '100644') {
  if (!fromPath || typeof fromPath !== 'string') {
    throw new TypeError('fromPath must be a non-empty string');
  }
  if (!toPath || typeof toPath !== 'string') {
    throw new TypeError('toPath must be a non-empty string');
  }
  if (!blobSha || typeof blobSha !== 'string') {
    throw new TypeError('blobSha must be a non-empty string');
  }
  if (fromPath === toPath) {
    throw new Error('fromPath and toPath must be different');
  }

  /** Marks the source path for deletion. */
  const deletionEntry = {
    path: fromPath,
    mode,
    type: 'blob',
    sha: null,
  };

  /** Places the existing blob at the destination path — no re-upload needed. */
  const creationEntry = {
    path: toPath,
    mode,
    type: 'blob',
    sha: blobSha,
  };

  return { deletionEntry, creationEntry };
}

/**
 * Executes a pure file move by creating a new Git tree via the GitHub
 * Trees API and committing it.
 *
 * The function intentionally skips the create-blob step because the content
 * is being moved, not changed.
 *
 * @param {object} octokit      - An Octokit instance (or compatible client).
 * @param {object} params
 * @param {string} params.owner       - Repository owner.
 * @param {string} params.repo        - Repository name.
 * @param {string} params.fromPath    - Current file path.
 * @param {string} params.toPath      - Destination file path.
 * @param {string} params.blobSha     - Existing blob SHA of the file.
 * @param {string} params.baseTreeSha - SHA of the tree to base the new tree on.
 * @param {string} params.parentSha   - SHA of the parent commit.
 * @param {string} params.message     - Commit message.
 * @param {string} [params.mode]      - Git file mode (default: '100644').
 * @returns {Promise<{ treeSha: string, commitSha: string }>}
 */
async function moveFile(octokit, params) {
  const {
    owner,
    repo,
    fromPath,
    toPath,
    blobSha,
    baseTreeSha,
    parentSha,
    message,
    mode = '100644',
  } = params;

  const { deletionEntry, creationEntry } = buildMoveEntries(
    fromPath,
    toPath,
    blobSha,
    mode
  );

  // Create a new tree with the deletion and creation entries.
  // No create-blob call is issued — this is the pure-move optimisation.
  const { data: tree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: [deletionEntry, creationEntry],
  });

  // Create the commit that points to the new tree.
  const { data: commit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: tree.sha,
    parents: [parentSha],
  });

  return { treeSha: tree.sha, commitSha: commit.sha };
}

module.exports = { buildMoveEntries, moveFile };
