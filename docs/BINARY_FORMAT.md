# Binary Format

This document describes the seed persistence layer used by `cultivar-js`.

Most users interact with seeds through `save`, `load`, `exportBytes`, and `importBytes`. This page exists for users who need to store, inspect, migrate, or wrap seed bytes themselves.

## Goals

- portable across sessions and machines
- stable for supported legacy seed versions
- fast accidental-corruption detection
- small enough for sidecar stores and JSON envelopes

## Flat Seed Layout

The flat seed wire format is:

1. header
2. core fields
3. texture fields
4. bond fields
5. SHA-256 footer

The wrapped transport format is:

1. raw seed bytes
2. optional compression
3. `SDWR-...` envelope

## Tree Layout

Hierarchical wrappers use a JSON tree sidecar rather than changing flat seed bytes.

The tree envelope format is `SDTREE/1` and contains:

- root metadata
- child tree nodes
- a `seedStore` of base64 seed bytes keyed by seed hash
- domain edges
- root schema fingerprint
- integrity hash

## Integrity

Two checks exist in flat seeds:

- CRC32 in the header
- SHA-256 footer

Important:

- CRC32 is for fast accidental-corruption detection.
- The SHA-256 footer is unauthenticated.
- Anyone who can rewrite the payload can recompute the footer.
- Neither checksum is a security boundary or authenticity guarantee.

If you need tamper resistance, wrap seed bytes or tree envelopes in a signed or HMAC-protected container outside `cultivar-js`.

## Version Support

The compatibility parser supports these legacy wire versions:

- v1
- v1.1
- v2

Current stable seed output keeps the supported binary wire format rather than introducing a new header or footer layout.

Schema version changes are separate from binary wire-format changes. Bumping `meta.version` changes wrapper schema compatibility; it does not imply a new seed wire version.

## Public API

Flat seed methods:

- `save(path)`
- `load(path, ...args)`
- `exportBytes()`
- `importBytes(bytes)`

Tree methods:

- `saveTree(path)`
- `loadTree(path, ...args)`
- `exportTree()`
- `importTree(envelope)`
- `subSeed(path)`
- `setSubSeed(path, bytes)`

## Compatibility Notes

- Treat the exact binary layout as stable only through documented public methods.
- Do not depend on `dist/internal/*` files; they are package implementation details.
- Use `exportBytes()` and `importBytes()` for external stores.
- Use `exportTree()` and `importTree()` for hierarchical replay.
