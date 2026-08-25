<!-- codex-design -->
# Simple ERP Feature Plan

## Goals

- CRM: leads, accounts, contacts, activities, quotes, and customer service
  notes.
- Reservation: meeting rooms, hotel rooms, restaurant tables, capacity, holds,
  and no-show handling.
- Selling: online shop, unmanned shop, restaurant coffee/meal/bakery sales,
  auction, and retail shop.
- Easy mode: one-screen work queue with guided create flows and safe defaults.
- Pro mode: detailed totals, approvals, audit visibility, and advanced filters.

## Current Seed

- One in-memory catalog file owns the example.
- CRM sample data proves account/contact ownership, pipeline value, quote
  approval, next action, and won-deal exclusion.
- Reservation sample data proves remaining-capacity math, overbooking guard,
  holds with deposits, cancellation, and no-show state.
- Selling sample data proves channel totals, unpaid revenue math, payment state,
  and payment audit visibility.
- Easy and pro mode summaries reuse the same domain facts.
- CLI mode selection prints either the easy operator interface, the pro detail
  interface, or both by default.

## Architecture

- Keep `src/catalog.spl` as the single source of truth for the example lanes.
- Future UI or app wrappers should consume the catalog instead of repeating lane
  names or sample math.
- If the selling lane expands into order capture, reuse
  `examples/06_io/restaurant_webapp`.
- If payment rules expand, reuse `src/lib/nogc_async_mut/payment`.

## Six-Hour Build Slice

1. Hour 1: stabilize catalog text, sample records, and acceptance statements.
2. Hour 2: flesh out CRM account/contact/quote behavior and operator-facing
   summary text.
3. Hour 3: flesh out reservation booking, hold, cancellation, no-show, and
   capacity guard behavior.
4. Hour 4: flesh out selling channel behavior, payment state, audit notes, and
   unpaid revenue math.
5. Hour 5: keep easy and pro mode outputs aligned with the same shared facts.
6. Hour 6: write the handoff docs, review the example, and clean up duplicated
   wording.
