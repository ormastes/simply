<!-- llm-process-gen: managed source=codex_t32q_skill source_sha256=9ac6fb52433ce42a4b3f91c98f5b141c82ca2760717b11d1ea5a0ee374568f0e content_sha256=9ac6fb52433ce42a4b3f91c98f5b141c82ca2760717b11d1ea5a0ee374568f0e -->
---
name: t32q
description: "TRACE32 container control skill. Use when the user wants to turn TRACE32 on or off, relaunch it, reopen the GUI container, inspect logs/status, or retry the repo-managed TRACE32 container flow."
---

# T32Q

Use this skill for repo-managed TRACE32 container lifecycle tasks.

## Primary Commands

Build the image:

```bash
config/t32/trace32_x11_container.shs build
```

Headless on/off/reopen:

```bash
config/t32/trace32_x11_container.shs on
config/t32/trace32_x11_container.shs off
config/t32/trace32_x11_container.shs reopen
config/t32/trace32_x11_container.shs wait
config/t32/trace32_x11_container.shs ping
```

GUI container on/off/reopen:

```bash
config/t32/trace32_x11_container.shs gui-on
config/t32/trace32_x11_container.shs off
config/t32/trace32_x11_container.shs gui-reopen
config/t32/trace32_x11_container.shs status
config/t32/trace32_x11_container.shs logs
```

## GUI Preconditions

- Prefer the non-Qt GUI path via `gui`/`gui-d`/`gui-reopen`.
- `t32marm-qt` is not the default path here because the local vendor install still lacks Qt4 runtime libraries.
- GUI container launch needs host X11:
  - `DISPLAY` must be set
  - `/tmp/.X11-unix` must exist
  - if `XAUTHORITY` is unavailable, the host may need `xhost +local:root`

## Runtime Notes

- The headless container path starts `t32mciserver` on TCP `20000`.
- The GUI container path starts `/opt/t32/bin/pc_linux64/t32marm` with [`config/t32/t32_stm_gui.t32`](/home/ormastes/dev/pub/simple/config/t32/t32_stm_gui.t32).
- After any `on` or `reopen`, check readiness with `wait`, `ping`, `status`, and `logs`.
- If probe communication still stalls, fall back to host diagnosis with [`scripts/t32_check_ready.shs`](/home/ormastes/dev/pub/simple/scripts/t32_check_ready.shs).
