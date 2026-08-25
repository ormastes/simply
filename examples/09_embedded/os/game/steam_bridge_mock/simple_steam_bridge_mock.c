#include <stdint.h>

int32_t simple_steam_bridge_is_mock(void) { return 1; }
int32_t simple_steam_bridge_real_backend_ready(void) { return 0; }

int32_t SteamAPI_Init(void) { return 1; }
void SteamAPI_Shutdown(void) {}
int32_t SteamAPI_RestartAppIfNecessary(uint32_t app_id) {
    (void)app_id;
    return 0;
}
void SteamAPI_RunCallbacks(void) {}
int32_t SteamAPI_GetHSteamUser(void) { return 1; }
int32_t SteamAPI_GetHSteamPipe(void) { return 1; }

void* SteamAPI_ISteamApps(void) { return (void*)1; }
void* SteamAPI_ISteamFriends(void) { return (void*)1; }
void* SteamAPI_ISteamInput(void) { return (void*)1; }
void* SteamAPI_ISteamMatchmaking(void) { return (void*)1; }
void* SteamAPI_ISteamNetworkingSockets(void) { return (void*)1; }
void* SteamAPI_ISteamRemoteStorage(void) { return (void*)1; }
void* SteamAPI_ISteamScreenshots(void) { return (void*)1; }
void* SteamAPI_ISteamUGC(void) { return (void*)1; }
void* SteamAPI_ISteamUser(void) { return (void*)1; }
void* SteamAPI_ISteamUserStats(void) { return (void*)1; }
void* SteamAPI_ISteamUtils(void) { return (void*)1; }

int32_t SteamGameServer_Init(void) { return 1; }
void SteamGameServer_Shutdown(void) {}
void* SteamInternal_CreateInterface(const char* version) {
    (void)version;
    return (void*)1;
}
