#define APP_TITLE "Clang"
#define APP_ID "/sys/apps/clang"
#define APP_WIDTH 544
#define APP_HEIGHT 336
#define APP_POS_X 264
#define APP_POS_Y 86

#define TOOLCHAIN_NAME "Clang"
#define TOOLCHAIN_VERSION_PATH "/SYS/CLANGVER.TXT"
#define TOOLCHAIN_MANIFEST_PATH "/SYS/CLANGMAN.TXT"
#define TOOLCHAIN_PRIMARY_PATH "/sys/apps/clang"
#define TOOLCHAIN_SECONDARY_PATH "/usr/share/simpleos/toolchain/clang/flags.rsp"
#define TOOLCHAIN_CAPABILITY_PRIMARY "local-c-source-inspection"
#define TOOLCHAIN_CAPABILITY_PRIMARY_PROOF "/usr/share/simpleos/toolchain/clang/hello.c"
#define TOOLCHAIN_CAPABILITY_SECONDARY "driver-flag-inspection"
#define TOOLCHAIN_CAPABILITY_SECONDARY_PROOF "/usr/share/simpleos/toolchain/clang/flags.rsp"
#define TOOLCHAIN_CAPABILITY_PIPELINE "compile-pipeline-step"
#define TOOLCHAIN_CAPABILITY_PIPELINE_PROOF "/usr/share/simpleos/toolchain/clang/pipeline.step"

#include "toolchain_panel_runtime.c"

int main(int argc, char **argv) {
    int status = toolchain_pre_window_hook("clang");
    if (status != 0) {
        return status;
    }
    puts(toolchain_runtime_content(argc, argv));
    return 0;
}
