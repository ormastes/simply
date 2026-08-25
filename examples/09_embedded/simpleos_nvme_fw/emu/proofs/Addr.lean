/-
  Addr.lean — physical-address codec (PPA <-> linear ppn) for the NVMe emulator.

  Mirrors the i64 math in emu/nvme_ct.spl:
    GEOMETRY: CHANNELS=2, BANKS_PER_CH=2, PLANES_PER_BANK=2,
              BLOCKS_PER_PLANE=2, PAGES_PER_BLOCK=8  ->  NUM_PAGES = 128.

    encode:  ppn = ((((ch*2 + bank)*2 + plane)*2 + block)*8 + page)
    decode:  page  = ppn % 8
             block = ppn / 8  % 2
             plane = ppn / 16 % 2
             bank  = ppn / 32 % 2
             ch    = ppn / 64

  Proven (Lean core + omega only, no mathlib):
    * ppn_in_range   : a well-formed PPA encodes into [0, 128).
    * decode_in_range: every field decoded from ppn in [0,128) is in its own range.
    * decode_encode_roundtrip : encode (decode ppn) = ppn for ppn in [0,128)
                                (the codec is injective / a bijection onto [0,128)).
    * encode_decode_roundtrip : decoding the components of an encoded PPA returns them.
-/

set_option linter.unusedVariables false

-- ── encode (matches ppa_to_ppn in nvme_ct.spl) ───────────────────────────────
def ppaToPpn (ch bank plane block page : Int) : Int :=
  ((((ch*2 + bank)*2 + plane)*2 + block)*8 + page)

-- ── decode (matches ppn_channel/bank/plane/block/page in nvme_ct.spl) ────────
def ppnPage    (ppn : Int) : Int := ppn % 8
def ppnBlock   (ppn : Int) : Int := ppn / 8  % 2
def ppnPlane   (ppn : Int) : Int := ppn / 16 % 2
def ppnBank    (ppn : Int) : Int := ppn / 32 % 2
def ppnChannel (ppn : Int) : Int := ppn / 64

-- A well-formed PPA encodes into [0, 128).
theorem ppn_in_range (ch bank plane block page : Int)
    (hch  : 0 ≤ ch)    (hch2  : ch    < 2)
    (hbk  : 0 ≤ bank)  (hbk2  : bank  < 2)
    (hpl  : 0 ≤ plane) (hpl2  : plane < 2)
    (hbl  : 0 ≤ block) (hbl2  : block < 2)
    (hpg  : 0 ≤ page)  (hpg2  : page  < 8) :
    0 ≤ ppaToPpn ch bank plane block page ∧ ppaToPpn ch bank plane block page < 128 := by
  unfold ppaToPpn; omega

-- Every decoded field of a ppn in [0,128) lands in its own valid range.
theorem decode_in_range (ppn : Int) (h0 : 0 ≤ ppn) (h1 : ppn < 128) :
    (0 ≤ ppnPage ppn    ∧ ppnPage ppn    < 8) ∧
    (0 ≤ ppnBlock ppn   ∧ ppnBlock ppn   < 2) ∧
    (0 ≤ ppnPlane ppn   ∧ ppnPlane ppn   < 2) ∧
    (0 ≤ ppnBank ppn    ∧ ppnBank ppn    < 2) ∧
    (0 ≤ ppnChannel ppn ∧ ppnChannel ppn < 2) := by
  unfold ppnPage ppnBlock ppnPlane ppnBank ppnChannel; omega

-- decode then re-encode returns the original ppn  (injectivity / bijection onto [0,128)).
theorem decode_encode_roundtrip (ppn : Int) (h0 : 0 ≤ ppn) (h1 : ppn < 128) :
    ppaToPpn (ppnChannel ppn) (ppnBank ppn) (ppnPlane ppn) (ppnBlock ppn) (ppnPage ppn) = ppn := by
  unfold ppaToPpn ppnChannel ppnBank ppnPlane ppnBlock ppnPage; omega

-- encode then decode returns each original component (codec is two-sided inverse).
theorem encode_decode_roundtrip (ch bank plane block page : Int)
    (hch  : 0 ≤ ch)    (hch2  : ch    < 2)
    (hbk  : 0 ≤ bank)  (hbk2  : bank  < 2)
    (hpl  : 0 ≤ plane) (hpl2  : plane < 2)
    (hbl  : 0 ≤ block) (hbl2  : block < 2)
    (hpg  : 0 ≤ page)  (hpg2  : page  < 8) :
    ppnChannel (ppaToPpn ch bank plane block page) = ch ∧
    ppnBank    (ppaToPpn ch bank plane block page) = bank ∧
    ppnPlane   (ppaToPpn ch bank plane block page) = plane ∧
    ppnBlock   (ppaToPpn ch bank plane block page) = block ∧
    ppnPage    (ppaToPpn ch bank plane block page) = page := by
  unfold ppaToPpn ppnChannel ppnBank ppnPlane ppnBlock ppnPage; omega
