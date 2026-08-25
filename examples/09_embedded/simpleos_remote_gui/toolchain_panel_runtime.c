#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>

#ifndef TOOLCHAIN_NAME
#define TOOLCHAIN_NAME "Toolchain"
#endif

#ifndef TOOLCHAIN_VERSION_PATH
#define TOOLCHAIN_VERSION_PATH "/SYS/VERSION.TXT"
#endif

#ifndef TOOLCHAIN_MANIFEST_PATH
#define TOOLCHAIN_MANIFEST_PATH "/SYS/MANIFEST.TXT"
#endif

#ifndef TOOLCHAIN_PRIMARY_PATH
#define TOOLCHAIN_PRIMARY_PATH "/usr/bin/tool"
#endif

#ifndef TOOLCHAIN_SECONDARY_PATH
#define TOOLCHAIN_SECONDARY_PATH ""
#endif

#ifndef TOOLCHAIN_CAPABILITY_PRIMARY
#define TOOLCHAIN_CAPABILITY_PRIMARY "local-inspection"
#endif

#ifndef TOOLCHAIN_CAPABILITY_PRIMARY_PROOF
#define TOOLCHAIN_CAPABILITY_PRIMARY_PROOF "/SYS/CAPABILITY-PRIMARY.TXT"
#endif

#ifndef TOOLCHAIN_CAPABILITY_SECONDARY
#define TOOLCHAIN_CAPABILITY_SECONDARY "asset-inspection"
#endif

#ifndef TOOLCHAIN_CAPABILITY_SECONDARY_PROOF
#define TOOLCHAIN_CAPABILITY_SECONDARY_PROOF "/SYS/CAPABILITY-SECONDARY.TXT"
#endif

#ifndef TOOLCHAIN_CAPABILITY_PIPELINE
#define TOOLCHAIN_CAPABILITY_PIPELINE "pipeline-step"
#endif

#ifndef TOOLCHAIN_CAPABILITY_PIPELINE_PROOF
#define TOOLCHAIN_CAPABILITY_PIPELINE_PROOF "/SYS/CAPABILITY-PIPELINE.TXT"
#endif

static int _toolchain_file_exists(const char *path) {
    return path != NULL && path[0] != '\0' && access(path, F_OK) == 0;
}

static void _toolchain_read_first_line(const char *path, char *out, size_t cap) {
    int fd;
    ssize_t n;
    size_t i;
    if (cap == 0) {
        return;
    }
    out[0] = '\0';
    if (!_toolchain_file_exists(path)) {
        return;
    }
    fd = open(path, O_RDONLY);
    if (fd < 0) {
        return;
    }
    n = read(fd, out, cap - 1);
    close(fd);
    if (n <= 0) {
        out[0] = '\0';
        return;
    }
    out[(size_t)n] = '\0';
    for (i = 0; out[i] != '\0'; ++i) {
        if (out[i] == '\n' || out[i] == '\r') {
            out[i] = '\0';
            break;
        }
    }
}

static void _toolchain_read_manifest_value(const char *path, const char *key, char *out, size_t cap) {
    int fd;
    ssize_t n;
    char buffer[2048];
    size_t key_len;
    char *line_start;
    char *line_end;
    if (cap == 0) {
        return;
    }
    out[0] = '\0';
    if (!_toolchain_file_exists(path)) {
        return;
    }
    fd = open(path, O_RDONLY);
    if (fd < 0) {
        return;
    }
    n = read(fd, buffer, sizeof(buffer) - 1);
    close(fd);
    if (n <= 0) {
        return;
    }
    buffer[(size_t)n] = '\0';
    key_len = strlen(key);
    line_start = buffer;
    while (line_start != NULL && *line_start != '\0') {
        line_end = strchr(line_start, '\n');
        if (line_end != NULL) {
            *line_end = '\0';
        }
        while (*line_start == ' ' || *line_start == '\t' || *line_start == '\r') {
            ++line_start;
        }
        if (strncmp(line_start, key, key_len) == 0 && line_start[key_len] == '=') {
            snprintf(out, cap, "%s", line_start + key_len + 1);
            {
                size_t i;
                for (i = 0; out[i] != '\0'; ++i) {
                    if (out[i] == '\r') {
                        out[i] = '\0';
                        break;
                    }
                }
            }
            return;
        }
        if (line_end == NULL) {
            break;
        }
        line_start = line_end + 1;
    }
}

