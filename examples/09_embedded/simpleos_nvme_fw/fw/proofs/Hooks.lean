/-
  Hooks.lean — sandboxed dynamic policy-hook safety (research req 7).

  Mirrors fw/sandbox.spl + fw/hooks.spl + the FTL's policy_gc_victim. We prove the three
  load-bearing sandbox guarantees (the fuel bound is a MODELED cooperative contract, not a
  hard preemption — see PRODUCTION_STATUS.md § boundary — so it is not the safety claim):

   (1) Install gate: only the four policy kinds (0..3) are allowed; every forbidden
       metadata / recovery / commit domain (>= 100) is rejected.
   (2) Output validation: the clamps map ANY value a hook returns into the safe set
       (priority into [0,3], a flag into {0,1}).
   (3) GC victim safety (the flagship): the firmware offers a list of its OWN CLOSED
       candidate blocks and asks the untrusted hook only to SCORE each; the selected
       victim is the min-score candidate. We prove the victim is ALWAYS one of the offered
       candidates — so it is CLOSED no matter what scores the hook returns, and can never
       name a FREE / OPEN-active / BAD block (which would corrupt the allocator). The
       unconditional GC data-loss guard (Gc.lean) then applies to that CLOSED victim.

  GENERATED / MANUAL split (see doc/07_guide/compiler/lean_verification_workflow.md
  § "Generated-mirror / manual-proof split"). The `gen lean` section below is a MECHANICAL
  mirror of the i64 logic in the cited Simple sources — it is the ONLY part coupled to the
  implementation, so when that code changes you re-transcribe just that section. The MANUAL
  PROOFS below are hand-written; a re-mirror leaves them untouched unless the model's shape or a
  constant used in a theorem statement changed. Lean core + omega only. Verified: `lean Hooks.lean`.
-/
set_option linter.unusedVariables false

-- BEGIN gen lean: mirror of fw/sandbox.spl (hook_kind_allowed, clamp_priority, clamp_bool)
--   + fw/hooks.spl / fw/ftl.spl policy_gc_victim (min-score selection).
--   Regenerate when the Simple code changes; defs only, NO proofs here.

-- (1) Install gate (fw/sandbox.spl hook_kind_allowed: kinds 0..3 allowed, >=100 rejected).
def allowed (kind : Int) : Prop := kind = 0 ∨ kind = 1 ∨ kind = 2 ∨ kind = 3

-- (2) Output validation clamps (fw/sandbox.spl clamp_priority / clamp_bool).
def QOS_MAX : Int := 3
def clampPriority (p : Int) : Int := if p < 0 then 0 else (if p > QOS_MAX then QOS_MAX else p)
def clampBool (b : Int) : Int := if b ≤ 0 then 0 else (if b ≠ 0 then 1 else 0)

-- (3) GC victim selection (fw/ftl.spl policy_gc_victim): over (block, score) candidates,
-- pick the min-score block, ties keeping the earlier (lower-index) candidate — exactly
-- policy_gc_victim's `score < best_score`.
def pickGo : Int → Int → List (Int × Int) → Int
  | bestB, _,     []             => bestB
  | bestB, bestS, (b, s) :: rest => if s < bestS then pickGo b s rest else pickGo bestB bestS rest
-- END gen lean

-- MANUAL PROOFS (hand-written; stable across a re-mirror of the gen section above).

-- (1) Install gate.
theorem gc_score_allowed  : allowed 0 := by unfold allowed; omega
theorem qos_allowed       : allowed 1 := by unfold allowed; omega
theorem hot_cold_allowed  : allowed 2 := by unfold allowed; omega
theorem telemetry_allowed : allowed 3 := by unfold allowed; omega

theorem wal_forbidden         : ¬ allowed 100 := by unfold allowed; omega
theorem checkpoint_forbidden  : ¬ allowed 101 := by unfold allowed; omega
theorem recovery_forbidden    : ¬ allowed 102 := by unfold allowed; omega
theorem superblock_forbidden  : ¬ allowed 103 := by unfold allowed; omega
theorem bad_block_forbidden   : ¬ allowed 104 := by unfold allowed; omega
theorem nand_commit_forbidden : ¬ allowed 105 := by unfold allowed; omega

-- An allowed kind is always one of the four policy surfaces — never a forbidden domain.
theorem allowed_is_policy_kind (k : Int) (h : allowed k) : 0 ≤ k ∧ k ≤ 3 := by
  unfold allowed at h; omega

-- (2) Output validation clamps.
theorem clampPriority_range (p : Int) : 0 ≤ clampPriority p ∧ clampPriority p ≤ QOS_MAX := by
  unfold clampPriority QOS_MAX
  split
  · omega
  · split <;> omega

theorem clampBool_range (b : Int) : clampBool b = 0 ∨ clampBool b = 1 := by
  unfold clampBool; split
  · simp
  · split <;> simp

-- (3) GC victim safety. The selected block is ALWAYS either the running best or a block
-- from the candidate list — so, threaded from the first candidate, the victim is always an
-- offered candidate.
theorem pickGo_mem (cs : List (Int × Int)) :
    ∀ bestB bestS, pickGo bestB bestS cs = bestB ∨ pickGo bestB bestS cs ∈ cs.map Prod.fst := by
  induction cs with
  | nil => intro bestB bestS; exact Or.inl rfl
  | cons hd tl ih =>
    intro bestB bestS
    obtain ⟨b, s⟩ := hd
    simp only [pickGo, List.map_cons]
    by_cases h : s < bestS
    · rw [if_pos h]
      rcases ih b s with hb | hm
      · exact Or.inr (by rw [hb]; simp)
      · exact Or.inr (by simp [hm])
    · rw [if_neg h]
      rcases ih bestB bestS with hb | hm
      · exact Or.inl hb
      · exact Or.inr (by simp [hm])

-- Flagship: if every candidate block the firmware offers is CLOSED, then the victim the
-- (untrusted, arbitrarily-scoring) hook leads it to is CLOSED — for ANY score function.
theorem victim_is_closed (closedOf : Int → Prop)
    (b0 s0 : Int) (rest : List (Int × Int))
    (hb0 : closedOf b0)
    (hrest : ∀ x, x ∈ rest.map Prod.fst → closedOf x) :
    closedOf (pickGo b0 s0 rest) := by
  rcases pickGo_mem rest b0 s0 with h | h
  · rw [h]; exact hb0
  · exact hrest _ h
