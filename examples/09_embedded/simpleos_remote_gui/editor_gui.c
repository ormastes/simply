#include <stdio.h>
#include <string.h>
#include <unistd.h>

static int editor_pre_window_hook(void) {
    const char *path = "/EDITOR.TXT";
    const char *content = "editor saved from real gui process";
    char verify[128];
    pid_t pid = getpid();

    FILE *fp = fopen(path, "w");
    if (!fp) {
        printf("[desktop-e2e] editor-save:fail pid=%d reason=open_write_failed\n", (int)pid);
        printf("[desktop-e2e] editor-launch:fail pid=%d reason=open_write_failed\n", (int)pid);
        return 11;
    }
    size_t wrote = fwrite(content, 1, strlen(content), fp);
    fclose(fp);
    if (wrote != strlen(content)) {
        printf("[desktop-e2e] editor-save:fail pid=%d reason=short_write\n", (int)pid);
        printf("[desktop-e2e] editor-launch:fail pid=%d reason=short_write\n", (int)pid);
        return 12;
    }

    memset(verify, 0, sizeof(verify));
    fp = fopen(path, "r");
    if (!fp) {
        printf("[desktop-e2e] editor-save:fail pid=%d reason=open_read_failed\n", (int)pid);
        printf("[desktop-e2e] editor-launch:fail pid=%d reason=open_read_failed\n", (int)pid);
        printf("[desktop-e2e] cli-verify:fail pid=%d reason=open_read_failed\n", (int)pid);
        return 13;
    }
    size_t read_n = fread(verify, 1, sizeof(verify) - 1, fp);
    fclose(fp);
    verify[read_n] = '\0';
    if (strcmp(verify, content) != 0) {
        printf("[desktop-e2e] editor-save:fail pid=%d reason=content_mismatch\n", (int)pid);
        printf("[desktop-e2e] editor-launch:fail pid=%d reason=content_mismatch\n", (int)pid);
        printf("[desktop-e2e] cli-verify:fail pid=%d reason=content_mismatch\n", (int)pid);
        return 14;
    }

    printf("[desktop-e2e] editor-save:ok pid=%d path=%s\n", (int)pid, path);
    printf("[desktop-e2e] cli-verify:ok pid=%d path=%s content=%s\n", (int)pid, path, verify);
    return 0;
}

#define APP_TITLE "Editor"
#define APP_ID "/sys/apps/editor"
#define APP_CONTENT "Editor\n\nFilesystem-backed user process.\nSaved /EDITOR.TXT before opening this window."
#define APP_WIDTH 760
#define APP_HEIGHT 420
#define APP_POS_X 140
#define APP_POS_Y 100
#define APP_PRE_WINDOW_HOOK() editor_pre_window_hook()
#include "remote_window_runtime.c"