static const char *toolchain_runtime_content(int argc, char **argv) {
    static char content[2048];
    char version[256];
    char lane[128];
    char mode[128];
    char status[128];
    const int has_cap_primary = _toolchain_file_exists(TOOLCHAIN_CAPABILITY_PRIMARY_PROOF);
    const int has_cap_secondary = _toolchain_file_exists(TOOLCHAIN_CAPABILITY_SECONDARY_PROOF);
    const int has_cap_pipeline = _toolchain_file_exists(TOOLCHAIN_CAPABILITY_PIPELINE_PROOF);
    const int has_primary = _toolchain_file_exists(TOOLCHAIN_PRIMARY_PATH);
    const int has_secondary = (TOOLCHAIN_SECONDARY_PATH[0] == '\0') || _toolchain_file_exists(TOOLCHAIN_SECONDARY_PATH);
    (void)argc;
    (void)argv;

    _toolchain_read_first_line(TOOLCHAIN_VERSION_PATH, version, sizeof(version));
    _toolchain_read_manifest_value(TOOLCHAIN_MANIFEST_PATH, "lane", lane, sizeof(lane));
    _toolchain_read_manifest_value(TOOLCHAIN_MANIFEST_PATH, "mode", mode, sizeof(mode));
    _toolchain_read_manifest_value(TOOLCHAIN_MANIFEST_PATH, "status", status, sizeof(status));
    if (version[0] == '\0') {
        snprintf(version, sizeof(version), "version metadata missing");
    }
    if (lane[0] == '\0') {
        snprintf(lane, sizeof(lane), "unknown");
    }
    if (mode[0] == '\0') {
        snprintf(mode, sizeof(mode), "unknown");
    }
    if (status[0] == '\0') {
        snprintf(status, sizeof(status), "unknown");
    }

    snprintf(
        content,
        sizeof(content),
        "%s\n\n[Filesystem Payload]\nprimary: %s (%s)\nsecondary: %s (%s)\nmanifest: %s\n\n[Standalone Contract]\nlane: %s\nmode: %s\nstatus: %s\n\n[Capabilities]\n%s -> %s (%s)\n%s -> %s (%s)\n%s -> %s (%s)\n\n[Version]\n%s",
        TOOLCHAIN_NAME,
        TOOLCHAIN_PRIMARY_PATH,
        has_primary ? "present" : "missing",
        TOOLCHAIN_SECONDARY_PATH[0] == '\0' ? "(none)" : TOOLCHAIN_SECONDARY_PATH,
        has_secondary ? "present" : "missing",
        TOOLCHAIN_MANIFEST_PATH,
        lane,
        mode,
        status,
        TOOLCHAIN_CAPABILITY_PRIMARY,
        TOOLCHAIN_CAPABILITY_PRIMARY_PROOF,
        has_cap_primary ? "present" : "missing",
        TOOLCHAIN_CAPABILITY_SECONDARY,
        TOOLCHAIN_CAPABILITY_SECONDARY_PROOF,
        has_cap_secondary ? "present" : "missing",
        TOOLCHAIN_CAPABILITY_PIPELINE,
        TOOLCHAIN_CAPABILITY_PIPELINE_PROOF,
        has_cap_pipeline ? "present" : "missing",
        version
    );
    return content;
}

