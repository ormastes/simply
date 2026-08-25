#define APP_TITLE "Simple Compiler"
#define APP_ID "/sys/apps/simple_compiler"
#define APP_CONTENT \
    "Simple Compiler\n\n" \
    "[Build Queue]\n" \
    "Frontend parse -> typecheck -> codegen\n\n" \
    "[Inputs]\n" \
    "Source root: /work\n" \
    "Target: native + bytecode artifacts\n\n" \
    "[Operator]\n" \
    "Confirm compile requests, diagnostics flow, and handoff to loader outputs."
#define APP_WIDTH 560
#define APP_HEIGHT 348
#define APP_POS_X 132
#define APP_POS_Y 92
#include "remote_window_runtime.c"
