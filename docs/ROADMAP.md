# Roadmap

This roadmap is intentionally public-facing. It tracks product direction without exposing internal scratch plans.

## Current Focus

- Keep the public package surface small: `cultivar-js` and `cultivar-js/errors`.
- Keep Node.js 18+ package consumption reliable for ESM and CommonJS users.
- Preserve stable seed persistence through documented wrapper methods.
- Improve docs and examples around real tuning workflows.
- Keep hierarchical tuning understandable through traces, domain summaries, and CLI commands.

## Recently Landed

- ESM, CommonJS, and TypeScript declaration build artifacts.
- Node-compatible runtime file IO.
- Node smoke test for installed package imports.
- npm package files limited to `dist`, docs, `README.md`, `CHANGELOG.md`, and `package.json`.
- Hierarchical domains, tree replay, domain credits, seed bank reuse, experience capture, and habit guidance.

## Planned Improvements

- More examples for common package consumers.
- Clearer migration examples for schema version bumps.
- Better public docs for custom `ExperienceStore` and `HabitStore` integrations.
- Additional smoke tests for package-manager installs when CI is added.
- More granular export decisions if any internal type becomes part of the stable public API.

## Non-Goals For Now

- Browser runtime support without Node built-in polyfills.
- Treating `dist/internal/*` files as public API.
- Replacing the line-oriented CLI with a full-screen terminal UI.
- Changing the binary wire format without a documented compatibility plan.
