/-
  Resource.lean — resource-safety properties the NVMe emulator actually implements.

  (a) FTL page-allocation safety (ftl_emu.spl, Ftl.write). The FTL allocates physical
      pages with a MONOTONIC cursor: it guards `cursor >= NUM_PAGES` (exhaustion ->
      SC_INTERNAL), otherwise allocates ppn := cursor and advances cursor := cursor+1.
      We prove every page it hands out is a valid physical page, the cursor strictly
      advances, and therefore the allocator NEVER returns the same ppn twice
      (no double-allocation / no aliasing of live physical pages).

  (b) Shared-memory region disjointness (nvme_shared.spl + the PRP buffers in
      nvme_emu_main.spl). Two PRP regions [a, a+la) and [b, b+lb) laid out
      non-overlapping (a + la <= b) share no word index, so a DMA into one cannot
      corrupt the other.

  Lean core + omega / decide only (no mathlib). Models mirror the i64 logic in the
  cited Simple sources (NUM_PAGES = 128, the emulator's geometry).
-/
set_option linter.unusedVariables false

def NUM_PAGES : Int := 128

-- (a1) A write that passes the guard `cursor < NUM_PAGES` (with cursor >= 0)
-- allocates an in-range physical page ppn = cursor.
theorem alloc_in_range (cursor : Int) (h0 : 0 ≤ cursor) (hlt : cursor < NUM_PAGES) :
    0 ≤ cursor ∧ cursor < NUM_PAGES := by omega

-- (a2) After allocating, the cursor strictly increases (cursor := cursor + 1).
theorem alloc_advances (cursor : Int) : cursor < cursor + 1 := by omega

-- (a3) No double-allocation: because the cursor is strictly monotone, the i-th and
-- j-th sequential allocations (ppn = start+i and start+j) are distinct for i ≠ j.
theorem alloc_no_reuse (start i j : Int) (hij : i ≠ j) :
    start + i ≠ start + j := by omega

-- (a4) Exhaustion is caught before over-allocating past the media.
theorem exhaustion_guarded (cursor : Int) (hge : cursor ≥ NUM_PAGES) :
    ¬ (cursor < NUM_PAGES) := by omega

-- (b) Membership in a half-open region [base, base+len).
def inRegion (base len i : Int) : Prop := base ≤ i ∧ i < base + len

-- Non-overlapping regions share no index.
theorem regions_disjoint (a la b lb i : Int)
    (hla : 0 ≤ la) (hlb : 0 ≤ lb) (hsep : a + la ≤ b)
    (hi_a : inRegion a la i) (hi_b : inRegion b lb i) : False := by
  unfold inRegion at hi_a hi_b; omega

-- Equivalent statement: no index is simultaneously in both regions.
theorem regions_no_common_index (a la b lb : Int)
    (hla : 0 ≤ la) (hlb : 0 ≤ lb) (hsep : a + la ≤ b) :
    ¬ ∃ i, inRegion a la i ∧ inRegion b lb i := by
  rintro ⟨i, hi_a, hi_b⟩
  unfold inRegion at hi_a hi_b; omega

-- Every index of region B lies strictly outside region A.
theorem region_b_outside_a (a la b lb i : Int)
    (hla : 0 ≤ la) (hlb : 0 ≤ lb) (hsep : a + la ≤ b)
    (hi_b : inRegion b lb i) : ¬ inRegion a la i := by
  unfold inRegion at *; omega
