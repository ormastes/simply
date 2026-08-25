# smux — Simple Mux Terminal GUI

A terminal multiplexer GUI built in Simple. Features TUI and Tauri GUI backends, tmux integration, LLM agent hooks, mobile soft keyboard, and Nerd Font support.

## Quick Start

```bash
# From project root
sh examples/smux/run.shs

# Or directly
bin/simple run examples/smux/main.spl

# Desktop GUI (Tauri)
bin/simple run examples/smux/main.spl --gui
```

## Desktop (macOS / Linux / Windows)

### TUI Mode (default)
```bash
bin/simple run examples/smux/main.spl
```
Runs in your terminal with raw mode, mouse tracking, and ANSI rendering. Works in any terminal that supports VT100 escape sequences.

### GUI Mode (Tauri)
```bash
bin/simple run examples/smux/main.spl --backend=tauri
```
Opens a native desktop window via Tauri. Requires the Tauri runtime.

### tmux Integration
When running inside a tmux session, smux automatically:
- Registers pane focus/resize hooks
- Pauses rendering when the pane loses focus
- Supports tmux notifications

## Android (Termux)

### Setup
1. Install [Termux](https://f-droid.org/en/packages/com.termux/) from F-Droid
2. Install the Simple compiler:
   ```bash
   # Copy the aarch64-linux binary to Termux
   cp bin/release/aarch64-unknown-linux-gnu/simple $PREFIX/bin/simple
   chmod +x $PREFIX/bin/simple
   ```
3. Clone or copy the project:
   ```bash
   git clone <repo-url> ~/simple
   cd ~/simple
   ```

### Run
```bash
simple run examples/smux/main.spl
```

Features on Android:
- **Mobile soft keyboard bar** auto-shows (Tab, Esc, Ctrl, arrows, pipe, slash)
- **Termux notifications** via `termux-notification`
- Platform detected automatically via `ANDROID_ROOT` / `PREFIX`

### Optional: Termux extras
```bash
pkg install termux-api  # For native notifications
```

## iOS (a-Shell / iSH)

```bash
simple run examples/smux/main.spl
```
Mobile keybar auto-shows. Notifications use terminal bell + title.

## Keybindings

| Key | Action |
|-----|--------|
| `i` | Enter input mode |
| `Esc` | Return to normal mode |
| `Tab` | Toggle quick text panel |
| `Alt+1-9` | Send quick text snippet |
| `d` | Run LLM done-check hook |
| `q` | Quit (normal mode) |
| `Ctrl+C` | Force quit |
| `Up/Down` | Scroll |
| Mouse scroll | Scroll (3 lines) |
| Click | Hit-test quick text / keybar buttons |

## Configuration

Edit `config.sdn` (SDN format):

```sdn
app:
  title: "smux"
  theme: dark

platform:
  mobile_keybar: auto    # auto | always | never
  nerd_font: true

quick_texts:
  0:
    label: "Continue"
    snippet: "Please continue."
    shortcut: "1"

llm_hooks:
  on_done_script: "hooks/check_done.spl"
  timeout_ms: 30000
  auto_continue: true

tmux:
  hooks_enabled: true
```

## Architecture

```
main.spl           Entry point, CLI args, config loading
src/
  app.spl          Main event loop, rendering, state management
  platform.spl     OS/terminal detection (Linux/macOS/Windows/Android/iOS)
  input_handler.spl  Input event abstraction
  render_buffer.spl  Efficient partial-update terminal buffer
  quick_text.spl   Configurable text snippet buttons
  mobile_keys.spl  Soft keyboard bar for mobile
  nerd_font.spl    Unicode/Nerd Font icons with ASCII fallbacks
  notification.spl Cross-platform notifications
  tmux.spl         tmux command wrapper
  tmux_hooks.spl   tmux hook event system
  llm_hooks.spl    LLM done-check hook orchestration
hooks/
  check_done.spl   Default LLM done-check hook
test/
  config_spec.spl  Config parser tests
  modules_spec.spl Pure-function module tests
```

## Tests

```bash
bin/simple test examples/smux/test/modules_spec.spl
bin/simple test examples/smux/test/config_spec.spl
```
