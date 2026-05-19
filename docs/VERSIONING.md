# Versioning

`cultivar-js` has three versioning concerns. Keeping them separate makes saved seeds and npm releases easier to reason about.

## Package Version

This is the version in `package.json`.

It answers:

- which npm release are you using?
- which changelog entry applies?
- which package build artifacts are installed?

## Wrapper Schema Version

This is `meta.version` passed to `seed(fn, meta)`.

```ts
const wrapped = seed(fn, {
  id: "image.render",
  version: "1",
});
```

It answers:

- which parameter schema is this wrapper using?
- are saved seeds compatible with this function declaration?
- should a persisted tree be accepted for this wrapper?

## Binary Wire Version

This is the internal seed wire-format version parsed from seed bytes.

Most users do not need to manage it directly. Use public methods such as `save`, `load`, `exportBytes`, `importBytes`, `saveTree`, and `loadTree`.

## Rule Of Thumb

Bump `meta.version` when you materially change the discovered schema.

That includes:

- adding a parameter
- removing a parameter
- renaming a parameter
- changing a parameter type
- changing a parameter range
- changing a meaningful default
- changing `tier`
- changing relations
- changing checks
- adding or removing domain slots
- changing child domain schema shape
- changing behaviors
- changing domain relations

## What Happens Without A Version Bump?

For stable wrappers, `cultivar-js` compares the frozen schema fingerprint with the newly discovered schema.

If they differ, it throws `SchemaDriftError`.

This is intentional. It prevents silently replaying old seeds against a materially different function declaration.

## Stable Identity

For stable persistence, pass both `id` and `version`.

```ts
seed(fn, {
  id: "your.wrapper.id",
  version: "1",
});
```

`id` and `version` together define the stable persistence boundary.

## Ephemeral Wrappers

If you call:

```ts
seed(fn);
```

the wrapper is ephemeral.

That means:

- direct execution works
- tuning works
- stable save/load/export/import does not
- tree persistence does not

## Binary Compatibility

Schema-version changes are not the same as binary-format changes.

Changing `meta.version` does not imply a new wire-format version. It only declares that saved seeds for previous schema versions should not be applied automatically to the new wrapper declaration.

## Migration Approach

When changing a production wrapper:

1. Copy the existing function declaration.
2. Make the schema changes.
3. Bump `meta.version`.
4. Add an explicit migration workflow if old seeds need to be replayed or converted.
5. Test replay with representative saved seeds or tree envelopes.

Do not silently reuse old stable seeds against a materially changed schema.
