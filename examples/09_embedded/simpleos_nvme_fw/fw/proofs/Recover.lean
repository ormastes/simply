/-
  Recover.lean — power-on recovery preserves the committed prefix (newest write wins).

  Mirrors fw/ftl.spl recover(): the journal (WAL) is replayed onto the flash-resident
  L2P in append order, which is ascending sequence number. We prove that replaying the
  records left-to-right yields, for every LBA, the new_ppn of its LAST record — i.e. the
  newest mapping wins, and a trim record (new_ppn = UNMAP = -1) clears the entry unless a
  later write supersedes it. This is exactly the committed-prefix property: every write
  acked to the host (hence journaled) is recovered, and nothing older shadows it.

  GENERATED / MANUAL split (see doc/07_guide/compiler/lean_verification_workflow.md
  § "Generated-mirror / manual-proof split"). The `gen lean` section below mirrors the
  replay model of the Simple code; the MANUAL PROOFS below are hand-written. Lean core
  only (no mathlib). Verified standalone: `lean Recover.lean`.
-/
set_option linter.unusedVariables false

-- BEGIN gen lean: mirror of fw/ftl.spl recover() replay model (L2P map + journal replay).
--   Regenerate when the Simple code changes; defs only, NO proofs here.

-- The L2P map as a total function (UNMAP = -1 is the default for an unmapped LBA).
def Lmap := Int → Int
def empty : Lmap := fun _ => -1
def upd (m : Lmap) (k v : Int) : Lmap := fun x => if k = x then v else m x

-- Replay a list of (lba, new_ppn) records left-to-right (append order = ascending seq).
def replay : List (Int × Int) → Lmap → Lmap
  | [], m => m
  | (l, p) :: rest, m => replay rest (upd m l p)

-- The last new_ppn recorded for key `k` in the list, or default `d` if `k` never appears.
def lastFor (k : Int) : List (Int × Int) → Int → Int
  | [], d => d
  | (l, p) :: rest, d => lastFor k rest (if l = k then p else d)
-- END gen lean

-- MANUAL PROOFS (hand-written; stable across a re-mirror of the gen section above).

-- Core theorem: after replay, each LBA holds the new_ppn of its LAST journaled record.
theorem replay_last (rs : List (Int × Int)) (k : Int) (m : Lmap) :
    replay rs m k = lastFor k rs (m k) := by
  induction rs generalizing m with
  | nil => rfl
  | cons hd tl ih =>
    obtain ⟨l, p⟩ := hd
    simp only [replay, lastFor, ih, upd]

-- Corollary: the newest write to an LBA wins over an older one.
theorem newest_write_wins (k : Int) :
    replay [(k, 5), (k, 9)] empty k = 9 := by
  rw [replay_last]; simp [lastFor]

-- Corollary: a trim (UNMAP = -1) after a write leaves the LBA unmapped on recovery.
theorem trim_supersedes_write (k : Int) :
    replay [(k, 5), (k, -1)] empty k = -1 := by
  rw [replay_last]; simp [lastFor]

-- Corollary: a write after a trim re-maps the LBA (recovery keeps the newest fact).
theorem write_supersedes_trim (k : Int) :
    replay [(k, -1), (k, 7)] empty k = 7 := by
  rw [replay_last]; simp [lastFor]

-- An LBA that was never journaled stays unmapped after recovery.
theorem untouched_stays_unmapped (k j p : Int) (h : j ≠ k) :
    replay [(j, p)] empty k = -1 := by
  rw [replay_last]; simp [lastFor, empty, h]
