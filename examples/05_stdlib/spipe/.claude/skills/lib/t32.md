# TRACE32 Skill - Setup & Debugging Procedures

## Architecture
```
Simple Code → RCL API (UDP:20000) → PowerView → JTAG Probe → Target MCU
                                         ↓
                                GDB Back-End (TCP:30000) → GDB Client
```

## MCP Debug Tools (T32-Aware)

The Simple MCP server has 6 hardware debug tools that work with T32 sessions:

| MCP Tool | Purpose |
|----------|---------|
| `debug_create_session` | Create session with `target_type: "t32"` or `"t32_gdb"` |
| `debug_trace_capture` | Capture trace data (T32/T32_GDB only) |
| `debug_coverage_collect` | Collect coverage (T32/T32_GDB only) |
| `debug_flash_program` | Flash firmware (T32/T32_GDB/OpenOCD) |
| `debug_system_reset` | Reset target (T32/T32_GDB/OpenOCD) |
| `debug_practice_script` | Execute .cmm PRACTICE script (T32 only) |

Plus standard debug tools: breakpoints, step, continue, variables, stack trace.

## Simple API

### RCL Client (`std.debug.remote.protocol.trace32`)
```simple
val client = Trace32Client(host: "localhost", port: 20000)
client.connect()?
client.ping()?
client.halt()?  / client.resume()?  / client.step()?
client.read_register("PC")?
client.execute("DO startup.cmm")?
```

### GDB Bridge (`std.debug.remote.protocol.t32_gdb_bridge`)
```simple
# 1. RCL → enable GDB server
t32.execute("SETUP.API.GDB.Enable /PORT 30000")?
# 2. GDB → connect to stub
val gdb = GdbClient(host: "localhost", port: 30000)
gdb.connect()? / gdb.read_registers()?
```

### DAP Adapter (`src/lib/nogc_sync_mut/dap/adapter/trace32.spl`)
```simple
val adapter = Trace32Adapter(host: "localhost", port: 20000)
adapter.initialize()? / adapter.launch(program: "fw.elf")?
adapter.set_breakpoint(file: "main.c", line: 42)?
```

## Host Setup

```bash
scripts/t32_host_setup.shs    # One-shot: udev, fonts, xvfb
```

## Container Lifecycle (`t32q`)

Prefer the repo wrapper:

```bash
scripts/t32q.shs build
scripts/t32q.shs on
scripts/t32q.shs wait
scripts/t32q.shs ping
scripts/t32q.shs reopen
scripts/t32q.shs off
```

GUI container flow:

```bash
scripts/t32q.shs gui-on
scripts/t32q.shs gui-reopen
scripts/t32q.shs off
```

Notes:
- `scripts/t32q.shs` wraps `config/t32/trace32_x11_container.shs`
- `gui-on` requires host `DISPLAY` and `/tmp/.X11-unix`
- `scripts/t32q.shs doctor` prints quick X11/container/port state

## Hello-World Semihost Smoke

Use the repo runner:

```bash
scripts/t32_semihost_hello.shs --board stm32wb
scripts/t32_semihost_hello.shs --board stm32h7
scripts/t32_semihost_hello.shs --board stm32wb --build-only
```

It builds the shared STM smoke ELF, starts the board-specific TRACE32 lane,
loads the ELF, runs it, halts, and checks `MCP_OUT` for `simple-stm-smoke`.

## Launch & Verify

```bash
scripts/t32q.shs on
scripts/t32q.shs wait
scripts/t32q.shs ping

# Host-side PowerView path
xvfb-run -a scripts/t32_start_stm.shs stm32wb native
/opt/t32/bin/pc_linux64/t32rem localhost port=20000 PING
```

## t32rem Commands

```bash
t32rem localhost port=20000 PING
t32rem localhost port=20000 "SYStem.Up"
t32rem localhost port=20000 "Register.Get PC"
t32rem localhost port=20000 "DO /path/to/script.cmm"
t32rem localhost port=20000 "SETUP.API.GDB.Enable /PORT 30000"
```

## PRACTICE Scripts (.cmm)

Note: No CMM LSP exists yet. PRACTICE scripts use simple command syntax.

```cmm
DO /opt/t32/stm32wb_startup.cmm
SYStem.Option SemiHost ON
Break
ENDDO
```

## Config
- `config/t32/t32_stm_headless.t32`: headless container / hidden PowerView
- `config/t32/t32_stm_gui.t32`: visible GUI container launch
- `SCREEN=OFF` is not used in this local build path

## Troubleshooting

| Error | Fix |
|-------|-----|
| "error initializing TRACE32" | PowerView not running. Check `ss -ulnp \| grep 20000` |
| "XFT...PCF bitmap fonts" | `sudo rm /etc/fonts/conf.d/70-no-bitmaps-except-emoji.conf && sudo fc-cache -f` |
| "communication error (4,0,0)" | Probe stuck. Unplug/replug USB, `usbreset "0897:0002"` |
| No `/dev/lauterbach/trace32/` | Run `scripts/t32_host_setup.shs` |
| GUI container says `missing DISPLAY` | Start from a real desktop session or export host `DISPLAY`/`XAUTHORITY` first |
| Container `on` fails with port 20000 in use | Run `scripts/t32q.shs off`; the wrapper also kills stale host `t32mciserver` before `on`/`reopen` |

## MCP Servers

| Server | Binary | Purpose |
|--------|--------|---------|
| `t32-mcp` | `bin/t32_mcp_server` | TRACE32 debugger MCP (fast-start wrapper) |
| `t32-lsp-mcp` | `bin/t32_lsp_mcp_server` | TRACE32 CMM LSP via MCP |

## Key Files
- Config: `config/t32/t32_stm_headless.t32`, `config/t32/t32_stm_gui.t32`, `stm32wb_*.cmm`
- Scripts: `scripts/t32q.shs`, `scripts/t32_semihost_hello.shs`, `config/t32/trace32_x11_container.shs`, `scripts/t32_host_setup.shs`, `t32_start_stm.shs`, `t32_check_ready.shs`
- API: `src/lib/nogc_sync_mut/debug/remote/protocol/trace32.spl`, `t32_gdb_bridge.spl`
- DAP: `src/lib/nogc_sync_mut/dap/adapter/trace32.spl`
