# Plugin

This directory contains plugin metadata for packaging SPipe as a reusable
agent-process module.

- `.codex-plugin/plugin.json` describes the skill, command, and MCP surfaces.
- `manifest.sdn` is a plain process manifest for non-Codex installers.

Version `0.2.0` includes guarded planning for isolated sessions, read-only main
fix discovery, reviewed beta backports, release-first forward ports, immutable
candidates, and promote-without-rebuild. The CLI and MCP interfaces validate
and hash supplied evidence but do not execute Git, builds, tags, pushes,
deletions, or publication. Installing the plugin does not confer protected
repository or publication authority.
