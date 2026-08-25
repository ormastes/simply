/*
 * Canonical freestanding DMA runtime for ARM64 SimpleOS.
 *
 * The native project linker discovers boot C sources. Keep this translation unit
 * as a thin composition capsule so the allocator and cache-maintenance logic
 * remain owned by src/runtime/startup/baremetal rather than being duplicated
 * in the architecture boot shim.
 */
#include "../../../../../../src/runtime/startup/baremetal/dma.c"
#include "../../../../../../src/runtime/startup/baremetal/dma_arm64.c"
