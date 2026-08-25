/-
  Rain.lean — internal RAID/RAIN XOR-parity reconstruction (gap-closure P8).

  Mirrors fw/rain.spl: a stripe's parity is the XOR of its data words, and a lost channel is
  reconstructed by XORing the parity with the surviving words. This proof is GENUINE (it would be
  false if the reconstruction formula were wrong): for any lost word and any combined survivor
  value s, `parity = lost ⊕ s` implies `parity ⊕ s = lost` — the survivors cancel because XOR is
  its own inverse. Lean core (Nat.xor) only.

  GENERATED / MANUAL split (see doc/07_guide/compiler/lean_verification_workflow.md). The gen
  section mirrors the rain.spl parity/reconstruct model; the proofs are hand-written.
-/
set_option linter.unusedVariables false

-- BEGIN gen lean: mirror of fw/rain.spl — parity over a stripe, reconstruct from survivors.
--   A stripe's parity is the XOR of its data words; `s` is the XOR of the surviving words, so
--   parity = lost ^^^ s and reconstruct = parity ^^^ s. Regenerate on Simple-code change.
def parity (lost s : Nat) : Nat := lost ^^^ s        -- parity = lost ⊕ (⊕ survivors)
def reconstruct (p s : Nat) : Nat := p ^^^ s          -- XOR parity with the survivor combination
-- END gen lean

-- MANUAL PROOFS (hand-written; stable across a re-mirror of the gen section above).

-- XOR is its own inverse: applying the same value twice cancels it.
theorem xor_cancel (x s : Nat) : (x ^^^ s) ^^^ s = x := by
  rw [Nat.xor_assoc, Nat.xor_self, Nat.xor_zero]

-- Flagship: reconstructing a lost channel from the parity + survivors recovers the EXACT word,
-- for any data and any survivor combination — single-channel-failure resilience.
theorem reconstruct_recovers (lost s : Nat) : reconstruct (parity lost s) s = lost := by
  unfold reconstruct parity
  exact xor_cancel lost s

-- The parity channel itself is recoverable the same way (it is the XOR of the data words).
theorem parity_is_xor (lost s : Nat) : parity lost s = lost ^^^ s := rfl
