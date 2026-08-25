/* SimpleOS AArch64 scheduler instruction owner.
 *
 * Keep architecture instruction bridges out of the legacy monolithic boot
 * runtime.  This translation unit is linked into every ARM64 kernel build.
 */
#include <stdint.h>

typedef int64_t RuntimeValue;

RuntimeValue rt_arm64_wfe(void)
{
    __asm__ volatile("wfe" ::: "memory");
    return 0;
}
