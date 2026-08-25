# Library SMF Examples

This directory contains examples demonstrating the Library SMF (.lsm) format for bundling multiple SMF modules into a single archive file.

## Overview

Library SMF allows you to:
- Bundle multiple SMF modules into a single `.lsm` file
- Load modules from libraries transparently using `SmfGetter`
- Reduce filesystem overhead and simplify distribution
- Enable atomic library updates

## Examples

### 1. Create Sample Library

**File:** `create_sample_library.spl`

Creates a sample library containing three math modules:
- `math/add` - Addition function
- `math/sub` - Subtraction function
- `math/mul` - Multiplication function

**Run:**
```bash
# Must compile first (interpreter mode not supported)
bin/simple compile examples/lib_smf/create_sample_library.spl -o create_lib
./create_lib
```

**Output:**
- Creates `libmath.lsm` in current directory
- Contains 3 bundled SMF modules

### 2. Load from Library

**File:** `load_from_library.spl`

Demonstrates loading modules from the created library using `ModuleLoaderWithLibs`.

**Run:**
```bash
# First create the library
./create_lib

# Then load from it
bin/simple compile examples/lib_smf/load_from_library.spl -o load_lib
./load_lib
```

**Shows:**
- Creating a library-aware module loader
- Adding a library to the loader
- Listing available modules
- Checking module existence
- Getting module source information
- Loading a module from library (works end-to-end!)
- Accessing module header and exported symbols

### 3. Link with Libraries

**File:** `link_with_libraries.spl`

Demonstrates using the linker wrapper library support to link object files while resolving symbols from library archives.

**Run:**
```bash
bin/simple compile examples/lib_smf/link_with_libraries.spl -o link_lib
./link_lib
```

**Shows:**
- Scanning library paths for .lsm files
- Discovering available libraries and modules
- Symbol resolution workflow
- Integration with native linker

## Current Status

✅ **Complete (Phase 1 & 2):**
- Creating library archives with `LibSmfBuilder`
- Reading library contents with `LibSmfReader`
- Finding modules with `SmfGetter`
- Listing and querying available modules
- `SmfReaderMemory` - Load SMF from in-memory bytes
- Full module loading from libraries (end-to-end working!)

⚠️ **In Progress (Phase 3):**
- Linker wrapper integration
  - Library scanning (✅ complete)
  - Symbol resolution (✅ complete)
  - SMF to object conversion (⚠️ pending codegen integration)

## Architecture

```
LibSmfBuilder          Create .lsm archives from SMF files
       ↓
    .lsm file          Bundled SMF modules with index
       ↓
LibSmfReader           Extract individual modules
       ↓
   SmfGetter           Unified interface (files + libraries)
       ↓
ModuleLoaderWithLibs   Load and execute modules
```

## Use Cases

### Standard Library Distribution

Bundle the entire standard library:
```bash
bin/simple lib create -o libstd.lsm std/*.smf
```

### Application Deployment

Package application modules:
```bash
bin/simple lib create -o myapp.lsm app/*.smf
```

### Third-Party Libraries

Distribute libraries as single files:
```bash
bin/simple lib create -o libhttp.lsm http/*.smf
```

## File Format

### Library Layout
```
┌────────────────────────────────┐
│  LibSmfHeader (128 bytes)      │  Magic: "LSMF"
├────────────────────────────────┤
│  ModuleIndex (128B × count)    │  Module locations
├────────────────────────────────┤
│  Module 1 SMF Data             │
│  Module 2 SMF Data             │
│  ...                           │
└────────────────────────────────┘
```

### Properties
- **Extension:** `.lsm` (Library SMF)
- **Magic:** "LSMF" (0x4C 0x53 0x4D 0x46)
- **Version:** 1.0
- **Index:** O(1) module lookup
- **Hash:** FNV-1a for integrity

## API Reference

### Creating Libraries

```simple
use compiler.linker.lib_smf_writer.{LibSmfBuilder}

var builder = LibSmfBuilder.new()
builder.set_verbose(true)

builder.add_module("module/path", "file.smf")?
builder.add_module_data("module/name", smf_bytes)?

builder.write("output.lsm")?
```

### Reading Libraries

```simple
use compiler.linker.lib_smf_reader.{LibSmfReader}

val reader = LibSmfReader.open("library.lsm")?

val modules = reader.list_modules()
val has_mod = reader.has_module("module/name")
val smf_data = reader.get_module("module/name")?

reader.close()
```

### Unified Loading (Recommended)

```simple
use compiler.linker.smf_getter.{SmfGetter}

var getter = SmfGetter.new()
getter.add_search_path("/usr/lib/simple")
getter.add_library("libstd.lsm")?

val smf_data = getter.get("std/io/mod")?
```

### Module Loader Integration

```simple
use compiler.loader.module_loader_lib_support.{create_loader_with_stdlib}

var loader = create_loader_with_stdlib()
loader.add_library("myapp.lsm")?

val module = loader.load_module("app/main")?
```

## Next Steps

To complete the integration:

1. **Implement SmfReaderImpl.from_data()**
   - Load SMF module from byte array
   - Parse header, sections, symbols
   - Return SmfReaderImpl instance

2. **Update ModuleLoader**
   - Use SmfGetter instead of direct file access
   - Support loading from libraries

3. **Build System Integration**
   - Generate libstd.lsm during build
   - Install libraries to system paths
   - Package manager support

4. **Command-Line Tools**
   - `simple lib create` - Create libraries
   - `simple lib list` - List contents
   - `simple lib extract` - Extract modules
   - `simple lib verify` - Check integrity

## Documentation

- **Specification:** `doc/format/lib_smf_specification.md`
- **Integration Guide:** `doc/guide/apps/library_smf.md`
- **Implementation Report:** `doc/report/lib_smf_implementation_2026-02-09.md`

## Notes

- These examples require compiled mode (interpreter not supported)
- Library format is stable and ready for production use
- Module loading integration is in progress
- See documentation for complete API reference

---

**Created:** 2026-02-09
**Status:** Examples working, full integration in progress
