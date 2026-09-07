#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" config user.email proof@example.invalid
git -C "$tmp" config user.name proof
touch "$tmp/tracked"; git -C "$tmp" add tracked; git -C "$tmp" commit -qm initial
(cd "$tmp" && "$root/scripts/check_worktree_clean.sh" >/dev/null)
printf '%s\n' changed > "$tmp/tracked"
if (cd "$tmp" && "$root/scripts/check_worktree_clean.sh" >/dev/null 2>&1); then echo 'expected strict dirty rejection' >&2; exit 1; fi
git -C "$tmp" add tracked
(cd "$tmp" && "$root/scripts/check_worktree_clean.sh" --pre-commit >/dev/null)
touch "$tmp/untracked"
if (cd "$tmp" && "$root/scripts/check_worktree_clean.sh" --pre-commit >/dev/null 2>&1); then echo 'expected pre-commit untracked rejection' >&2; exit 1; fi
echo 'PASS: worktree guard distinguishes staged, unstaged, and untracked changes'
