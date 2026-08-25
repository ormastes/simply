# Platform Abstraction Library - Usage Examples

Quick examples showing how to use the platform abstraction library.

## Running the Examples

The working examples are in the test suite:
```bash
bin/simple test test/examples/platform_library_example_spec.spl
```

## Example 1: Auto-Detect Host Platform

```simple
use std.platform.config.{host_config}

val host = host_config()
print "Platform: {host.arch.name()}-{host.os.name()}"
print "Endianness: {host.endian.name()}"
print "Pointer size: {host.pointer_bytes} bytes"
```

**Output (example):**
```
Platform: x86_64-linux
Endianness: little
Pointer size: 8 bytes
```

## Example 2: Same-Platform Conversion (Zero-Cost)

```simple
use std.platform.config.{host_config}
use std.platform.convert.{send_u32}

val host = host_config()
val value = 42
val result = send_u32(host, host, value)
# result == 42 (no conversion, zero cost)
```

## Example 3: Cross-Endian Byte Swapping

```simple
use std.platform.config.{make_config}
use std.platform.convert.{send_u32, recv_u32}
use std.common.target.{TargetArch, TargetOS}

# Little-endian to big-endian
val le = make_config(TargetArch.X86_64, TargetOS.Linux)
val be = make_config(TargetArch.MCS51, TargetOS.BareMetal)

val original = 0x12345678
val swapped = send_u32(le, be, original)  # → 0x78563412
val restored = recv_u32(le, be, swapped)  # → 0x12345678
```

## Example 4: Network Byte Order

```simple
use std.platform.config.{host_config, network_config}
use std.platform.convert.{send_u32, recv_u32}

val host = host_config()
val net = network_config()  # Always big-endian

# Send to network
val local_value = 0x1A2B3C4D
val network_value = send_u32(host, net, local_value)

# Receive from network
val received = recv_u32(host, net, network_value)
# received == 0x1A2B3C4D
```

## Example 5: Text Newline Conversion

```simple
use std.platform.config.{make_config}
use std.platform.convert.{send_text, recv_text}
use std.common.target.{TargetArch, TargetOS}

val unix = make_config(TargetArch.X86_64, TargetOS.Linux)
val windows = make_config(TargetArch.X86_64, TargetOS.Windows)

val unix_text = "Line1\nLine2\nLine3"          # LF newlines
val win_text = send_text(unix, windows, unix_text)  # CRLF newlines
val back = recv_text(unix, windows, win_text)       # LF again

# unix_text == back (round-trip works)
```

## Example 6: Wire Format Serialization

```simple
use std.platform.wire.{wire_writer_network, wire_reader_new}
use std.platform.config.{network_config}

# Write message
var writer = wire_writer_network()
writer.write_u32(100)
writer.write_text("Hello")
writer.write_u32(200)
val bytes = writer.to_bytes()

# Read message
var reader = wire_reader_new(bytes, network_config())
val n1 = reader.read_u32()      # 100
val msg = reader.read_text()    # "Hello"
val n2 = reader.read_u32()      # 200
```

## Example 7: Platform-Aware File I/O

```simple
use std.platform.text_io.{text_file_write_local, text_file_read_local}

# Write with host platform newlines (CRLF on Windows, LF on Unix)
text_file_write_local("output.txt", "Line1\nLine2\nLine3\n")

# Read and normalize to LF
val content = text_file_read_local("output.txt")
```

## Example 8: Custom Platform for Cross-Compilation

```simple
use std.platform.config.{host_config, make_config}
use std.platform.convert.{send_u32}
use std.common.target.{TargetArch, TargetOS}

val host = host_config()
val embedded = make_config(TargetArch.Arm, TargetOS.BareMetal)

# Generate constant for embedded target
val elf_magic = send_u32(host, embedded, 0x7F454C46)
```

## Example 9: Check Platform Compatibility

```simple
use std.platform.config.{host_config, network_config, same_platform, needs_swap}

val host = host_config()
val net = network_config()

if same_platform(host, host):
    print "Same platform - no conversion needed"

if needs_swap(host, net):
    print "Different endianness - byte swap required"
```

## Common Patterns

### Pattern 1: Network Protocol

```simple
# Always use network_config() for network protocols
val net = network_config()
val packet_length = send_u32(host, net, data.len())
```

### Pattern 2: Cross-Platform File Format

```simple
# Write for specific target platform
val win = make_config(TargetArch.X86_64, TargetOS.Windows)
text_file_write("config.txt", data, win)  # Always CRLF
```

### Pattern 3: Binary Wire Protocol

```simple
# Use wire format for structured data
var writer = wire_writer_network()
writer.write_u32(version)
writer.write_text(command)
writer.write_u32(payload_length)
send_to_socket(writer.to_bytes())
```

## Key Principles

1. **Explicit is better than implicit** - Always specify both platforms
2. **Zero-cost same-platform** - `send(host, host, x)` returns `x` unchanged
3. **Type-safe** - Can't accidentally mix up host and remote
4. **Auto-detected** - `host_config()` figures out everything automatically

## See Also

- **README_PLATFORM_LIBRARY.md** - Comprehensive user guide
- **test/examples/platform_library_example_spec.spl** - Running examples
- **test/01_unit/std/platform/** - Full test suite with more examples
