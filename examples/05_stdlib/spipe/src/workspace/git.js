import { existsSync } from "node:fs";

import { canonicalExistingIdentity } from "./paths.js";
import { hashCanonicalTuple } from "../storage/canonical.js";

/** Resolve the identity inputs used by the registry without inspecting or
 * scanning the repository.  Git command execution belongs to a host adapter;
 * this module only normalizes already-resolved values. */
export function resolveGitIdentity({ commonDir, gitDir, revisionId, revision } = {}) {
  if (typeof commonDir !== "string" || commonDir.length === 0) throw new TypeError("commonDir is required");
  if (typeof gitDir !== "string" || gitDir.length === 0) throw new TypeError("gitDir is required");
  const resolvedRevision = revisionId ?? revision;
  if (typeof resolvedRevision !== "string" || resolvedRevision.length === 0) throw new TypeError("resolved revision is required");
  return Object.freeze({
    common_dir: canonicalExistingIdentity(commonDir),
    git_dir: canonicalExistingIdentity(gitDir),
    revision_id: resolvedRevision.normalize("NFC")
  });
}

export function repositoryIdentity(commonDir) {
  if (!existsSync(commonDir)) return canonicalExistingIdentity(commonDir);
  return canonicalExistingIdentity(commonDir);
}

export function repositoryUid(commonDir) {
  return `R-${hashCanonicalTuple("repository_v1", [repositoryIdentity(commonDir)])}`;
}

export function worktreeIdentity(input) {
  const identity = resolveGitIdentity(input);
  return Object.freeze({
    ...identity,
    repository_uid: repositoryUid(identity.common_dir)
  });
}
