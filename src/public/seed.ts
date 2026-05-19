import type { Dollar } from "./dollar.ts";
import type {
  CliTuneOptions,
  CurrentSeedHandle,
  ScoreContext,
  SeedSchemaDescriptor,
  SubSeedHandle,
  TreeSeedEnvelope,
  TuneOptions,
  TuneResult,
  TuneShorthandOptions,
} from "./tune.ts";
import { normalizeMeta, type SchemaSnapshot } from "../internal/schema/discovery.ts";
import { schemaFingerprint } from "../internal/schema/validation.ts";
import {
  assertSeedMatchesSchema,
  legacySeedToValues,
} from "../internal/seed/snapshot.ts";
import { parseSeedBytes, serializeSeed } from "../internal/seed/binary.ts";
import {
  readBytes,
  readText,
  writeBytes,
  writeText,
} from "../internal/platform/files.ts";
import {
  attachWrapperState,
  createWrapperState,
  requireStablePersistence,
} from "../internal/runtime/state.ts";
import { invokeSeededFunction } from "../internal/runtime/invocation.ts";
import {
  createRootOnlyRuntimeTreeNode,
  exportRuntimeTreeEnvelope,
  findRuntimeTreeNode,
  importRuntimeTreeEnvelope,
  listRuntimeTreePaths,
  cloneRuntimeTreeNode,
} from "../internal/runtime/tree.ts";
import { tuneSeededFunctionCli } from "../internal/tune/cli.ts";
import { freezeSeedHandle } from "../internal/tune/common.ts";
import { tuneSeededFunction } from "../internal/tune/loop.ts";
import {
  CurrentSeedMissingError,
  SchemaDriftError,
  SeedCorruptedError,
  SeedDomainMismatchError,
  SeedSchemaVersionMismatchError,
  StableSeedRequiredError,
} from "../internal/utils/errors.ts";

export interface SeedMeta {
  id?: string;
  version?: string;
  name?: string;
  entropyBudget?: number;
  radius?: "narrow" | "medium" | "broad";
}

export interface TuneMethod<Args extends unknown[], Output> {
  (
    score: (output: Output, ctx: ScoreContext<Args>) => number | Promise<number>,
    options?: TuneShorthandOptions<Args, Output>,
  ): Promise<TuneResult<Output>>;
  (options?: TuneOptions<Args, Output>): Promise<TuneResult<Output>>;
}

export type SeededFunction<Args extends unknown[], Output> =
  ((...args: Args) => Promise<Output>) & {
    tune: TuneMethod<Args, Output>;
    tuneCli(options?: CliTuneOptions<Args, Output>): Promise<TuneResult<Output>>;
    load(path: string, ...args: Args): Promise<Output>;
    save(path: string): Promise<void>;
    loadTree(path: string, ...args: Args): Promise<Output>;
    saveTree(path: string): Promise<void>;
    importBytes(bytes: Uint8Array): void;
    exportBytes(): Uint8Array;
    importTree(envelope: TreeSeedEnvelope): void;
    exportTree(): TreeSeedEnvelope;
    subSeed(path: string): SubSeedHandle | null;
    setSubSeed(path: string, bytes: Uint8Array): void;
    listSubSeeds(): string[];
    domainCredits(): Record<string, number>;
    schema(options?: { internal?: boolean }): SeedSchemaDescriptor | null;
    reset(scope?: "seed" | "all"): void;
    seed: CurrentSeedHandle;
  };

