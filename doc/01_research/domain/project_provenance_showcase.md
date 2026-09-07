# Project Provenance Showcase — Domain Research

<!-- codex-research -->

## Evidence-dashboard principles

An evidence dashboard should link assertions to immutable source identifiers,
not a moving branch. A revision is meaningful only with repository URL, commit
SHA, optional release tag, test command/result, and a cleanliness verdict for
the source used by that test. A missing tag or unavailable live check must be
shown as unavailable; it must never be replaced with a guessed version.

## Chosen integration boundary to evaluate

`simply` remains an aggregator. Each advertised project publishes a small,
versioned proof receipt; `simply` validates and renders it. The first proof is
a deterministic in-repository simulator fixture. Live collection is an explicit
maintenance action, never a page-render request and never a hidden fallback.

## Release policy

The observed Simple beta `v1.0.1-beta.1` is the first valid pinned compatibility
reference. A project receipt may claim this tag only when its resolved commit
matches the tag target. Until a later stable release is deliberately admitted,
the dashboard must label the compatibility line as beta rather than advertise
it as stable.
