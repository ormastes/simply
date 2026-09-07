# simply — whole-earth software in Simple

Showcase, capability registry, and example corpus for the goal of implementing
the world's major software classes in the
[Simple](https://github.com/ormastes/simple) language.

**Site:** https://ormastes.github.io/simply/

- `doc/plan/implementation_map.md` — the whole-world software implementation
  map: two catalogs (38 infrastructure rows, 31 application-domain rows),
  scoring model, dependency map, and the Wave 0–11 implementation program.
- `doc/plan/design.md` — design of this repo (registry format, dashboard,
  theme, recursion prevention, examples migration).
- `data/registry.sdn` — the capability registry: every row scored
  Feature/Usability/Performance with a done % and an SSpec test link.
- `docs/` — the generated dashboard site (GitHub Pages, glass theme shared
  with SimpleOS).
- `docs/projects.html` — immutable project-propagation proofs, pinned to the
  current Simple beta rather than moving branches.
- `examples/` — the Simple example corpus, migrated from ormastes/simple.
- `scripts/update_site.sh` — regenerates the site from the registry; run daily
  by CI.

Never vendor `ormastes/simple` (or this repo) inside this tree — sibling repos
are referenced by URL only; `scripts/update_site.sh` fails on any nested
checkout. See design.md "Recursion prevention".

Run `sh scripts/project_proof.sh` to regenerate the project page and
`sh scripts/check_worktree_clean.sh` before recording evidence. Install the
pre-commit guard with `sh scripts/install_hooks.sh`.

To create a receipt from a clean sibling checkout, run:

```sh
sh scripts/collect_project_proof.sh PROJECT CHECKOUT test/path/proof_spec.spl -- simple test test/path/proof_spec.spl
```

The `project-proof` workflow exposes the same maintenance operation as a
manual GitHub Actions run. It resolves repository identity from the catalog,
uses the exact pinned beta checkout, uploads the receipt and raw test log, and
fails when the project test or anti-placeholder SSpec review fails.

The exact beta Linux artifact currently crashes before it can execute SSpec;
[Simple issue #497](https://github.com/ormastes/simple/issues/497) tracks that
release blocker. CI runs the portable behavior gates and attempts the beta
SSpec, but labels the latter blocked rather than presenting it as proof.