export function seed<Args extends unknown[], Output>(
  fn: ($: Dollar, ...args: Args) => Output | Promise<Output>,
  meta?: SeedMeta,
): SeededFunction<Args, Output> {
  const state = createWrapperState(fn, normalizeMeta(meta));
  const getCurrentTree = () => {
    requireStablePersistence(state);
    if (state.currentTreeSeed) {
      return cloneRuntimeTreeNode(state.currentTreeSeed);
    }
    if (!state.currentSeed) {
      throw new CurrentSeedMissingError("No current seed is available to export as a tree");
    }
    if (!state.schema) {
      throw new CurrentSeedMissingError(
        "No schema has been discovered for the current seed yet. Run the wrapper once before exporting a tree.",
      );
    }
    return createRootOnlyRuntimeTreeNode(
      state.meta,
      schemaFingerprint(state.schema),
      state.currentSeed,
      state.currentValues,
    );
  };
  const exportTree = () => exportRuntimeTreeEnvelope(getCurrentTree());
  const saveTree = async (path: string) => {
    await writeText(path, `${JSON.stringify(exportTree(), null, 2)}\n`);
  };
  const importTree = (envelope: TreeSeedEnvelope) => {
    requireStablePersistence(state);
    const tree = importRuntimeTreeEnvelope(envelope);
    if (!state.meta.acceptedDomainUuids.includes(tree.meta.domainUuid)) {
      throw new SeedDomainMismatchError(
        `Loaded tree root domain ${tree.meta.domainUuid} does not match seeded function domain ${state.meta.domainUuid}`,
      );
    }
    if (tree.meta.version !== state.meta.version) {
      throw new SeedSchemaVersionMismatchError(
        `Loaded tree version ${tree.meta.version} does not match seeded function version ${state.meta.version}`,
      );
    }
    if (state.schema && tree.meta.schemaFingerprint !== schemaFingerprint(state.schema)) {
      throw new SchemaDriftError(
        `Detected schema drift for ${state.meta.name}. Tree seed schema fingerprint does not match the current wrapper schema.`,
      );
    }
    state.currentTreeSeed = tree;
    state.currentSeed = tree.seed;
    state.currentValues = state.schema ? legacySeedToValues(state.schema, tree.seed) : null;
    state.currentOutput = null;
    state.currentTrace = null;
    state.domainCreditState = {};
    state.domainCredits = {};
  };
  const listSubSeeds = () => listRuntimeTreePaths(getCurrentTree());
  const subSeed = (path: string): SubSeedHandle | null => {
    requireStablePersistence(state);
    const node = findRuntimeTreeNode(getCurrentTree(), path);
    if (!node || !node.path) {
      return null;
    }
    return {
      path: node.path,
      get values() {
        return node.values ? structuredClone(node.values) : null;
      },
      get meta() {
        return {
          id: node.meta.stableId ?? node.meta.runtimeId,
          version: node.meta.version,
          generation: node.seed.header.generation,
          hash: node.seed.contentHash,
        };
      },
      exportBytes() {
        if (node.meta.stableId === null) {
          throw new StableSeedRequiredError(
            `Sub-seed "${node.path}" belongs to an ephemeral child domain and cannot be exported stably.`,
          );
        }
        return serializeSeed(node.seed);
      },
      async save(pathname: string) {
        await writeBytes(pathname, this.exportBytes());
      },
      clear() {},
    };
  };
  const setSubSeed = (path: string, bytes: Uint8Array) => {
    requireStablePersistence(state);
    const tree = getCurrentTree();
    const node = findRuntimeTreeNode(tree, path);
    if (!node || !node.path) {
      throw new CurrentSeedMissingError(`No sub-seed exists at path "${path}"`);
    }
    const loadedSeed = parseSeedBytes(bytes);
    if (!node.meta.acceptedDomainUuids.includes(loadedSeed.header.domainId)) {
      throw new SeedDomainMismatchError(
        `Loaded sub-seed domain ${loadedSeed.header.domainId} does not match child domain ${node.meta.domainUuid}`,
      );
    }
    if (loadedSeed.header.domainSchemaVersion !== node.meta.version) {
      throw new SeedSchemaVersionMismatchError(
        `Loaded sub-seed version ${loadedSeed.header.domainSchemaVersion} does not match child version ${node.meta.version}`,
      );
    }
    node.seed = loadedSeed;
    node.values = node.schema ? legacySeedToValues(node.schema, loadedSeed) : null;
    state.currentTreeSeed = tree;
    state.currentSeed = tree.seed;
    state.currentValues = tree.values ? structuredClone(tree.values) : state.currentValues;
    state.currentOutput = null;
    state.currentTrace = null;
    state.domainCreditState = {};
    state.domainCredits = {};
  };

  const currentSeedHandle: CurrentSeedHandle = {
    get values() {
      return state.currentValues ? structuredClone(state.currentValues) : null;
    },
    get meta() {
      if (!state.currentSeed) return null;
      return {
        id: state.meta.stableId ?? state.meta.runtimeId,
        version: state.meta.version,
        generation: state.currentSeed.header.generation,
        hash: state.currentSeed.contentHash,
      };
    },
    exportBytes() {
      requireStablePersistence(state);
      if (!state.currentSeed) {
        throw new CurrentSeedMissingError("No current seed is available to export");
      }
      return serializeSeed(state.currentSeed);
    },
    async save(path: string) {
      await writeBytes(path, this.exportBytes());
    },
    exportTree() {
      return exportTree();
    },
    async saveTree(path: string) {
      await saveTree(path);
    },
    importTree(envelope: TreeSeedEnvelope) {
      importTree(envelope);
    },
    subSeed(path: string) {
      return subSeed(path);
    },
    setSubSeed(path: string, bytes: Uint8Array) {
      setSubSeed(path, bytes);
    },
    listSubSeeds() {
      return listSubSeeds();
    },
    domainCredits() {
      return { ...state.domainCredits };
    },
    clear() {
      state.currentSeed = null;
      state.currentValues = null;
      state.currentOutput = null;
      state.currentTreeSeed = null;
      state.currentTrace = null;
      state.domainCreditState = {};
      state.domainCredits = {};
    },
  };

  const wrapped = (async (...args: Args) => {
    const run = await invokeSeededFunction(state, args, {
      seedBank: state.seedBank ? { path: state.seedBank.basePath } : undefined,
    });
    return run.output;
  }) as SeededFunction<Args, Output>;
  attachWrapperState(wrapped, state);

  wrapped.tune = (async (
    first?:
      | TuneOptions<Args, Output>
      | ((output: Output, ctx: ScoreContext<Args>) => number | Promise<number>),
    second?: TuneShorthandOptions<Args, Output>,
  ) => {
    if (typeof first === "function") {
      const options: TuneOptions<Args, Output> = {
        ...(second ?? {}),
        selector: second?.selector ?? "auto",
        score: first,
      };
      return tuneSeededFunction(state, options);
    }
    return tuneSeededFunction(state, first ?? {});
  }) as TuneMethod<Args, Output>;

  wrapped.load = async (path: string, ...args: Args) => {
    requireStablePersistence(state);
    const bytes = await readBytes(path);
    wrapped.importBytes(bytes);
    return wrapped(...args);
  };

  wrapped.tuneCli = async (options: CliTuneOptions<Args, Output> = {}) => {
    return tuneSeededFunctionCli(state, options);
  };

  wrapped.save = async (path: string) => {
    await currentSeedHandle.save(path);
  };

  wrapped.loadTree = async (path: string, ...args: Args) => {
    requireStablePersistence(state);
    const text = await readText(path);
    if (text === null) {
      throw new SeedCorruptedError(`Tree seed file was not found at ${path}`);
    }
    wrapped.importTree(JSON.parse(text) as TreeSeedEnvelope);
    return wrapped(...args);
  };

  wrapped.saveTree = async (path: string) => {
    await currentSeedHandle.saveTree(path);
  };

  wrapped.importBytes = (bytes: Uint8Array) => {
    requireStablePersistence(state);
    const loadedSeed = parseSeedBytes(bytes);
    if (state.schema) {
      assertSeedMatchesSchema(state.schema, loadedSeed);
      state.currentValues = legacySeedToValues(state.schema, loadedSeed);
    } else {
      state.currentValues = null;
    }
    state.currentSeed = loadedSeed;
    state.currentOutput = null;
    state.currentTreeSeed = null;
    state.currentTrace = null;
    state.domainCreditState = {};
    state.domainCredits = {};
  };

  wrapped.exportBytes = () => {
    return currentSeedHandle.exportBytes();
  };

  wrapped.importTree = (envelope: TreeSeedEnvelope) => {
    currentSeedHandle.importTree(envelope);
  };

  wrapped.exportTree = () => {
    return currentSeedHandle.exportTree();
  };

  wrapped.subSeed = (path: string) => {
    return currentSeedHandle.subSeed(path);
  };

  wrapped.setSubSeed = (path: string, bytes: Uint8Array) => {
    currentSeedHandle.setSubSeed(path, bytes);
  };

  wrapped.listSubSeeds = () => {
    return currentSeedHandle.listSubSeeds();
  };

  wrapped.domainCredits = () => {
    return currentSeedHandle.domainCredits();
  };

  wrapped.schema = (options?: { internal?: boolean }) => {
    return buildSchemaDescriptor(state.schema, options);
  };

  wrapped.reset = (scope: "seed" | "all" = "seed") => {
    currentSeedHandle.clear();
    if (scope === "all") {
      state.schema = null;
    }
  };

  wrapped.seed = currentSeedHandle;

  return wrapped;
}

