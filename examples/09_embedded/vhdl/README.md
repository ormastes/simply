# VHDL Examples

Hardware description language examples for the Simple compiler's VHDL support.

This directory separates three distinct categories of VHDL-related content
so that backend-generated proof artifacts are never conflated with builder
API demos or hand-written simulation fixtures.

See: `doc/03_plan/vhdl_backend_completion_plan_2026-04-04.md` (Phase 6)

## Directory Structure

```
vhdl/
  backend/                 # Backend-generated examples (--backend=vhdl)
    golden/                # Expected VHDL output from backend compilation
      adder.vhd            # Real VhdlBackend MIR-to-VHDL golden
  builder/                 # VhdlBuilder API demos (programmatic generation)
    counter.spl            # 8-bit counter with async reset
    alu.spl                # Simple ALU (add, sub, and, or)
    fsm.spl                # Traffic light FSM controller
    golden/                # Expected VHDL output from builder demos
      counter.vhd
      alu.vhd
      fsm.vhd
  simulation/              # Simulation fixtures and testbenches
    bounded_loop_example.vhd   # Reference bounded-loop accumulator design
```

## Category Definitions

### backend/ -- Backend-Generated Examples

Source `.spl` files compiled via `simple compile --backend=vhdl` once
source-to-hardware lowering is complete. Golden files here are
**proof-bearing artifacts** for compiler-owned VHDL output, not hand-written
simulation fixtures.

Golden `.vhd` files in `backend/golden/` are the expected output of
backend compilation and are intended for GHDL analysis/elaboration.

**Status:** MIR backend proof started. `backend/golden/adder.vhd` is matched
by `test/01_unit/compiler/backend/vhdl_backend_spec.spl` against output from the
real `VhdlBackend.compile` path. Full `.spl` source examples still require
completion of Phases 3-4 (source lowering and CLI authority) from the VHDL
backend completion plan.

How to run (once Phases 3-4 are complete):
```bash
bin/simple compile --backend=vhdl -o output.vhd backend/counter.spl
```

### builder/ -- VhdlBuilder API Demos

Source `.spl` files that use the `VhdlBuilder` and `VhdlTypeMapper` APIs
directly to construct VHDL text programmatically. These demonstrate the
builder infrastructure but are **not proof of backend lowering**.

Each demo imports `compiler.backend.vhdl.vhdl_builder.VhdlBuilder` and
`compiler.backend.vhdl_type_mapper.VhdlTypeMapper`, then calls builder
methods to emit entities, architectures, processes, and signals.

Golden `.vhd` files in `builder/golden/` show the expected builder output.

How to run:
```bash
bin/simple run examples/09_embedded/vhdl/builder/counter.spl
bin/simple run examples/09_embedded/vhdl/builder/alu.spl
bin/simple run examples/09_embedded/vhdl/builder/fsm.spl
```

### simulation/ -- Simulation Fixtures

Hand-written or reference VHDL designs used as simulation testbenches,
reference implementations, or GHDL validation targets. These are not
compiled from Simple source; they exist to support the simulation-backed
proof path described in Phase 7 of the completion plan.

Current files:
- `bounded_loop_example.vhd` -- demonstrates compile-time-constant loop
  bounds, elaboration-time assertions, and width-safe accumulation using
  numeric_std. Shows the style of VHDL the backend is expected to emit.

How to validate with GHDL:
```bash
ghdl -a --std=08 simulation/bounded_loop_example.vhd
ghdl -e --std=08 bounded_sum
```

## Relationship to the VHDL Backend Completion Plan

| Phase | Relevance to this directory |
|-------|-----------------------------|
| Phase 1-2 | Subset freeze and validation (no example changes) |
| Phase 3-4 | Populates `backend/` with compilable `.spl` sources and `backend/golden/` with expected output |
| Phase 5 | Adds GHDL proof for `backend/golden/` files |
| **Phase 6** | **This reorganization** -- separates builder demos from backend proof |
| Phase 7-8 | May add simulation-backed targets to `simulation/` |
| Phase 9 | Updates support matrix documentation |
