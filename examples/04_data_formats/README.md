# Data Formats Examples

Serialization, parsing, and data encoding.

## Examples

- **sdn_parser.spl** - SDN (Simple Data Notation) parser usage
- **cbor_encoding.spl** - CBOR (Concise Binary Object Representation) encoding

## SDN Format

SDN is Simple's native data format (alternative to JSON/YAML):

```sdn
name: "John Doe"
age: 30
languages:
  - "Simple"
  - "Rust"
  - "Python"
```

## See Also

- SDN implementation: `src/lib/sdn.spl`
- CBOR implementation: `src/lib/cbor.spl`
