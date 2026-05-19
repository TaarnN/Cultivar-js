# API Reference

This page summarizes the public API exported by `cultivar-js`.

## Package Exports

```ts
import { seed } from "cultivar-js";
```

```js
const { seed } = require("cultivar-js");
```

Typed errors are exported from:

```ts
import { SchemaDriftError } from "cultivar-js/errors";
```

The package includes TypeScript declarations for both exports.

## `seed(fn, meta?)`

```ts
function seed<Args extends unknown[], Output>(
  fn: ($: Dollar, ...args: Args) => Output | Promise<Output>,
  meta?: SeedMeta,
): SeededFunction<Args, Output>;
```

Wraps a function and returns a seed-aware callable.

### `SeedMeta`

```ts
interface SeedMeta {
  id?: string;
  version?: string;
  name?: string;
  entropyBudget?: number;
  radius?: "narrow" | "medium" | "broad";
}
```

Notes:

- `id` is optional for ephemeral wrappers.
- `id` is required for stable persistence.
- `version` is the schema-compatibility boundary.
- Stable IDs are converted into deterministic internal UUIDv8 values for seed/domain mapping.
- UUID derivation is identity plumbing, not a security boundary.

## `$`

```ts
interface Dollar {
  <T extends SeedScalar>(name: string, spec: ParamSpec<T>): T;
  rel(source: string | string[], target: string, spec: RelationSpec): void;
  check(
    name: string,
    predicate: () => boolean | Promise<boolean>,
    spec?: CheckSpec,
  ): Promise<void>;
  domain<SubArgs extends unknown[], SubOutput>(
    name: string,
    subFn: SeededFunction<SubArgs, SubOutput>,
    args: SubArgs,
    options?: DomainInvokeOptions,
  ): Promise<SubOutput>;
  domainList<Item, SubArgs extends unknown[], SubOutput>(
    name: string,
    items: readonly Item[],
    keyFn: (item: Item, index: number) => string | number,
    subFn: SeededFunction<SubArgs, SubOutput>,
    argsFn: (item: Item, index: number) => SubArgs,
    options?: DomainInvokeOptions,
  ): Promise<SubOutput[]>;
  behavior(name: string, value: number): void;
  domainRel(source: string, target: string, spec: RelationSpec): void;
}
```

### `ParamSpec`

```ts
interface ParamSpec<T> {
  type: "f64" | "f32" | "u64" | "u32" | "u16" | "u8" | "bool" | "string" | "bytes";
  range?: [number, number];
  default?: T;
  tier?: "core" | "texture";
}
```

### `RelationSpec`

```ts
interface RelationSpec {
  kind:
    | "correlate"
    | "constrain"
    | "sequence"
    | "inhibit"
    | "amplify"
    | "weighted_sum"
    | "threshold_gate"
    | "conditional_blend";
  weight?: number;
  params?: Record<string, unknown>;
}
```

### `CheckSpec`

```ts
interface CheckSpec {
  message?: string;
  enforcement?: "reject" | "warn";
}
```

Use `await $.check(...)` when validation depends on asynchronous work.

### `DomainInvokeOptions`

```ts
interface DomainInvokeOptions {
  reuse?: "default" | "bank-best" | "bank-nearest";
  behaviorTarget?: Record<string, number>;
  behaviorConstraints?: Record<string, BehaviorConstraintSpec>;
}
```

## Returned Function

The wrapper is callable:

```ts
const output = await wrapped(...args);
```

It also has attached methods.

### `wrapped.tune(scoreFn, options?)`

```ts
wrapped.tune(
  (output, ctx) => number | Promise<number>,
  options?,
);
```

Shorthand tuning defaults to automatic selection and uses the passed score function.

### `wrapped.tune(options?)`

```ts
wrapped.tune({
  args?,
  generations?,
  batchSize?,
  radius?,
  score?,
  objectives?,
  preference?,
  selector?,
  preview?,
  onGeneration?,
  lineage?,
  experience?,
  timeouts?,
  io?,
  domainLock?,
  domainFocus?,
  depthLimit?,
  hierarchical?,
});
```

The object form defaults to human selection unless `selector` is provided.

