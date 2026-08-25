import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, freezeDeep } from "../storage/canonical.js";
import { canonicalExistingIdentity, canonicalRoot, safeNamespace } from "./paths.js";
import { opaqueUid } from "../core/identity.js";
import { assertCanonicalUid } from "../model/identity.js";

export function deriveWorktreeUid({ projectUid, gitCommonDir, gitDir, explicitUid } = {}) {
  if (explicitUid) return assertCanonicalUid(String(explicitUid), "worktree uid", ["W"]);
  if (!projectUid || !gitCommonDir || !gitDir) throw new TypeError("projectUid, gitCommonDir, and gitDir are required to assign a worktree UID");
  canonicalExistingIdentity(gitCommonDir);
  canonicalExistingIdentity(gitDir);
  return opaqueUid("W");
}

export function createWorktreeRecord(input) {
  if (!input || typeof input !== "object") throw new TypeError("worktree must be an object");
  const projectUid = String(input.projectUid ?? input.project_uid ?? "");
  assertCanonicalUid(projectUid, "worktree projectUid", ["P"]);
  const worktreeRoot = input.root ?? input.worktreeRoot;
  if (typeof worktreeRoot !== "string" || worktreeRoot.length === 0) throw new TypeError("worktree root is required");
  const root = canonicalRoot(worktreeRoot);
  const gitCommonDir = input.gitCommonDir ?? input.git_common_dir ?? null;
  const gitDir = input.gitDir ?? input.git_dir ?? null;
  const worktreeUid = deriveWorktreeUid({ projectUid, gitCommonDir: gitCommonDir ?? root, gitDir: gitDir ?? root, explicitUid: input.worktreeUid ?? input.worktree_uid ?? input.uid });
  const record = {
    worktree_uid: worktreeUid,
    project_uid: projectUid,
    root,
    git_common_dir: gitCommonDir === null ? null : canonicalExistingIdentity(String(gitCommonDir)),
    git_dir: gitDir === null ? null : canonicalExistingIdentity(String(gitDir)),
    revision_id: input.revisionId ?? input.revision_id ?? null,
    cache_namespace: worktreeUid,
    overlay_namespace: worktreeUid
  };
  return freezeDeep(JSON.parse(canonicalJson(record)));
}

export function worktreeCacheLayout(cacheRoot, worktreeUid) {
  const namespace = safeNamespace(worktreeUid, "worktree uid");
  const root = join(canonicalRoot(cacheRoot), "worktrees", namespace);
  return Object.freeze({
    root,
    current: join(root, "current.sdn"),
    overlays: join(root, "overlays"),
    overlayObjects: join(root, "overlay_objects"),
    indexes: join(root, "indexes"),
    projections: join(root, "projections"),
    locks: join(root, "locks"),
    journals: join(root, "journals")
  });
}

export function ensureWorktreeCacheLayout(cacheRoot, worktreeUid) {
  const layout = worktreeCacheLayout(cacheRoot, worktreeUid);
  for (const key of ["root", "overlays", "overlayObjects", "indexes", "projections", "locks", "journals"]) {
    mkdirSync(layout[key], { recursive: true });
  }
  return layout;
}

export function sameWorktree(left, right) {
  return Boolean(left && right && left.worktree_uid && left.worktree_uid === right.worktree_uid);
}
