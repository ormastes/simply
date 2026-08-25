# Project Experts

Project experts own repository-level and subproject-level process knowledge.

Use one root project expert for a normal repository. For repositories with
multiple subprojects, add one directory per subproject and link it from the host
project's platform-specific setup.

When a subproject is a Git submodule and owns its own expert directory, list it
in the host repo's `.spipe/subproject_links.sdn` file. The SPipe setup scripts
will link those expert directories using Unix symlinks or Windows junctions.

Expected files:

- `skill.md` - role, scope, source roots, docs, and verification commands.
- `links.sdn` - optional host-specific link targets or platform notes.
