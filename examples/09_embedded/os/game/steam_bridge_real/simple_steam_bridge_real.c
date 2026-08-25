#include <stdint.h>
#include <stdlib.h>

#if defined(_WIN32)
#include <windows.h>
static HMODULE STEAM_LIB;
static void* steam_sym(const char* name) { return (void*)GetProcAddress(STEAM_LIB, name); }
static int steam_open(const char* path) {
    STEAM_LIB = LoadLibraryA(path);
    return STEAM_LIB != NULL;
}
#else
#include <dlfcn.h>
static void* STEAM_LIB;
static void* steam_sym(const char* name) { return dlsym(STEAM_LIB, name); }
static int steam_open(const char* path) {
    STEAM_LIB = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    return STEAM_LIB != NULL;
}
#endif

static const char* REQUIRED[] = {
    "SteamAPI_Init",
    "SteamAPI_Shutdown",
    "SteamAPI_RestartAppIfNecessary",
    "SteamAPI_RunCallbacks",
    "SteamAPI_GetHSteamUser",
    "SteamAPI_GetHSteamPipe",
    "SteamAPI_ISteamApps",
    "SteamAPI_ISteamFriends",
    "SteamAPI_ISteamInput",
    "SteamAPI_ISteamMatchmaking",
    "SteamAPI_ISteamNetworkingSockets",
    "SteamAPI_ISteamRemoteStorage",
    "SteamAPI_ISteamScreenshots",
    "SteamAPI_ISteamUGC",
    "SteamAPI_ISteamUser",
    "SteamAPI_ISteamUserStats",
    "SteamAPI_ISteamUtils",
    "SteamGameServer_Init",
    "SteamGameServer_Shutdown",
    "SteamInternal_CreateInterface",
};

static int steam_bridge_loaded(void) {
    if (STEAM_LIB != NULL) {
        return 1;
    }
    const char* env_path = getenv("SIMPLE_STEAMWORKS_LIB_PATH");
    if (env_path != NULL && env_path[0] != '\0' && steam_open(env_path)) {
        return 1;
    }
    const char* candidates[] = {
        "third_party/steamworks/redistributable_bin/linux64/libsteam_api.so",
        "sdk/steamworks/redistributable_bin/linux64/libsteam_api.so",
        "build/os/game/steam/libsteam_api.so",
        "build/os/game/steam/steam_api64.dll",
    };
    for (int i = 0; i < 4; i++) {
        if (steam_open(candidates[i])) {
            return 1;
        }
    }
    return 0;
}

static int steam_bridge_has_required_symbols(void) {
    if (!steam_bridge_loaded()) {
        return 0;
    }
    for (unsigned i = 0; i < sizeof(REQUIRED) / sizeof(REQUIRED[0]); i++) {
        if (steam_sym(REQUIRED[i]) == NULL) {
            return 0;
        }
    }
    return 1;
}

int32_t simple_steam_bridge_is_mock(void) { return 0; }
int32_t simple_steam_bridge_real_backend_ready(void) {
    return steam_bridge_has_required_symbols() ? 1 : 0;
}

int32_t SteamAPI_Init(void) {
    if (!steam_bridge_loaded()) {
        return 0;
    }
    int32_t (*fp)(void) = (int32_t (*)(void))steam_sym("SteamAPI_Init");
    return fp == NULL ? 0 : fp();
}

void SteamAPI_Shutdown(void) {
    if (!steam_bridge_loaded()) {
        return;
    }
    void (*fp)(void) = (void (*)(void))steam_sym("SteamAPI_Shutdown");
    if (fp != NULL) {
        fp();
    }
}

int32_t SteamAPI_RestartAppIfNecessary(uint32_t app_id) {
    if (!steam_bridge_loaded()) {
        return 0;
    }
    int32_t (*fp)(uint32_t) = (int32_t (*)(uint32_t))steam_sym("SteamAPI_RestartAppIfNecessary");
    return fp == NULL ? 0 : fp(app_id);
}

void SteamAPI_RunCallbacks(void) {}
int32_t SteamAPI_GetHSteamUser(void) { return steam_bridge_has_required_symbols() ? 1 : 0; }
int32_t SteamAPI_GetHSteamPipe(void) { return steam_bridge_has_required_symbols() ? 1 : 0; }
void* SteamAPI_ISteamApps(void) { return steam_sym("SteamAPI_ISteamApps"); }
void* SteamAPI_ISteamFriends(void) { return steam_sym("SteamAPI_ISteamFriends"); }
void* SteamAPI_ISteamInput(void) { return steam_sym("SteamAPI_ISteamInput"); }
void* SteamAPI_ISteamMatchmaking(void) { return steam_sym("SteamAPI_ISteamMatchmaking"); }
void* SteamAPI_ISteamNetworkingSockets(void) { return steam_sym("SteamAPI_ISteamNetworkingSockets"); }
void* SteamAPI_ISteamRemoteStorage(void) { return steam_sym("SteamAPI_ISteamRemoteStorage"); }
void* SteamAPI_ISteamScreenshots(void) { return steam_sym("SteamAPI_ISteamScreenshots"); }
void* SteamAPI_ISteamUGC(void) { return steam_sym("SteamAPI_ISteamUGC"); }
void* SteamAPI_ISteamUser(void) { return steam_sym("SteamAPI_ISteamUser"); }
void* SteamAPI_ISteamUserStats(void) { return steam_sym("SteamAPI_ISteamUserStats"); }
void* SteamAPI_ISteamUtils(void) { return steam_sym("SteamAPI_ISteamUtils"); }
int32_t SteamGameServer_Init(void) { return steam_bridge_has_required_symbols() ? 1 : 0; }
void SteamGameServer_Shutdown(void) {}
void* SteamInternal_CreateInterface(const char* version) {
    if (!steam_bridge_loaded()) {
        return 0;
    }
    void* (*fp)(const char*) = (void* (*)(const char*))steam_sym("SteamInternal_CreateInterface");
    return fp == NULL ? 0 : fp(version);
}
