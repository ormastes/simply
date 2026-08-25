# Getting Started Examples

First examples for new Simple users.

## Examples

- **hello_native.spl** - Basic "Hello World" compiled to native code
- **hello_native.smf** - SMF (Simple Module Format) version

## Running

```bash
# Interpreted
bin/simple run examples/01_getting_started/hello_native.spl

# Native binary
bin/simple native-build --entry examples/01_getting_started/hello_native.spl -o hello --entry-closure --runtime-bundle auto
./hello
```

Non-compiler native apps now prefer the `simple-core` lane when it is available,
and otherwise fall back to `core-c-bootstrap`. They do not silently use the
`rust-hosted` lane unless you opt in explicitly.
