#define APP_TITLE "LLVM"
#define APP_ID "/sys/apps/llvm"
#define APP_WIDTH 544
#define APP_HEIGHT 336
#define APP_POS_X 264
#define APP_POS_Y 86

#define TOOLCHAIN_NAME "LLVM"
#define TOOLCHAIN_VERSION_PATH "/SYS/LLVMVER.TXT"
#define TOOLCHAIN_MANIFEST_PATH "/SYS/LLVMMAN.TXT"
#define TOOLCHAIN_PRIMARY_PATH "/sys/apps/llvm"
#define TOOLCHAIN_SECONDARY_PATH "/usr/share/simpleos/toolchain/llvm/hello.s"
#define TOOLCHAIN_CAPABILITY_PRIMARY "local-ir-inspection"
#define TOOLCHAIN_CAPABILITY_PRIMARY_PROOF "/usr/share/simpleos/toolchain/llvm/hello.ll"
#define TOOLCHAIN_CAPABILITY_SECONDARY "object-assembly-inspection"
#define TOOLCHAIN_CAPABILITY_SECONDARY_PROOF "/usr/share/simpleos/toolchain/llvm/hello.s"
#define TOOLCHAIN_CAPABILITY_PIPELINE "compile-pipeline-step"
#define TOOLCHAIN_CAPABILITY_PIPELINE_PROOF "/usr/share/simpleos/toolchain/llvm/pipeline.step"

#include "toolchain_panel_runtime.c"

int main(int argc, char **argv) {
    int status = toolchain_pre_window_hook("llvm");
    if (status != 0) {
        return status;
    }
    puts(toolchain_runtime_content(argc, argv));
    return 0;
}