static int toolchain_pre_window_hook(const char *app_id) {
    char version[256];
    char lane[128];
    char mode[128];
    char status[128];
    if (!_toolchain_file_exists(TOOLCHAIN_PRIMARY_PATH)) {
        printf("[desktop-e2e] toolchain-launch:fail app=%s reason=missing-primary path=%s\n", app_id, TOOLCHAIN_PRIMARY_PATH);
        return 21;
    }
    if (TOOLCHAIN_SECONDARY_PATH[0] != '\0' && !_toolchain_file_exists(TOOLCHAIN_SECONDARY_PATH)) {
        printf("[desktop-e2e] toolchain-launch:fail app=%s reason=missing-secondary path=%s\n", app_id, TOOLCHAIN_SECONDARY_PATH);
        return 22;
    }
    if (!_toolchain_file_exists(TOOLCHAIN_MANIFEST_PATH)) {
        printf("[desktop-e2e] toolchain-launch:fail app=%s reason=missing-manifest path=%s\n", app_id, TOOLCHAIN_MANIFEST_PATH);
        return 23;
    }
    _toolchain_read_first_line(TOOLCHAIN_VERSION_PATH, version, sizeof(version));
    _toolchain_read_manifest_value(TOOLCHAIN_MANIFEST_PATH, "lane", lane, sizeof(lane));
    _toolchain_read_manifest_value(TOOLCHAIN_MANIFEST_PATH, "mode", mode, sizeof(mode));
    _toolchain_read_manifest_value(TOOLCHAIN_MANIFEST_PATH, "status", status, sizeof(status));
    if (version[0] == '\0') {
        printf("[desktop-e2e] toolchain-launch:fail app=%s reason=missing-version path=%s\n", app_id, TOOLCHAIN_VERSION_PATH);
        return 24;
    }
    if (lane[0] == '\0') {
        snprintf(lane, sizeof(lane), "unknown");
    }
    if (mode[0] == '\0') {
        snprintf(mode, sizeof(mode), "unknown");
    }
    if (status[0] == '\0') {
        snprintf(status, sizeof(status), "unknown");
    }
    printf("[desktop-e2e] native-toolchain-launch:ok app=%s lane=%s mode=%s status=%s tool=%s manifest=%s version=%s\n",
           app_id, lane, mode, status, TOOLCHAIN_PRIMARY_PATH, TOOLCHAIN_MANIFEST_PATH, version);
    if (_toolchain_file_exists(TOOLCHAIN_CAPABILITY_PRIMARY_PROOF)) {
        printf("[desktop-e2e] native-capability:ok app=%s capability=%s proof=%s\n",
               app_id, TOOLCHAIN_CAPABILITY_PRIMARY, TOOLCHAIN_CAPABILITY_PRIMARY_PROOF);
    } else {
        printf("[desktop-e2e] native-capability:fail app=%s capability=%s proof=%s\n",
               app_id, TOOLCHAIN_CAPABILITY_PRIMARY, TOOLCHAIN_CAPABILITY_PRIMARY_PROOF);
        return 25;
    }
    if (_toolchain_file_exists(TOOLCHAIN_CAPABILITY_SECONDARY_PROOF)) {
        printf("[desktop-e2e] native-capability:ok app=%s capability=%s proof=%s\n",
               app_id, TOOLCHAIN_CAPABILITY_SECONDARY, TOOLCHAIN_CAPABILITY_SECONDARY_PROOF);
    } else {
        printf("[desktop-e2e] native-capability:fail app=%s capability=%s proof=%s\n",
               app_id, TOOLCHAIN_CAPABILITY_SECONDARY, TOOLCHAIN_CAPABILITY_SECONDARY_PROOF);
        return 26;
    }
    if (_toolchain_file_exists(TOOLCHAIN_CAPABILITY_PIPELINE_PROOF)) {
        printf("[desktop-e2e] native-capability:ok app=%s capability=%s proof=%s\n",
               app_id, TOOLCHAIN_CAPABILITY_PIPELINE, TOOLCHAIN_CAPABILITY_PIPELINE_PROOF);
    } else {
        printf("[desktop-e2e] native-capability:fail app=%s capability=%s proof=%s\n",
               app_id, TOOLCHAIN_CAPABILITY_PIPELINE, TOOLCHAIN_CAPABILITY_PIPELINE_PROOF);
        return 27;
    }
    return 0;
}
