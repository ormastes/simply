# Simple Steam Real Bridge Skeleton

This bridge is the drop-in point for a real Valve Steamworks redistributable.
It is intentionally outside the default runtime link set.

Set `SIMPLE_STEAMWORKS_LIB_PATH` to a real `libsteam_api.so` or
`steam_api64.dll`, then build this bridge and point Simple at it with
`SIMPLE_STEAM_BRIDGE_PATH`.

```bash
mkdir -p build/os/game/steam
cc -shared -fPIC examples/os/game/steam_bridge_real/simple_steam_bridge_real.c \
  -ldl -o build/os/game/steam/libsimple_steam_bridge.so
bin/simple compile examples/os/game/steam_sffi_probe_demo.spl --native \
  -o build/os/game/steam/steam_sffi_probe_demo
SIMPLE_STEAMWORKS_LIB_PATH=/path/to/libsteam_api.so \
SIMPLE_STEAM_BRIDGE_PATH=$PWD/build/os/game/steam/libsimple_steam_bridge.so \
  build/os/game/steam/steam_sffi_probe_demo
```

Without the real Valve library and an authenticated Steam client environment,
the bridge remains `real_steam_backend=false`.
