#define rt_pci_device_count rt_desktop_pci_device_count
#define rt_pci_get_field rt_desktop_pci_get_field
#define rt_net_init rt_desktop_pci_net_init
#define rt_net_tx_test rt_desktop_pci_net_tx_test
#define rt_net_rx_ready rt_desktop_pci_net_rx_ready
#define rt_net_stats rt_desktop_pci_net_stats
#define rt_net_debug_stage rt_desktop_pci_net_debug_stage
#define rt_net_debug_queue_max rt_desktop_pci_net_debug_queue_max
#define rt_boot_tcp_bind_port rt_desktop_pci_boot_tcp_bind_port
#define rt_boot_tcp_accept_timeout rt_desktop_pci_boot_tcp_accept_timeout
#define rt_boot_tcp_write_auto rt_desktop_pci_boot_tcp_write_auto
#define rt_boot_tcp_send_ssh_banner rt_desktop_pci_boot_tcp_send_ssh_banner
#define rt_boot_tcp_close rt_desktop_pci_boot_tcp_close
#define rt_display_init rt_desktop_pci_display_init
#define rt_display_flush_test rt_desktop_pci_display_flush_test
#define rt_display_width rt_desktop_pci_display_width
#define rt_display_height rt_desktop_pci_display_height
#include "../../../../../../src/os/kernel/arch/riscv64/boot/freestanding_runtime.c"

spl_i64 rt_riscv_harden_canary_value(void) {
    return 0x5a17d35c;
}

spl_i64 rt_riscv_nvfs_probe(void) {
    return 1;
}

spl_i64 rt_riscv_smf_cli_probe(void) {
    return 1;
}

spl_i64 rt_riscv_smf_cli_load(void) {
    return 1;
}

spl_i64 rt_riscv_smf_gui_probe(void) {
    return 1;
}

spl_i64 rt_riscv_native_gui_process_render(void) {
    return 1;
}

extern spl_i64 desktop_service_entry__spl_start(void) __attribute__((weak));

spl_i64 spl_start(void) __attribute__((weak));
spl_i64 spl_start(void) {
    if (desktop_service_entry__spl_start) {
        return desktop_service_entry__spl_start();
    }
    return 0;
}
