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
- `examples/` — the Simple example corpus, migrated from ormastes/simple.
- `scripts/update_site.sh` — regenerates the site from the registry; run daily
  by CI.

Never vendor `ormastes/simple` (or this repo) inside this tree — sibling repos
are referenced by URL only; `scripts/update_site.sh` fails on any nested
checkout. See design.md "Recursion prevention".