function buildSchemaDescriptor(
  schema: SchemaSnapshot | null,
  options?: { internal?: boolean },
): SeedSchemaDescriptor | null {
  if (!schema) return null;
  const descriptor: SeedSchemaDescriptor = {
    meta: {
      id: schema.meta.stableId,
      version: schema.meta.version,
      name: schema.meta.name,
      stable: schema.meta.stablePersistence,
    },
    params: schema.params.map((param) => ({
      name: param.name,
      type: param.spec.type,
      range: param.spec.range ? [...param.spec.range] as [number, number] : undefined,
      default: toJsonSafeValue(param.spec.default),
      tier: param.tier,
    })),
    relations: schema.relations.map((relation) => ({
      name: relation.name,
      sources: [...relation.sources],
      target: relation.target,
      kind: relation.spec.kind,
      weight: relation.spec.weight,
      params: relation.spec.params ? structuredClone(relation.spec.params) : undefined,
    })),
    checks: schema.checks.map((check) => ({
      name: check.name,
      enforcement: check.enforcement,
      message: check.message,
    })),
    domainSlots: schema.domainSlots.map((slot) => ({
      name: slot.name,
      path: slot.path,
      mode: slot.mode,
      child: {
        id: slot.child.id,
        version: slot.child.version,
        name: slot.child.name,
        domainUuid: slot.child.domainUuid,
        schemaFingerprint: slot.child.schemaFingerprint,
      },
    })),
    behaviors: schema.behaviors.map((behavior) => ({
      name: behavior.name,
      valueType: behavior.valueType,
    })),
    domainRelations: schema.domainRelations.map((relation) => ({
      name: relation.name,
      source: relation.source,
      target: relation.target,
      kind: relation.spec.kind,
      weight: relation.spec.weight,
      params: relation.spec.params ? structuredClone(relation.spec.params) : undefined,
    })),
  };

  if (options?.internal) {
    descriptor.internal = {
      domainUuid: schema.meta.domainUuid,
      schemaFingerprint: schemaFingerprint(schema),
      params: schema.params.map((param) => ({
        name: param.name,
        fieldId: param.fieldId,
      })),
      relations: schema.relations.map((relation) => ({
        name: relation.name,
        relationId: relation.relationId,
      })),
      domainSlots: schema.domainSlots.map((slot) => ({
        name: slot.name,
        path: slot.path,
        childDomainUuid: slot.child.domainUuid,
        childSchemaFingerprint: slot.child.schemaFingerprint,
      })),
    };
  }

  return descriptor;
}

function toJsonSafeValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonSafeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonSafeValue(entry)]),
    );
  }
  return value;
}
