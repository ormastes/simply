#ifndef SIMPLEOS_ARM64_VIRTIO_INPUT_MMIO_CONTRACT_H
#define SIMPLEOS_ARM64_VIRTIO_INPUT_MMIO_CONTRACT_H

#include <stdint.h>
#include <stddef.h>

#define ARM64_VIRTIO_RESET_POLLS 100000U
#define ARM64_DMA_READ_ONCE(value) (*(volatile __typeof__(value) *)&(value))
#define ARM64_DMA_WRITE_ONCE(value, next) \
    do { (*(volatile __typeof__(value) *)&(value)) = (next); } while (0)

static inline uint32_t arm64_virtio_status_add(uint32_t status, uint32_t bits)
{
    return status | bits;
}

static inline uint32_t arm64_virtio_status_fail(uint32_t status, uint32_t failed_bit)
{
    return status | failed_bit;
}

static inline int arm64_virtio_status_rejected(uint32_t status,
                                               uint32_t failed_bit,
                                               uint32_t needs_reset_bit)
{
    return (status & (failed_bit | needs_reset_bit)) != 0U;
}

static inline int arm64_virtio_event_length_valid(uint32_t used_len, uint32_t event_size)
{
    return used_len == event_size;
}

static inline int arm64_virtio_dma_region_valid(uint64_t addr, uint64_t size,
                                                uint64_t alignment,
                                                uint64_t window_begin,
                                                uint64_t window_end)
{
    if (alignment == 0U || (alignment & (alignment - 1U)) != 0U) return 0;
    if (addr == 0U || (addr & (alignment - 1U)) != 0U) return 0;
    if (addr < window_begin || addr >= window_end) return 0;
    if (size == 0U || size > window_end - addr) return 0;
    return 1;
}

static inline int arm64_virtio_queue_shape_valid(uint32_t queue_size,
                                                 uint32_t max_queue,
                                                 uint64_t desc_addr,
                                                 uint64_t desc_size,
                                                 uint64_t avail_addr,
                                                 uint64_t avail_size,
                                                 uint64_t used_addr,
                                                 uint64_t used_size,
                                                 uint64_t event_addr,
                                                 uint64_t event_size,
                                                 uint64_t window_begin,
                                                 uint64_t window_end)
{
    if (queue_size == 0U || queue_size > max_queue ||
        (queue_size & (queue_size - 1U)) != 0U) return 0;
    return arm64_virtio_dma_region_valid(desc_addr, desc_size, 16U,
                                         window_begin, window_end) &&
           arm64_virtio_dma_region_valid(avail_addr, avail_size, 2U,
                                         window_begin, window_end) &&
           arm64_virtio_dma_region_valid(used_addr, used_size, 4U,
                                         window_begin, window_end) &&
           arm64_virtio_dma_region_valid(event_addr, event_size, 4U,
                                         window_begin, window_end);
}

#endif
