# Cultivar JS Guide

`cultivar-js` is a Node-compatible library for wrapping ordinary functions with seed-controlled parameters, replayable persistence, and tunable candidate generation.

This guide explains the concepts. For exact type shapes, see [docs/API.md](docs/API.md).

## Contents

- [Installation](#installation)
- [Package Formats](#package-formats)
- [Mental Model](#mental-model)
- [Seeded Parameters](#seeded-parameters)
- [Stable And Ephemeral Wrappers](#stable-and-ephemeral-wrappers)
- [Persistence](#persistence)
- [Tuning](#tuning)
- [CLI Tuning](#cli-tuning)
- [Hierarchical Domains](#hierarchical-domains)
- [Experience, Habits, Cache, And Seed Bank](#experience-habits-cache-and-seed-bank)
- [Versioning](#versioning)
- [Errors](#errors)
- [Development](#development)

## Installation

```sh
npm install cultivar-js
```

```sh
pnpm add cultivar-js
yarn add cultivar-js
```

Node.js 18+ is the primary supported runtime.

## Package Formats

ESM:

```ts
import { seed } from "cultivar-js";
```

CommonJS:

```js
const { seed } = require("cultivar-js");
```

Typed errors:

```ts
import { SchemaDriftError } from "cultivar-js/errors";
```

The package includes TypeScript declarations and does not need a separate `@types` package.

## Mental Model

`cultivar-js` wraps one function and gives it a current seed.

- `seed(fn, meta?)` creates a callable wrapper.
- `$()` declares a seed-controlled parameter inline.
- The first successful run discovers and freezes the wrapper schema.
- Direct calls reuse the wrapper's current seed.
- `.tune()` mutates candidate seeds, evaluates outputs, and commits the selected winner.
- `$.domain()` lets parent wrappers call child seeded functions without mutating the child wrapper's standalone current seed.
- `.saveTree()` and `.loadTree()` persist a full root-plus-children run.

## Quickstart

```ts
import { seed } from "cultivar-js";

const mix = seed(
  async ($, input: string) => {
    const emphasis = $("emphasis", {
      type: "f64",
      range: [0, 1],
      default: 0.4,
    });

    const repetition = $("repetition", {
      type: "u8",
      range: [1, 5],
      default: 2,
      tier: "texture",
    });

    return `${input}! ${"wow ".repeat(repetition).trim()} (${emphasis.toFixed(2)})`;
  },
  { id: "demo.mix", version: "1" },
);

await mix("hello");
await mix.save("./mix.seed");

const best = await mix.tune((output) => output.length, {
  args: ["hello"],
  generations: 3,
  batchSize: 4,
});

await best.seed.save("./mix-best.seed");
```

## Seeded Parameters

Declare seeded parameters inside the wrapped function.

```ts
const iso = $("iso", {
  type: "f64",
  range: [100, 25600],
  default: 400,
});
```

Supported parameter types:

- `"f64"`
- `"f32"`
- `"u64"`
- `"u32"`
- `"u16"`
- `"u8"`
- `"bool"`
- `"string"`
- `"bytes"`

Parameter specs can include:

- `type`: the seed scalar type.
- `range`: numeric lower and upper bounds.
- `default`: the initial value before mutation.
- `tier`: `"core"` or `"texture"`.

Use core parameters for the main structure of a seed. Use texture parameters for details that mutation can explore more freely.

## Validation And Relations

Use `$.check()` before irreversible side effects.

```ts
await $.check("exposure-safe", () => !(iso > 12800 && shutter < 1 / 250), {
  message: "too noisy for this shutter",
  enforcement: "reject",
});
```

Validation modes:

- `"reject"` removes the candidate from the tuning round.
- `"warn"` keeps the candidate and records the warning.

Use `$.rel()` to record parameter relationships.

```ts
$.rel("iso", "wb", { kind: "inhibit", weight: 0.2 });
```

Relations guide schema identity and mutation. They do not directly overwrite runtime values.

## Stable And Ephemeral Wrappers

Stable wrapper:

```ts
const stable = seed(fn, { id: "image.render", version: "1" });
```

Ephemeral wrapper:

```ts
const ephemeral = seed(fn);
```

Stable wrappers support persistence:

- `save(path)`
- `load(path, ...args)`
- `exportBytes()`
- `importBytes(bytes)`
- `saveTree(path)`
- `loadTree(path, ...args)`
- `exportTree()`
- `importTree(envelope)`
- `subSeed(path)`
- `setSubSeed(path, bytes)`
- `listSubSeeds()`

Ephemeral wrappers support direct execution and tuning, but stable save/load/export/import is intentionally blocked.

## Persistence

Flat seed persistence stores the current root seed.

```ts
await wrapped("hello");
await wrapped.save("./current.seed");

const replay = await wrapped.load("./current.seed", "hello");
```

Byte-level persistence is available when you want to store seeds yourself.

```ts
const bytes = wrapped.exportBytes();
wrapped.reset();
wrapped.importBytes(bytes);
const replay = await wrapped("hello");
```

Hierarchical persistence stores the full tree.

```ts
await parent("hello");
await parent.saveTree("./parent.sdtree.json");

const replay = await parent.loadTree("./parent.sdtree.json", "hello");
```

The tree envelope format is `SDTREE/1` and stores:

- the root seed
- child sub-seeds
- domain edges
- a schema fingerprint
- an integrity hash

The binary seed format uses CRC32 and SHA-256 checks for accidental corruption detection. These checks are not an authenticity or tamper-resistance boundary. Use a signed or HMAC-protected envelope if you need adversarial integrity.

## Tuning

Use shorthand tuning when you already have one score function.

```ts
const best = await mix.tune((output) => output.length, {
  args: ["hello"],
  generations: 5,
  batchSize: 6,
});
```

Use full-form tuning when you want human selection, custom selection, multiple objectives, or hierarchical controls.

```ts
const result = await generate.tune({
  args: ["portrait of a kingfisher"],
  generations: 2,
  batchSize: 4,
  selector: "auto",
  score: (output) => output.aesthetic,
  preview: (output) => output.summary,
  lineage: { path: "./image-render.lineage.jsonl" },
});
```

Selector modes:

- `"auto"` selects the best scored candidate.
- `"human"` prompts through `InteractiveIO` or a runtime `prompt()`.
- A custom function can choose from the candidate list.

Multi-objective tuning uses `objectives` plus `preference`.

```ts
await wrapped.tune({
  selector: "auto",
  objectives: (output) => ({
    quality: output.quality,
    speed: -output.latencyMs,
  }),
  preference: {
    quality: 1,
    speed: 0.2,
  },
});
```

Common tuning options:

- `args`: arguments passed to the wrapped function.
- `generations`: selection rounds.
- `batchSize`: candidates per round.
- `radius`: `"narrow"`, `"medium"`, `"broad"`, or a partial `RadiusSetting`.
- `score`: scalar scoring function.
- `objectives`: named objective scores.
- `preference`: objective weights or reducer.
- `preview`: compact candidate display text.
- `onGeneration`: callback after a generation is selected.
- `lineage`: optional JSONL lineage output.
- `experience`: optional sidecar experience capture.
- `timeouts`: per-candidate run, score, or select limits.
- `io`: injected terminal hooks.

Tune results include:

- `output`: selected output.
- `score`: selected scalar score, when available.
- `objectives`: selected objective vector, when available.
- `seed`: frozen selected seed handle.
- `history`: generation summaries.
- `trace`: hierarchical domain trace, when available.
- `domainSummaries`: hierarchical credit summaries, when available.
- `domainCredits`: flattened credit map, when available.

## CLI Tuning

`tuneCli()` is the built-in line-oriented interactive tuner.

```ts
const result = await fn.tuneCli({
  args: ["hello"],
  generations: 4,
  batchSize: 5,
  score: (output) => output.length,
  preview: (output) => output,
});
```

Inject custom IO for tests, embedded terminals, or remote orchestration.

```ts
await fn.tuneCli({
  io: {
    prompt: async (message) => {
      console.log(message);
      return "done 0";
    },
    print: (line) => console.log(line),
    color: false,
  },
});
```

See [docs/CLI.md](docs/CLI.md) for the command reference.

## Hierarchical Domains

Hierarchical domains let a parent wrapper call child wrappers while preserving a replayable seed tree.

```ts
const child = seed(
  async ($, label: string) => {
    const intensity = $("intensity", {
      type: "u8",
      range: [1, 9],
      default: 2,
    });

    $.behavior("warmth", intensity);
    return `${label}:${intensity}`;
  },
  { id: "demo.child", version: "1" },
);

const parent = seed(
  async ($, label: string) => {
    const childOutput = await $.domain("child", child, [label] as [string], {
      reuse: "bank-nearest",
      behaviorTarget: { warmth: 8 },
    });

    return childOutput;
  },
  { id: "demo.parent", version: "1" },
);
```

Hierarchical tuning options include:

- `domainLock`: paths that must not mutate.
- `domainFocus`: paths that should receive mutation budget.
- `depthLimit`: maximum mutation depth.
- `hierarchical.credit`: `"off"`, `"variance"`, `"hybrid"`, or `"targeted"`.
- `hierarchical.seedBank`: sidecar seed-bank options.
- `hierarchical.cache`: tree invocation cache options.
- `hierarchical.mutationMix`: mutation strategy weights.

## Experience, Habits, Cache, And Seed Bank

The optional experience layer records selected and rejected candidates in JSONL sidecar files. Derived habits can bias future candidates for matching schema and task signatures.

Default storage:

- `.cultivar-js/experience/<domainUuid>/<schemaFingerprint>.jsonl`
- `.cultivar-js/seed-bank/<domainUuid>/<schemaFingerprint>.jsonl`

The seed bank can warm-start child domains with:

- `reuse: "bank-best"`
- `reuse: "bank-nearest"`
- behavior targets
- sub-seed swap donors during hierarchical mutation

The tree cache can skip unchanged child invocations when seed hash, args hash, and schema fingerprint are unchanged.

## Versioning

There are two relevant versions:

- package version: the npm release version
- schema version: `meta.version` passed to `seed(fn, meta)`

Bump `meta.version` when you materially change discovered schema:

- parameter names
- parameter types
- parameter ranges
- defaults
- tiers
- relations
- checks
- domain slots
- child domain schema shape
- behaviors
- domain relations

If a stable wrapper discovers a different schema without a version bump, it throws `SchemaDriftError`.

## Introspection

```ts
await parent("hello");
console.log(parent.schema());
console.log(parent.schema({ internal: true }));
```

`schema({ internal: true })` includes hidden field IDs, relation IDs, domain UUIDs, schema fingerprints, and child domain slot metadata.

## Errors

Import typed errors from `cultivar-js/errors`.

```ts
import {
  CultivarJsError,
  SchemaDriftError,
  StableSeedRequiredError,
  ValidationRejectedError,
} from "cultivar-js/errors";
```

## Development

```sh
npm run typecheck
npm run build
npm test
npm run check
```

The full regression suite currently uses Bun's test runner:

```sh
npm run test:bun
```

The published library runtime does not depend on Bun.
