/* Fail-closed optional-backend authority for the x86-64 SimpleOS guest.
 *
 * These symbols are retained by target-neutral backend objects even when the
 * bare-metal guest selects its CPU/framebuffer renderer.  Returning success
 * would fabricate a GPU, dynamic loader, or font provider.  Availability and
 * query functions therefore report unavailable/empty; operational functions
 * return a disjoint failure value.  The real Vulkan showcase runs in the
 * headless host container and is captured separately from this guest capsule.
 */
#include <stdint.h>

#define SPL_NIL ((int64_t)3)
#define UNAVAILABLE(name) int64_t name() { return -1; }
#define ABSENT(name) int64_t name() { return 0; }

extern void rt_thread_sleep(int64_t millis);
extern int64_t rt_string_new_literal(const uint8_t *bytes, int64_t len);
extern int64_t rt_enum_new(int32_t enum_id, int32_t discriminant, int64_t payload);

/* Canonical trait-default owner retained by Cranelift's existential
 * BlockDevice dispatch. Result uses enum id 2 and the stable Err hash shared
 * by simple-core/runtime_native.c; this is a real error value, not a nil stub. */
int64_t
src__lib__nogc_sync_mut__fs_driver__block_device__BlockDevice_dot_flush(int64_t receiver) {
    static const uint8_t message[] = "block device does not support durable flush";
    (void)receiver;
    return rt_enum_new(2, (int32_t)4200179024u,
                       rt_string_new_literal(message, (int64_t)(sizeof(message) - 1)));
}

double ceil(double value) {
    if (value != value || value >= 9223372036854775807.0 ||
        value <= -9223372036854775807.0) return value;
    int64_t whole = (int64_t)value;
    if ((double)whole < value) whole += 1;
    return (double)whole;
}

void rt_sleep_nanos(int64_t nanos) {
    if (nanos <= 0) return;
    int64_t millis = nanos / 1000000;
    if ((nanos % 1000000) != 0) millis += 1;
    rt_thread_sleep(millis);
}

/* Exact portable fallback signals. */
int64_t rt_gui_blend_span4(int64_t xy, int64_t src, int64_t offset, int64_t count) {
    (void)xy; (void)src; (void)offset; (void)count;
    return 0;
}
int64_t rt_engine2d_simd_fill_row_u32(int64_t count, int64_t color) {
    (void)count; (void)color;
    return SPL_NIL;
}
int64_t rt_simd_engine2d_neon_hits(void) { return 0; }

/* Font/vector providers are absent; callers retain bitmap/fallback shaping. */
ABSENT(rt_font_load_array)
ABSENT(rt_font_glyph_index)
ABSENT(spl_fonts_call_init_blob)
ABSENT(spl_fonts_call_init_path)
ABSENT(spl_fonts_call_layout_text)

int64_t spl_dlopen_checked(int64_t path, int64_t *out_handle) {
    (void)path;
    if (out_handle) *out_handle = 0;
    return 2;
}
int64_t spl_dlsym_checked(int64_t handle, int64_t name, int64_t *out_symbol) {
    (void)handle; (void)name;
    if (out_symbol) *out_symbol = 0;
    return 2;
}

/* CUDA is not a guest backend. */
UNAVAILABLE(rt_cuda_module_load_data_array)
UNAVAILABLE(rt_cuda_launch_kernel_name_array)

/* Metal and ROCm are not guest backends. */
UNAVAILABLE(rt_metal_buffer_download_raw)
UNAVAILABLE(rt_metal_buffer_upload_raw)
UNAVAILABLE(rt_metal_destroy_command_buffer)
UNAVAILABLE(rt_metal_run_compute_frame)
UNAVAILABLE(rt_metal_set_bytes_raw)
int64_t rt_rocm_device_identity(void) { return SPL_NIL; }

/* OpenCL availability is false; every operation fails explicitly. */
ABSENT(rt_opencl_is_available)
ABSENT(rt_opencl_platform_count)
UNAVAILABLE(rt_opencl_build_program)
UNAVAILABLE(rt_opencl_create_context)
UNAVAILABLE(rt_opencl_create_kernel)
UNAVAILABLE(rt_opencl_create_program)
UNAVAILABLE(rt_opencl_create_queue)
UNAVAILABLE(rt_opencl_enqueue_ndrange)
UNAVAILABLE(rt_opencl_finish)
UNAVAILABLE(rt_opencl_mem_alloc)
UNAVAILABLE(rt_opencl_mem_free)
UNAVAILABLE(rt_opencl_read_buffer)
UNAVAILABLE(rt_opencl_release_context)
UNAVAILABLE(rt_opencl_release_kernel)
UNAVAILABLE(rt_opencl_release_program)
UNAVAILABLE(rt_opencl_release_queue)
UNAVAILABLE(rt_opencl_set_kernel_arg_buffer)
UNAVAILABLE(rt_opencl_set_kernel_arg_i64)
UNAVAILABLE(rt_opencl_write_buffer)
UNAVAILABLE(rt_opencl_write_buffer_at)

/* Host GPU queue is absent; counters are honest zero and mutations fail. */
ABSENT(rt_host_gpu_queue_submitted_count)
ABSENT(rt_host_gpu_queue_completed_count)
UNAVAILABLE(rt_host_gpu_queue_drain)
UNAVAILABLE(rt_host_gpu_queue_emit_payload_text)
UNAVAILABLE(rt_host_gpu_queue_last_backend_handle)
UNAVAILABLE(rt_host_gpu_queue_last_payload_hash)
UNAVAILABLE(rt_host_gpu_queue_last_payload_size)
int64_t rt_host_gpu_queue_last_payload_text(void) { return SPL_NIL; }
UNAVAILABLE(rt_host_gpu_queue_last_status)

/* Host Vulkan SFFI is unavailable inside SimpleOS.  The guest's framebuffer
 * path remains authoritative; any accidental host-Vulkan operation fails. */
UNAVAILABLE(rt_vulkan_copy_from_buffer_array)
UNAVAILABLE(rt_vulkan_copy_from_buffer_regions)
UNAVAILABLE(rt_vulkan_copy_from_buffer_strided)
UNAVAILABLE(rt_vulkan_copy_to_buffer_array)
UNAVAILABLE(rt_vulkan_dependency_quarantine_lock)
UNAVAILABLE(rt_vulkan_dependency_quarantine_unlock)
UNAVAILABLE(rt_vulkan_discard_command)
ABSENT(rt_vulkan_fence_submission_supported)
UNAVAILABLE(rt_vulkan_push_constants_array)
UNAVAILABLE(rt_vulkan_read_buffer_bytes)
UNAVAILABLE(rt_vulkan_submit_and_wait_fence)
