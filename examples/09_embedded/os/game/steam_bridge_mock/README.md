# Simple Steam SFFI Bridge Fixture

This fixture is a local mock shared library for validating Simple's dynamic
Steam SFFI path. It exports the twenty Steamworks symbol names required by
`src/os/game/steam/sffi_backend.spl`, plus the bridge health functions
`simple_steam_bridge_is_mock` and `simple_steam_bridge_real_backend_ready`.

It is not Valve Steamworks, not a Steam client, and not a DRM/auth backend. Its
purpose is to prove that a compiled Simple program can load a bridge with
`spl_dlopen`, resolve the required symbols with `spl_dlsym`, and reject the
fixture as `real_steam_backend=false`.

Build and run:

```bash
mkdir -p build/os/game/steam
cc -shared -fPIC examples/os/game/steam_bridge_mock/simple_steam_bridge_mock.c \
  -o build/os/game/steam/libsimple_steam_bridge.so
bin/simple compile examples/os/game/steam_sffi_probe_demo.spl --native \
  -o build/os/game/steam/steam_sffi_probe_demo
SIMPLE_STEAM_BRIDGE_PATH=$PWD/build/os/game/steam/libsimple_steam_bridge.so \
  build/os/game/steam/steam_sffi_probe_demo
```
