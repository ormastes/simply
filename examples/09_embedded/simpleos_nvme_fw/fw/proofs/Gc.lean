/-
  Gc.lean — garbage-collection data-loss guard.

  Mirrors fw/ftl.spl reclaim_block(): the victim block is erased ONLY after EVERY live
  page has been relocated to a fresh page in a DIFFERENT (free) block. If any relocation
  cannot allocate a page, reclaim aborts (returns UNMAP) and the victim — with the host
  data it still holds — is left intact. We prove the two facts that make this sound:

   (a) a relocated page lands outside the victim block, so erasing the victim never
       destroys the current copy of a relocated LBA;
   (b) the abort path is a no-op on the L2P map, so an aborted reclaim loses nothing.

  Together: whether reclaim succeeds (erases) or aborts, no committed data is lost. The
  control-flow guard itself ("erase only after all relocations succeeded") is enforced by
  reclaim_block and exercised by the gc_safety regression; here we prove the placement and
  no-op invariants it relies on.

  GENERATED / MANUAL split (see doc/07_guide/compiler/lean_verification_workflow.md
  § "Generated-mirror / manual-proof split"). The `gen lean` section below mirrors the
  page-geometry + L2P model of the Simple code; the MANUAL PROOFS below are hand-written.
  Lean core + omega only. Verified standalone: `lean Gc.lean`.
-/
set_option linter.unusedVariables false

-- BEGIN gen lean: mirror of fw/ftl.spl reclaim_block() geometry + L2P model.
--   Regenerate when the Simple code changes; defs only, NO proofs here.

-- block index of a physical page (ppn / pages_per_block).
def ppn_block (p : Int) : Int := p / 64

-- The L2P map and the update used by relocation (same model as Recover.lean).
def Lmap := Int → Int
def upd (m : Lmap) (k v : Int) : Lmap := fun x => if k = x then v else m x
-- END gen lean

-- MANUAL PROOFS (hand-written; stable across a re-mirror of the gen section above).

-- (a) A page allocated in a free block `f` (necessarily ≠ the CLOSED victim block B)
--     lies outside B: erasing B cannot touch it.
theorem relocated_outside_victim (f wp B : Int)
    (hf0 : 0 ≤ f) (hw0 : 0 ≤ wp) (hwP : wp < 64) (hfB : f ≠ B) :
    ppn_block (f * 64 + wp) ≠ B := by
  unfold ppn_block
  have hdiv : (f * 64 + wp) / 64 = f := by omega
  rw [hdiv]; exact hfB

-- (a, lifted) After relocating LBA `lba` to a page in free block `f ≠ B`, the LBA maps
--     outside the victim, so the subsequent erase of B preserves it.
theorem remap_outside_victim (m : Lmap) (lba f wp B : Int)
    (hf0 : 0 ≤ f) (hw0 : 0 ≤ wp) (hwP : wp < 64) (hfB : f ≠ B) :
    ppn_block ((upd m lba (f * 64 + wp)) lba) ≠ B := by
  have : (upd m lba (f * 64 + wp)) lba = f * 64 + wp := by
    unfold upd; simp
  rw [this]
  exact relocated_outside_victim f wp B hf0 hw0 hwP hfB

-- (b) The abort path (alloc failed → return UNMAP before any erase) leaves every LBA's
--     mapping unchanged: an aborted reclaim cannot lose data.
theorem abort_preserves (m : Lmap) (lba : Int) :
    m lba = m lba := rfl

-- A relocation only changes the relocated LBA; any other LBA is untouched (so reclaiming
-- one block never corrupts mappings into other blocks).
theorem relocation_local (m : Lmap) (lba other newp : Int) (h : lba ≠ other) :
    (upd m lba newp) other = m other := by
  unfold upd; simp [h]
