#define APP_TITLE "Simple Interpreter"
#define APP_ID "/sys/apps/simple_interpreter"
#define APP_CONTENT \
    "Simple Interpreter\n\n" \
    "[Execution]\n" \
    "Run source or bytecode in the active VM session.\n\n" \
    "[State]\n" \
    "Entry: main()\n" \
    "Trace: locals, stack, exit status\n\n" \
    "[Operator]\n" \
    "Use this panel to watch execution handoff and runtime result reporting."
#define APP_WIDTH 548
#define APP_HEIGHT 340
#define APP_POS_X 176
#define APP_POS_Y 108
#include "remote_window_runtime.c"
