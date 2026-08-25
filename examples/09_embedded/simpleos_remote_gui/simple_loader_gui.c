#include <stddef.h>

#define APP_TITLE "Simple Loader"
#define APP_ID "/sys/apps/simple_loader"
#define APP_CONTENT "Simple Loader\n\nPreparing launch-resolution inspector..."
#define APP_WIDTH 552
#define APP_HEIGHT 344
#define APP_POS_X 220
#define APP_POS_Y 124

typedef struct loader_launch_candidate {
    const char *label;
    const char *canonical_path;
    const char *launch_path;
    const char *seed_alias;
} loader_launch_candidate_t;

static char g_loader_content[1900];

static char _loader_ascii_lower(char ch) {
    if (ch >= 'A' && ch <= 'Z') {
        return (char)(ch + ('a' - 'A'));
    }
    return ch;
}

static int _loader_is_name_char(char ch) {
    return ((ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9'));
}

static size_t _loader_normalize_token(const char *src, char *dst, size_t cap) {
    size_t out = 0;
    if (cap == 0) {
        return 0;
    }
    while (*src != '\0' && out + 1 < cap) {
        char ch = _loader_ascii_lower(*src++);
        if (_loader_is_name_char(ch)) {
            dst[out++] = ch;
        }
    }
    dst[out] = '\0';
    return out;
}

static int _loader_text_contains(const char *haystack, const char *needle) {
    size_t i = 0;
    size_t j = 0;
    if (needle[0] == '\0') {
        return 1;
    }
    while (haystack[i] != '\0') {
        j = 0;
        while (needle[j] != '\0' && haystack[i + j] == needle[j]) {
            j++;
        }
        if (needle[j] == '\0') {
            return 1;
        }
        i++;
    }
    return 0;
}

static int _loader_text_equals(const char *left, const char *right) {
    size_t i = 0;
    while (left[i] != '\0' && right[i] != '\0') {
        if (left[i] != right[i]) {
            return 0;
        }
        i++;
    }
    return left[i] == right[i];
}

static void _loader_append_text(char *dst, size_t cap, size_t *len, const char *src) {
    while (*src != '\0' && *len + 1 < cap) {
        dst[*len] = *src;
        *len = *len + 1;
        src++;
    }
    if (cap > 0) {
        dst[*len] = '\0';
    }
}

static void _loader_append_line(char *dst, size_t cap, size_t *len, const char *src) {
    _loader_append_text(dst, cap, len, src);
    _loader_append_text(dst, cap, len, "\n");
}

static const loader_launch_candidate_t * _loader_candidates(size_t *count_out) {
    static const loader_launch_candidate_t kCandidates[] = {
        {"Hello World", "/sys/apps/hello_world", "/sys/apps/hello_world.smf", ""},
        {"File Manager", "/sys/apps/file_manager", "/sys/apps/file_manager.smf", ""},
        {"Terminal", "/sys/apps/shell", "/sys/apps/shell.smf", ""},
        {"Browser Demo", "/sys/apps/browser_demo", "/sys/apps/browser_demo.smf", ""},
        {"Editor", "/sys/apps/editor", "/sys/apps/editor.smf", ""},
        {"Simple Browser", "/sys/apps/simple_browser", "/sys/apps/simple_browser.smf", "/sys/apps/sbrowser.smf"},
        {"Simple Compiler", "/sys/apps/simple_compiler", "/sys/apps/simple_compiler.smf", "/sys/apps/scompiler.smf"},
        {"Simple Interpreter", "/sys/apps/simple_interpreter", "/sys/apps/simple_interpreter.smf", "/sys/apps/sinterp.smf"},
        {"Simple Loader", "/sys/apps/simple_loader", "/sys/apps/simple_loader.smf", "/sys/apps/sloader.smf"},
        {"LLVM", "/sys/apps/llvm", "/sys/apps/llvm.smf", ""},
        {"Rust", "/sys/apps/rust", "/sys/apps/rust.smf", ""},
    };
    *count_out = sizeof(kCandidates) / sizeof(kCandidates[0]);
    return kCandidates;
}

static int _loader_match_score(const loader_launch_candidate_t *candidate,
                               const char *query,
                               const char **reason_out) {
    char normalized_query[80];
    char normalized_label[80];
    char normalized_canonical[80];
    char normalized_launch[80];
    char normalized_alias[80];

    if (query == (const char *)0 || query[0] == '\0') {
        if (_loader_text_equals(candidate->canonical_path, "/sys/apps/simple_loader")) {
            *reason_out = "default shell target";
            return 40;
        }
        *reason_out = "seeded fallback";
        return 0;
    }

    _loader_normalize_token(query, normalized_query, sizeof(normalized_query));
    _loader_normalize_token(candidate->label, normalized_label, sizeof(normalized_label));
    _loader_normalize_token(candidate->canonical_path, normalized_canonical, sizeof(normalized_canonical));
    _loader_normalize_token(candidate->launch_path, normalized_launch, sizeof(normalized_launch));
    _loader_normalize_token(candidate->seed_alias, normalized_alias, sizeof(normalized_alias));

    if (normalized_query[0] == '\0') {
        *reason_out = "empty target";
        return 0;
    }
    if (_loader_text_contains(normalized_canonical, normalized_query) &&
        _loader_text_contains(normalized_query, normalized_canonical)) {
        *reason_out = "exact canonical path";
        return 100;
    }
    if (_loader_text_contains(normalized_launch, normalized_query) &&
        _loader_text_contains(normalized_query, normalized_launch)) {
        *reason_out = "exact launch path";
        return 95;
    }
    if (normalized_alias[0] != '\0' &&
        _loader_text_contains(normalized_alias, normalized_query) &&
        _loader_text_contains(normalized_query, normalized_alias)) {
        *reason_out = "exact seeded alias";
        return 92;
    }
    if (_loader_text_contains(normalized_label, normalized_query) &&
        _loader_text_contains(normalized_query, normalized_label)) {
        *reason_out = "exact app name";
        return 90;
    }
    if (_loader_text_contains(normalized_canonical, normalized_query)) {
        *reason_out = "canonical path match";
        return 75;
    }
    if (_loader_text_contains(normalized_launch, normalized_query)) {
        *reason_out = "launch path match";
        return 70;
    }
    if (normalized_alias[0] != '\0' && _loader_text_contains(normalized_alias, normalized_query)) {
        *reason_out = "seeded alias match";
        return 68;
    }
    if (_loader_text_contains(normalized_label, normalized_query)) {
        *reason_out = "name match";
        return 65;
    }

    *reason_out = "no match";
    return 0;
}

static const loader_launch_candidate_t * _loader_select_candidate(const char *query,
                                                                  const char **reason_out) {
    size_t count = 0;
    size_t i = 0;
    int best_score = -1;
    const char *best_reason = "seeded fallback";
    const loader_launch_candidate_t *best = (const loader_launch_candidate_t *)0;
    const loader_launch_candidate_t *candidates = _loader_candidates(&count);

    for (i = 0; i < count; i++) {
        const char *candidate_reason = "no match";
        int score = _loader_match_score(&candidates[i], query, &candidate_reason);
        if (score > best_score) {
            best_score = score;
            best_reason = candidate_reason;
            best = &candidates[i];
        }
    }

    if (best == (const loader_launch_candidate_t *)0) {
        best = &candidates[0];
    }
    *reason_out = best_reason;
    return best;
}

static const char *loader_runtime_content(int argc, char **argv) {
    const char *query = (const char *)0;
    const char *reason = "seeded fallback";
    const loader_launch_candidate_t *selected = _loader_select_candidate(query, &reason);
    const loader_launch_candidate_t *candidates = (const loader_launch_candidate_t *)0;
    size_t count = 0;
    size_t i = 0;
    size_t len = 0;

    (void)argc;
    (void)argv;

    g_loader_content[0] = '\0';

    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, "Simple Loader");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, "");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, "[Launch Resolution]");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, "Target: /sys/apps/simple_loader");
    _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, "Selected: ");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, selected->label);
    _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, "Launch path: ");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, selected->launch_path);
    _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, "Canonical app: ");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, selected->canonical_path);
    if (selected->seed_alias[0] != '\0') {
        _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, "Seed alias: ");
        _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, selected->seed_alias);
    }
    _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, "Decision: ");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, reason);
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, "");
    _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, "[Seeded Candidates]");

    candidates = _loader_candidates(&count);
    for (i = 0; i < count; i++) {
        _loader_append_text(g_loader_content, sizeof(g_loader_content), &len,
                            (&candidates[i] == selected) ? "* " : "  ");
        _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, candidates[i].label);
        _loader_append_text(g_loader_content, sizeof(g_loader_content), &len, " -> ");
        _loader_append_line(g_loader_content, sizeof(g_loader_content), &len, candidates[i].launch_path);
    }

    return g_loader_content;
}

#define APP_RUNTIME_CONTENT(argc, argv) loader_runtime_content((argc), (argv))

#include "remote_window_runtime.c"
