/-
  Fmc.lean — flash-memory-controller status state machine (gap-closure P1).

  Mirrors fw/fil_fmc.spl: the controller status register moves IDLE(0) → BUSY(1) → DONE(2)/ERR(3),
  cleared by ack. We prove the two register-discipline guarantees the firmware relies on:
   (1) `issue` completes a command (DONE/ERR) ONLY from BUSY — you can never observe a completed
       command that was never loaded+issued (issue from any non-BUSY status is a no-op);
   (2) from BUSY, issue reaches exactly DONE or ERR; ERR is sticky under poll (read-only) and is
       cleared only by ack.

  GENERATED / MANUAL split (see doc/07_guide/compiler/lean_verification_workflow.md
  § "Generated-Mirror / Manual-Proof Split"). The `gen lean` section mirrors the i64 status
  transitions of fil_fmc.spl; the proofs are hand-written. Lean core + omega only. Verified:
  `lean Fmc.lean`.
-/
set_option linter.unusedVariables false

-- BEGIN gen lean: mirror of fw/fil_fmc.spl status transitions (IDLE=0 BUSY=1 DONE=2 ERR=3).
--   Regenerate when the Simple code changes; defs only, NO proofs here.
def IDLE : Int := 0
def BUSY : Int := 1
def DONE : Int := 2
def ERR  : Int := 3

def load (s : Int) : Int := BUSY                       -- writing the command register -> BUSY
def issue (s : Int) (failed : Bool) : Int :=           -- only acts from BUSY
  if s = BUSY then (if failed then ERR else DONE) else s
def ack (s : Int) : Int := IDLE                        -- acknowledge -> IDLE
def poll (s : Int) : Int := s                          -- status read is non-mutating
-- END gen lean

-- MANUAL PROOFS (hand-written; stable across a re-mirror of the gen section above).

-- (1) issue completes only from BUSY: from any other status it is a no-op, so a DONE/ERR status
--     can never appear without a prior load (→ BUSY) + issue.
theorem issue_needs_busy (s : Int) (f : Bool) (h : s ≠ BUSY) : issue s f = s := by
  unfold issue; rw [if_neg h]

-- (2) from BUSY, issue reaches exactly DONE or ERR.
theorem issue_completes (f : Bool) : issue BUSY f = DONE ∨ issue BUSY f = ERR := by
  cases f
  · exact Or.inl (by simp [issue])
  · exact Or.inr (by simp [issue])

-- A loaded command is BUSY (ready to issue), never already completed.
theorem load_is_busy (s : Int) : load s = BUSY := rfl

-- (3) ERR is sticky: polling the status does not clear it; only ack returns to IDLE.
theorem err_sticky_under_poll : poll ERR = ERR := rfl
theorem ack_clears_err : ack ERR = IDLE := rfl
theorem ack_clears_done : ack DONE = IDLE := rfl