### `wrapped.tuneCli(options?)`

```ts
wrapped.tuneCli({
  args?,
  generations?,
  batchSize?,
  radius?,
  score?,
  objectives?,
  preference?,
  preview?,
  inspect?,
  onGeneration?,
  lineage?,
  experience?,
  timeouts?,
  title?,
  showValues?,
  io?,
});
```

See [CLI reference](CLI.md).

### Persistence Methods

```ts
wrapped.save(path): Promise<void>;
wrapped.load(path, ...args): Promise<Output>;
wrapped.exportBytes(): Uint8Array;
wrapped.importBytes(bytes): void;
```

Stable persistence requires `seed(fn, { id, version })`.

### Tree Methods

```ts
wrapped.saveTree(path): Promise<void>;
wrapped.loadTree(path, ...args): Promise<Output>;
wrapped.exportTree(): TreeSeedEnvelope;
wrapped.importTree(envelope): void;
wrapped.subSeed(path): SubSeedHandle | null;
wrapped.setSubSeed(path, bytes): void;
wrapped.listSubSeeds(): string[];
wrapped.domainCredits(): Record<string, number>;
```

### Schema And Reset

```ts
wrapped.schema(): SeedSchemaDescriptor | null;
wrapped.schema({ internal: true }): SeedSchemaDescriptor | null;
wrapped.reset(): void;
wrapped.reset("seed"): void;
wrapped.reset("all"): void;
```

- `reset("seed")` clears current seed/output/values but keeps the discovered schema.
- `reset("all")` also clears the frozen schema.

### `wrapped.seed`

```ts
interface CurrentSeedHandle {
  readonly values: Record<string, unknown> | null;
  readonly meta: {
    id: string;
    version: string;
    generation: number;
    hash: string;
  } | null;
  exportBytes(): Uint8Array;
  save(path: string): Promise<void>;
  exportTree(): TreeSeedEnvelope;
  saveTree(path: string): Promise<void>;
  importTree(envelope: TreeSeedEnvelope): void;
  subSeed(path: string): SubSeedHandle | null;
  setSubSeed(path: string, bytes: Uint8Array): void;
  listSubSeeds(): string[];
  domainCredits(): Record<string, number>;
  clear(): void;
}
```

## Tuning Types

### `InteractiveIO`

```ts
interface InteractiveIO {
  prompt?: (message: string) => string | Promise<string | null> | null;
  print?: (line: string) => void;
  color?: boolean;
}
```

Use this for tests, custom terminals, or server-side orchestration.

### `CandidateContext`

```ts
interface CandidateContext<Args extends unknown[]> {
  generation: number;
  position: number;
  batchAttempt: number;
  sessionSeed: string;
  args: Args;
  seed: FrozenSeedHandle;
}
```

### `TuneResult`

```ts
interface TuneResult<Output> {
  output: Output;
  score?: number;
  objectives?: Record<string, number>;
  seed: FrozenSeedHandle;
  history: GenerationSummary[];
  trace?: DomainTraceNode;
  domainSummaries?: DomainTuneSummary[];
  domainCredits?: Record<string, number>;
}
```

## Experience Types

```ts
interface ExperienceOptions {
  path?: string;
  store?: ExperienceStore;
  capture?: "selected" | "all-survivors";
}
```

Experience records capture selection marks, task/input/output hashes, seed hashes, scores, objective vectors, session metadata, and candidate parameter values.

Habits are derived sidecar hints. They guide future candidate generation without changing the binary seed format.

## Errors

Import from `cultivar-js/errors`.

Stable classes:

- `CultivarJsError`
- `SchemaDriftError`
- `SchemaDeclarationError`
- `StableSeedRequiredError`
- `ValidationRejectedError`
- `SelectionError`
- `InteractiveIOUnavailableError`
- `InteractiveAbortError`
- `TimeoutExceededError`
- `CurrentSeedMissingError`
- `SeedCorruptedError`
- `UnsupportedSeedVersionError`
- `SeedDomainMismatchError`
- `SeedSchemaVersionMismatchError`
- `WrappedSeedDecodeError`
- `GenerationExhaustedError`
