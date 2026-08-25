/-
  Memcpy.lean — memcpy / DMA length safety for the NVMe emulator's shared-memory seam.

  The emulator copies `n` words from/into a region of size `W` starting at offset `o`
  (the `copy: fn([i64], i64, i64) -> [i64]` seam in the device model). A transfer is
  in-bounds exactly when o >= 0, n >= 0 and o + n <= W. This file proves that under
  that guard, every index actually touched (o, o+1, ..., o+n-1) is a valid index of
  the region, i.e. in [0, W) — so no read/write ever overruns the buffer.

  Lean core + omega only (no mathlib).
-/

set_option linter.unusedVariables false

-- A transfer is well-formed when start/length are non-negative and it fits in the region.
def fits (o n W : Int) : Prop := 0 ≤ o ∧ 0 ≤ n ∧ o + n ≤ W

-- Every touched index of a fitting transfer is a valid region index [0, W).
theorem memcpy_index_in_bounds (o n W i : Int)
    (hfit : fits o n W) (hlo : o ≤ i) (hhi : i < o + n) :
    0 ≤ i ∧ i < W := by
  unfold fits at hfit; omega

-- Specialised endpoints: the first touched index is in range when n > 0.
theorem memcpy_first_in_bounds (o n W : Int)
    (hfit : fits o n W) (hpos : 0 < n) :
    0 ≤ o ∧ o < W := by
  unfold fits at hfit; omega

-- The last touched index (o + n - 1) is in range when n > 0.
theorem memcpy_last_in_bounds (o n W : Int)
    (hfit : fits o n W) (hpos : 0 < n) :
    0 ≤ o + n - 1 ∧ o + n - 1 < W := by
  unfold fits at hfit; omega

-- A zero-length transfer touches nothing: there is no index i with o ≤ i < o+0.
theorem memcpy_empty_touches_nothing (o W i : Int)
    (hfit : fits o 0 W) (hlo : o ≤ i) (hhi : i < o + 0) : False := by
  omega

-- Contrapositive guard: if a candidate transfer would touch an out-of-range index,
-- then it does NOT fit (so the device rightly reports SC_DMA_ERROR).
theorem memcpy_overrun_rejected (o n W : Int)
    (h : ∃ i, o ≤ i ∧ i < o + n ∧ W ≤ i) : ¬ fits o n W := by
  unfold fits; intro hfit; obtain ⟨i, h1, h2, h3⟩ := h; omega
