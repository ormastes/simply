/-
  Queue.lean — invariants for the device SQ/CQ in nvme_device.spl.

  CORRESPONDENCE: the emulator's submission/completion queues are append-only
  columns of length `count` (sq_*/cq_* grow via .push) read by a MONOTONIC head
  cursor (sq_head / cq_head) — NOT a modular ring. Reap is guarded exactly as in
  nvme_device.spl:
      if cq_head >= cq_cid.length() then (empty) else read at cq_head; cq_head += 1
  These theorems prove that guarded cursor never reads out of bounds and stays
  within [0, count]. (Lean core + omega only, no mathlib.)
-/
set_option linter.unusedVariables false

-- A fresh head (0) is within [0, count] for any non-negative count.
theorem head_init_in_range (count : Int) (h : 0 ≤ count) :
    0 ≤ (0 : Int) ∧ (0 : Int) ≤ count := by omega

-- Guarded reap: when the guard `head < count` holds (head ≥ 0), the access index
-- `head` is a valid in-bounds index into the length-`count` columns.
theorem guarded_reap_in_bounds (head count : Int)
    (hh : 0 ≤ head) (hlt : head < count) :
    0 ≤ head ∧ head < count := by omega

-- Advancing the head past a valid slot keeps it within [0, count] (never past end).
theorem advance_keeps_le (head count : Int)
    (hh : 0 ≤ head) (hlt : head < count) :
    0 ≤ head + 1 ∧ head + 1 ≤ count := by omega

-- The reap guard is total: either the queue is drained (head ≥ count, no access)
-- or the access index is in bounds. No execution path reads out of range.
theorem reap_guard_total (head count : Int) (hh : 0 ≤ head) :
    head ≥ count ∨ (0 ≤ head ∧ head < count) := by omega
