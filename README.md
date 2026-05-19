# Cultivar JS

`cultivar-js` turns ordinary JavaScript or TypeScript functions into seed-aware, replayable, tunable functions.

You keep your function shape. The wrapper adds inline seeded parameters, save/load, deterministic replay, hierarchical child domains, CLI curation, seed banks, and optional experience-guided tuning.

## Install

```sh
npm install cultivar-js
```

```sh
pnpm add cultivar-js
yarn add cultivar-js
```

## Runtime

- Node.js 18+ is the primary supported runtime.
- The package ships ESM, CommonJS, and TypeScript declaration files.
- It works with npm, pnpm, yarn, and other npm-compatible package managers.
- The published package exports only the public root module and the errors subpath.

```ts
import { seed } from "cultivar-js";
```

```js
const { seed } = require("cultivar-js");
```

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

console.log(await mix("hello"));
await mix.save("./mix.seed");

const best = await mix.tune((output) => output.length, {
  args: ["hello"],
  generations: 3,
  batchSize: 4,
});

await best.seed.save("./mix-best.seed");
```

## Core Ideas

- `seed(fn, meta?)` returns a callable wrapper around your function.
- `$()` declares a seed-controlled parameter inline and returns a normal runtime value.
- The first successful run discovers and freezes the wrapper schema.
- Direct calls reuse the wrapper's current seed until you reset, load, import, or tune another seed.
- Stable wrappers use `seed(fn, { id, version })` and can save/load/export/import seeds.
- Ephemeral wrappers use `seed(fn)` and are fine for temporary exploration, but stable persistence is blocked.

## Seeded Parameters

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

Use `tier: "core"` for structural parameters and `tier: "texture"` for lighter-weight details.

## Validation And Relations

Use `$.check()` to reject or warn on invalid candidates.

```ts
await $.check("exposure-safe", () => !(iso > 12800 && shutter < 1 / 250), {
  message: "too noisy for this shutter",
  enforcement: "reject",
});
```

Use `$.rel()` to describe relationships between parameters. Relations guide schema identity and mutation; they do not directly overwrite runtime values.

```ts
$.rel("iso", "wb", { kind: "inhibit", weight: 0.2 });
```

## Persistence

Flat seed persistence:

```ts
await mix.save("./current.seed");
await mix.load("./current.seed", "hello");

const bytes = mix.exportBytes();
mix.importBytes(bytes);
```

Hierarchical persistence:

```ts
await parent.saveTree("./parent.sdtree.json");
await parent.loadTree("./parent.sdtree.json", "hello");

const childSeed = parent.subSeed("child");
await childSeed?.save("./child.seed");
```

Default sidecar storage paths:

- `.cultivar-js/seed-bank/<domainUuid>/<schemaFingerprint>.jsonl`
- `.cultivar-js/experience/<domainUuid>/<schemaFingerprint>.jsonl`

## Tuning

Use shorthand tuning when one score function is enough:

```ts
const best = await mix.tune((output) => output.length, {
  args: ["hello"],
  generations: 5,
  batchSize: 6,
});
```

Use full-form tuning for custom selectors, multiple objectives, timeouts, experience capture, or hierarchical controls:

```ts
const result = await mix.tune({
  args: ["hello"],
  generations: 3,
  batchSize: 6,
  selector: "auto",
  score: (output) => output.length,
  preview: (output) => output,
});
```

Selector modes:

- `"auto"` picks the best scored candidate.
- `"human"` prompts through injected `InteractiveIO` or a runtime `prompt()`.
- A custom selector function can choose from the candidate list.

## Hierarchical Domains

Parent functions can call child seeded functions without mutating the child's standalone current seed.

```ts
import { seed } from "cultivar-js";

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
    const mood = $("mood", {
      type: "u8",
      range: [1, 5],
      default: 3,
    });

    $.behavior("stability", mood);

    const childOutput = await $.domain("child", child, [label] as [string], {
      reuse: "bank-nearest",
      behaviorTarget: { warmth: 8 },
      behaviorConstraints: {
        warmth: { min: 2 },
      },
    });

    $.domainRel("child", "behavior:stability", {
      kind: "correlate",
      weight: 0.5,
    });

    return `${mood}|${childOutput}`;
  },
  { id: "demo.parent", version: "1" },
);

await parent("hello");

const tuned = await parent.tune({
  args: ["hello"],
  generations: 2,
  batchSize: 4,
  score: (output) => output.length,
  domainFocus: ["child"],
  hierarchical: {
    credit: "hybrid",
    cache: { maxEntries: 64 },
    seedBank: {},
  },
});
```

## CLI Curation

`tuneCli()` is a line-oriented interactive tuner.

```ts
const result = await parent.tuneCli({
  args: ["hello"],
  generations: 4,
  batchSize: 5,
  score: (output) => output.length,
  preview: (output) => output,
});
```

Tree-aware commands include `tree`, `inspect-domain`, `values`, `behavior`, `save-sub`, `set-sub`, `lock`, `unlock`, `focus`, and `credit`.

## Errors

Typed errors are exported from `cultivar-js/errors`.

```ts
import {
  CultivarJsError,
  SchemaDriftError,
  StableSeedRequiredError,
  ValidationRejectedError,
} from "cultivar-js/errors";
```

## TypeScript

Type declarations are included in the package. No separate `@types/*` package is required.

The public package surface is:

- `cultivar-js`
- `cultivar-js/errors`

Internal files under `dist/internal` are implementation details and are not exported through package exports.

## Documentation

- [Documentation index](docs/README.md)
- [Full guide](DOCUMENTATION.md)
- [API reference](docs/API.md)
- [CLI reference](docs/CLI.md)
- [Versioning](docs/VERSIONING.md)
- [Binary format](docs/BINARY_FORMAT.md)
- [Roadmap](docs/ROADMAP.md)

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

The library runtime and published package exports do not depend on Bun.