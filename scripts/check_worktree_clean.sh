#!/bin/sh
# Strict evidence mode rejects every tracked/untracked change. Pre-commit mode
# permits staged changes but rejects unstaged and untracked changes.
set -eu
mode=strict
case "${1:-}" in --pre-commit) mode=precommit;; "") ;; *) echo "usage: $0 [--pre-commit]" >&2; exit 2;; esac
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "FAIL: not a git worktree" >&2; exit 2; }
if [ "$mode" = strict ]; then dirty=$(git -C "$root" status --porcelain=v1 --untracked-files=all); else dirty="$(git -C "$root" diff --name-only; git -C "$root" ls-files --others --exclude-standard)"; fi
if [ -n "$dirty" ]; then printf 'FAIL: dirty worktree (%s mode)\n%s\n' "$mode" "$dirty" >&2; exit 1; fi
echo "PASS: clean worktree ($mode mode)"
