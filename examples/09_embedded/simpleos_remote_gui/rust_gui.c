#define APP_TITLE "Rust"
#define APP_ID "/sys/apps/rust"
#define APP_WIDTH 536
#define APP_HEIGHT 332
#define APP_POS_X 308
#define APP_POS_Y 102

#define TOOLCHAIN_NAME "Rust"
#define TOOLCHAIN_VERSION_PATH "/SYS/RUSTVER.TXT"
#define TOOLCHAIN_MANIFEST_PATH "/SYS/RUSTMAN.TXT"
#define TOOLCHAIN_PRIMARY_PATH "/sys/apps/rust"
#define TOOLCHAIN_SECONDARY_PATH "/usr/share/simpleos/toolchain/rust/Cargo.toml"
#define TOOLCHAIN_CAPABILITY_PRIMARY "local-source-inspection"
#define TOOLCHAIN_CAPABILITY_PRIMARY_PROOF "/usr/share/simpleos/toolchain/rust/hello.rs"
#define TOOLCHAIN_CAPABILITY_SECONDARY "package-layout-inspection"
#define TOOLCHAIN_CAPABILITY_SECONDARY_PROOF "/usr/share/simpleos/toolchain/rust/Cargo.toml"
#define TOOLCHAIN_CAPABILITY_PIPELINE "build-pipeline-step"
#define TOOLCHAIN_CAPABILITY_PIPELINE_PROOF "/usr/share/simpleos/toolchain/rust/pipeline.step"

#include "toolchain_panel_runtime.c"

int main(int argc, char **argv) {
    int status = toolchain_pre_window_hook("rust");
    if (status != 0) {
        return status;
    }
    puts(toolchain_runtime_content(argc, argv));
    return 0;
}
