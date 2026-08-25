/-
  Alloc.lean — log-structured allocator + GC-reserve safety for the NVMe firmware FTL.

  Mirrors the i64 logic of fw/ftl_band.spl (BandAlloc):
   * alloc_page() hands out ppn = block_first_ppn(active) + active_wp and advances the
     write pointer by 1 (a strictly monotonic cursor within a block);
   * alloc_page_host(reserve) opens a NEW block only when free_count > reserve, holding
     `reserve` free blocks back as GC scratch (fw/nvme_types.spl GC_RESERVE = 2);
   * geometry: 64 blocks x 64 pages = 4096 physical pages.

  GENERATED / MANUAL split (see doc/07_guide/compiler/lean_verification_workflow.md
  § "Generated-mirror / manual-proof split"). The `gen lean` section below mirrors the
  Simple constants/arithmetic and is the only part coupled to the implementation; the
  MANUAL PROOFS below are hand-written. Lean core + omega only. Verified: `lean Alloc.lean`.
-/
set_option linter.unusedVariables false

-- BEGIN gen lean: mirror of fw/ftl_band.spl + fw/nvme_types.spl (GC_RESERVE).
--   Regenerate when the Simple code changes; defs only, NO proofs here.

-- ppn of write pointer `wp` within block `b` (block_first_ppn(b) + wp).
def ppn (b wp : Int) : Int := b * 64 + wp

-- GC scratch reserve held back from the host allocator (fw/nvme_types.spl GC_RESERVE).
def GC_RESERVE : Int := 2
-- END gen lean

-- MANUAL PROOFS (hand-written; stable across a re-mirror of the gen section above).

-- (1) Every page handed out within a valid block/write-pointer is a valid physical page
--     in [0, 4096). No allocation ever escapes the device.
theorem alloc_in_range (b wp : Int)
    (hb0 : 0 ≤ b) (hbN : b ≤ 63) (hw0 : 0 ≤ wp) (hwP : wp ≤ 63) :
    0 ≤ ppn b wp ∧ ppn b wp ≤ 4095 := by
  unfold ppn; omega

-- (2) The write pointer is a strictly monotonic cursor: consecutive allocations in a
--     block return consecutive ppns, so the allocator NEVER hands out the same page
--     twice within a block (no aliasing of live physical pages).
theorem alloc_strict_mono (b wp : Int) : ppn b (wp + 1) = ppn b wp + 1 := by
  unfold ppn; omega

theorem alloc_distinct (b wp1 wp2 : Int) (h : wp1 ≠ wp2) : ppn b wp1 ≠ ppn b wp2 := by
  unfold ppn; omega

-- (3) GC-reserve invariant. The host allocator opens a new block only when
--     free_count > reserve (it refuses, returning NO_PPN, when free_count ≤ reserve).
--     Opening a block decrements free_count by 1. Hence free_count ≥ reserve is an
--     invariant of the host write path: the reserve is never breached, so garbage
--     collection (which uses the unreserved allocator) always has ≥ reserve free blocks
--     of scratch and can always make forward progress.
theorem host_alloc_preserves_reserve (free : Int)
    (hopen : free > GC_RESERVE) :         -- the only branch that decrements free
    free - 1 ≥ GC_RESERVE := by
  unfold GC_RESERVE at *; omega

-- (4) GC forward progress: reclaiming a block with v < 64 valid pages relocates v pages
--     and frees a whole 64-page block, a strict net gain of (64 - v) > 0 free pages. So
--     as long as a non-full victim exists, GC strictly increases free space.
theorem gc_makes_progress (v : Int) (hv0 : 0 ≤ v) (hvLt : v < 64) :
    64 - v > 0 := by omega
