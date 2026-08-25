#include <stddef.h>
#include <stdint.h>
#include "../../common/baremetal_runtime.h"

extern void *malloc(size_t size);
extern void serial_puts(const char *message);

__attribute__((noreturn)) static void simpleos_x86_fv_panic(const char *message)
{
    serial_puts("[PANIC] freestanding value registry: ");
    serial_puts(message);
    serial_puts("\r\n");
    for (;;) __asm__ volatile("cli; hlt");
}

#define SIMPLEOS_FV_ALLOC(size) malloc(size)
#define SIMPLEOS_FV_PANIC(message) simpleos_x86_fv_panic(message)
#include "../../common/boot/freestanding_value_registry_impl.h"
