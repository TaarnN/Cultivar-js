# Changelog

All notable package changes are documented here.

This project follows the spirit of semantic versioning during the `0.x` line: public APIs are intended to be usable, while minor versions may still refine tuning behavior and storage metadata before `1.0`.

## 0.1.0

Initial npm package release.

### Added

- Wrapper-first `seed()` API.
- Inline seeded parameters through `$()`.
- Sticky current-seed behavior.
- Stable seed save/load and byte import/export.
- Schema introspection with `schema()`.
- Shorthand and full-form tuning.
- Built-in `tuneCli()` interactive tuner.
- Deterministic mutation session seeding.
- Hierarchical domains through `$.domain()` and `$.domainList()`.
- Tree persistence through `saveTree`, `loadTree`, `exportTree`, and `importTree`.
- Sub-seed inspection and injection.
- Mutation traces, domain credits, tree cache, seed bank reuse, experience capture, and habit-guided biasing.
- Typed error subpath at `cultivar-js/errors`.
- ESM, CommonJS, and TypeScript declaration package artifacts.
- Node.js 18+ runtime support for the published package.

### Notes

- The full regression suite currently runs with Bun's test runner via `npm run test:bun`.
- The published library runtime and package exports do not depend on Bun.
