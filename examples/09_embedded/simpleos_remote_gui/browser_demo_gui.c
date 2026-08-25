#define APP_TITLE "Browser Demo"
#define APP_ID "/sys/apps/browser_demo"
#define APP_CONTENT "Browser Demo\n\nFilesystem-backed user process.\nRemote window owned by its own PID."
#define APP_EVENT_CONTENT "Browser Demo\n\nPointer input reached the ring-3 browser client.\nThe WM content buffer was updated."
#define APP_EVENT_MARKER "[browser-demo-event] window="
#define APP_EVENT_MARKER_SUFFIX " input_received=true content_mutated=true\n"
#define APP_WIDTH 460
#define APP_HEIGHT 260
#include "remote_window_runtime.c"
