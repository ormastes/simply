#define APP_TITLE "Simple Browser"
#define APP_ID "/sys/apps/simple_browser"
#define APP_CONTENT \
    "Simple Browser\n\n" \
    "[Viewport]\n" \
    "Render SMF pages from the remote app payload.\n\n" \
    "[Session]\n" \
    "Home: /www/index.smf\n" \
    "Transport: compositor IPC window\n\n" \
    "[Operator]\n" \
    "Use this shell to verify page load, layout text, and remote GUI wiring."
#define APP_WIDTH 540
#define APP_HEIGHT 336
#define APP_POS_X 88
#define APP_POS_Y 72
#include "remote_window_runtime.c"
