import type {
  Dollar,
  DomainInvokeOptions,
  ParamSpec,
  SeedScalar,
} from "../../public/dollar.ts";
import type { SeededFunction } from "../../public/seed.ts";
import type { DomainTraceNode, SeedBankOptions } from "../../public/tune.ts";
import {
  buildBehaviorTargetWarnings,
  chooseSeedFromSeedBank,
  ensureSeedBankService,
  validateBehaviorConstraints,
} from "../hierarchical/seed-bank.ts";
import {
  createTreeCacheKey,
  resolveRuntimeTreeSeedSignature,
  type TreeInvocationCache,
} from "../hierarchical/cache.ts";
import { createDiscoverySession, type SchemaSnapshot } from "../schema/discovery.ts";
import { validateSchemaCompatibility, schemaFingerprint } from "../schema/validation.ts";
import {
  assertSeedMatchesSchema,
  legacySeedToFieldValueMap,
  legacySeedToValues,
  materializeInitialValue,
  snapshotToLegacySeed,
  type SeedValueMap,
} from "../seed/snapshot.ts";
import type { Seed } from "../compat/seed-format.ts";
import {
  SchemaDeclarationError,
  SchemaDriftError,
  ValidationRejectedError,
} from "../utils/errors.ts";
import { withTimeout } from "../utils/timeout.ts";
import {
  absoluteBehaviorPath,
  absoluteDomainPath,
  attachRuntimeChildNode,
  buildDomainTraceNode,
  createRuntimeTreeNode,
  makeChildPath,
  makeListChildKey,
  runtimeTreeMetaFromSchemaMeta,
  type RuntimeDomainEdge,
  type RuntimeTreeNode,
} from "./tree.ts";
import { getWrapperState, type WrapperState } from "./state.ts";

export interface InvocationResult<Output> {
  output: Output;
  schema: SchemaSnapshot;
  values: SeedValueMap;
  legacySeed: Seed;
  warnings: string[];
  tree: RuntimeTreeNode;
  trace: DomainTraceNode;
}

export async function invokeSeededFunction<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  args: Args,
  options?: {
    seed?: Seed | null;
    tree?: RuntimeTreeNode | null;
    commit?: boolean;
    cache?: TreeInvocationCache | null;
    seedBank?: false | SeedBankOptions;
    timeouts?: { runMs?: number };
  },
): Promise<InvocationResult<Output>> {
  const scopedOptions = options
    ? {
        ...(hasOwnProperty(options, "seed") ? { seed: options.seed } : {}),
        ...(hasOwnProperty(options, "tree") ? { tree: options.tree } : {}),
        ...(hasOwnProperty(options, "cache") ? { cache: options.cache } : {}),
        ...(hasOwnProperty(options, "seedBank") ? { seedBank: options.seedBank } : {}),
        ...(hasOwnProperty(options, "timeouts") ? { timeouts: options.timeouts } : {}),
      }
    : undefined;
  const run = await invokeSeededFunctionScoped(
    state,
    args,
    scopedOptions,
  );
  if (options?.commit ?? true) {
    state.schema = run.schema;
    state.currentSeed = run.legacySeed;
    state.currentValues = { ...run.values };
    state.currentOutput = run.output;
    state.currentTreeSeed = run.tree;
    state.currentTrace = run.trace;
  }
  return run;
}

function hasOwnProperty(
  value: object,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export async function invokeSeededFunctionScoped<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  args: Args,
  options?: {
    seed?: Seed | null;
    tree?: RuntimeTreeNode | null;
    path?: string;
    key?: string;
    cache?: TreeInvocationCache | null;
    seedBank?: false | SeedBankOptions;
    timeouts?: { runMs?: number };
  },
): Promise<InvocationResult<Output>> {
  const path = options?.path ?? "";
  const key = options?.key ?? "";
  const session = createDiscoverySession(state.meta);
  const hasExplicitTree = hasOption(options, "tree");
  const hasExplicitSeed = hasOption(options, "seed");
  const sourceTree = resolveOptionalOption(options, "tree", state.currentTreeSeed);
  const sourceSeed = resolveOptionalOption(options, "seed", sourceTree?.seed ?? state.currentSeed);
  const sourceValues = hasExplicitSeed
    ? sourceSeed && state.schema
      ? legacySeedToValues(state.schema, sourceSeed)
      : null
    : sourceTree?.values
      ? structuredClone(sourceTree.values)
      : sourceSeed && state.schema
        ? legacySeedToValues(state.schema, sourceSeed)
        : null;
  const sourceFieldValues = sourceSeed ? legacySeedToFieldValueMap(sourceSeed) : null;
  const pendingChecks: Array<Promise<void>> = [];
  const warnings: string[] = [];
  const values: SeedValueMap = sourceValues ? { ...sourceValues } : {};
  const childNodes = new Map<string, RuntimeTreeNode>();
  const childTraces: DomainTraceNode[] = [];
  const behaviorValues = new Map<string, number>();
  const domainEdges = new Map<string, RuntimeDomainEdge>();

  const dollar = createDollar(
    state,
    session,
    values,
    pendingChecks,
    warnings,
    sourceFieldValues,
    {
      path,
      sourceTree,
      childNodes,
      childTraces,
      behaviorValues,
      domainEdges,
      cache: options?.cache ?? null,
      seedBankOptions: options?.seedBank,
      timeouts: options?.timeouts,
    },
  );

  const output = await withTimeout(
    Promise.resolve(state.fn(dollar, ...args)),
    options?.timeouts?.runMs,
    "Seeded function run",
  );
  await Promise.all(pendingChecks);

  const discoveredSchema = session.freeze();
  if (state.schema) {
    validateSchemaCompatibility(state.schema, discoveredSchema);
  }

  const schema = state.schema ?? discoveredSchema;
  const scopedSchemaFingerprint = schemaFingerprint(schema);

  if (sourceSeed) {
    assertSeedMatchesSchema(schema, sourceSeed);
  }
  if (
    sourceTree &&
    hasExplicitTree &&
    sourceTree.meta.schemaFingerprint !== scopedSchemaFingerprint
  ) {
    throw new SchemaDriftError(
      `Detected schema drift for ${schema.meta.name}. Tree seed schema fingerprint does not match the current wrapper schema; bump meta.version to create a new stable schema.`,
    );
  }

  for (const param of schema.params) {
    if (!Object.prototype.hasOwnProperty.call(values, param.name)) {
      values[param.name] = sourceFieldValues?.get(param.fieldId) ??
        (materializeInitialValue(param.spec) as SeedScalar);
    }
  }

  const generation = sourceSeed?.header.generation ?? 0;
  const legacySeed = snapshotToLegacySeed(schema, values, generation);
  const tree = createRuntimeTreeNode({
    path,
    key,
    meta: runtimeTreeMetaFromSchemaMeta(schema.meta, scopedSchemaFingerprint),
    schema,
    seed: legacySeed,
    values,
    behaviors: Object.fromEntries(behaviorValues),
    edges: Array.from(domainEdges.values()),
    children: Array.from(childNodes.values()),
  });
  const trace = buildDomainTraceNode({
    path,
    meta: tree.meta,
    seedHash: legacySeed.contentHash,
    output,
    warnings,
    behaviors: tree.behaviors,
    edges: tree.edges,
    children: childTraces,
  });

  return {
    output,
    schema,
    values: { ...values },
    legacySeed,
    warnings,
    tree,
    trace,
  };
}

function createDollar<Args extends unknown[], Output>(
  ownerState: WrapperState<Args, Output>,
  session: ReturnType<typeof createDiscoverySession>,
  values: SeedValueMap,
  pendingChecks: Array<Promise<void>>,
  warnings: string[],
  sourceFieldValues: Map<number, SeedScalar> | null,
  hierarchy: {
    path: string;
    sourceTree: RuntimeTreeNode | null;
    childNodes: Map<string, RuntimeTreeNode>;
    childTraces: DomainTraceNode[];
    behaviorValues: Map<string, number>;
    domainEdges: Map<string, RuntimeDomainEdge>;
    cache: TreeInvocationCache | null;
    seedBankOptions?: false | SeedBankOptions;
    timeouts?: { runMs?: number };
  },
): Dollar {
  const callable = (<T extends SeedScalar>(name: string, spec: ParamSpec<T>): T => {
    const param = session.registerParam(name, spec);
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      values[name] = sourceFieldValues?.get(param.fieldId) ??
        (materializeInitialValue(param.spec) as SeedScalar);
    }
    return values[name] as T;
  }) as Dollar;

  callable.rel = (source, target, spec) => {
    session.registerRelation(source, target, spec);
  };

  callable.check = (name, predicate, spec) => {
    session.registerCheck(name, spec);
    const run = Promise.resolve(predicate()).then((passed) => {
      if (passed) return;
      const message = spec?.message ?? `Check "${name}" failed`;
      if ((spec?.enforcement ?? "reject") === "warn") {
        warnings.push(message);
        return;
      }
      throw new ValidationRejectedError(message);
    });
    pendingChecks.push(run);
    return run;
  };

  callable.domain = async <SubArgs extends unknown[], SubOutput>(
    name: string,
    subFn: SeededFunction<SubArgs, SubOutput>,
    args: SubArgs,
    options?: DomainInvokeOptions,
  ): Promise<SubOutput> => {
    const childState = getRequiredWrapperState(subFn);
    ensureSeedBankService(childState, hierarchy.seedBankOptions);
    const normalizedName = normalizeSlotName(name);
    const childKey = normalizedName;
    const childPath = makeChildPath(hierarchy.path, childKey);
    const sourceChildTree = hierarchy.sourceTree?.children.get(childKey) ?? null;
    const childSeed = await resolveDomainSeed(
      ownerState,
      childState,
      sourceChildTree,
      hierarchy.path,
      args,
      hierarchy.seedBankOptions,
      options,
    );
    const cacheKey = buildChildCacheKey(
      hierarchy.cache,
      childState,
      sourceChildTree,
      childSeed,
      args,
    );
    if (cacheKey) {
      const cached = hierarchy.cache?.get(cacheKey, childPath, childKey);
      if (cached) {
        const processedCached = processChildDomainRun(
          childPath,
          cached,
          options,
          warnings,
        );
        session.registerDomainSlot({
          name: normalizedName,
          path: normalizedName,
          mode: "single",
          child: {
            id: processedCached.schema.meta.stableId,
            version: processedCached.schema.meta.version,
            name: processedCached.schema.meta.name,
            domainUuid: processedCached.schema.meta.domainUuid,
            schemaFingerprint: schemaFingerprint(processedCached.schema),
          },
        });
        attachChildInvocation(hierarchy, childKey, processedCached);
        return processedCached.output as SubOutput;
      }
    }
    const childRun = await invokeSeededFunctionScoped(
      childState,
      args,
      {
        seed: childSeed,
        tree: sourceChildTree,
        path: childPath,
        key: childKey,
        cache: hierarchy.cache,
        seedBank: hierarchy.seedBankOptions,
        timeouts: hierarchy.timeouts,
      },
    );
    cacheKey && hierarchy.cache?.set(cacheKey, childRun);
    const processedChildRun = processChildDomainRun(
      childPath,
      childRun,
      options,
      warnings,
    );
    session.registerDomainSlot({
      name: normalizedName,
      path: normalizedName,
      mode: "single",
      child: {
        id: processedChildRun.schema.meta.stableId,
        version: processedChildRun.schema.meta.version,
        name: processedChildRun.schema.meta.name,
        domainUuid: processedChildRun.schema.meta.domainUuid,
        schemaFingerprint: schemaFingerprint(processedChildRun.schema),
      },
    });
    attachChildInvocation(hierarchy, childKey, processedChildRun);
    return processedChildRun.output;
  };

  callable.domainList = async <Item, SubArgs extends unknown[], SubOutput>(
    name: string,
    items: readonly Item[],
    keyFn: (item: Item, index: number) => string | number,
    subFn: SeededFunction<SubArgs, SubOutput>,
    argsFn: (item: Item, index: number) => SubArgs,
    options?: DomainInvokeOptions,
  ) => {
    const childState = getRequiredWrapperState(subFn);
    ensureSeedBankService(childState, hierarchy.seedBankOptions);
    const normalizedName = normalizeSlotName(name);
    const slotPath = `${normalizedName}[]`;
    const results: SubOutput[] = [];
    const seenKeys = new Set<string>();

    if (items.length === 0) {
      if (!childState.schema) {
        throw new SchemaDeclarationError(
          `Domain list "${normalizedName}" cannot be discovered from an empty collection before the child schema is known.`,
        );
      }
      session.registerDomainSlot({
        name: normalizedName,
        path: slotPath,
        mode: "list",
        child: {
          id: childState.schema.meta.stableId,
          version: childState.schema.meta.version,
          name: childState.schema.meta.name,
          domainUuid: childState.schema.meta.domainUuid,
          schemaFingerprint: schemaFingerprint(childState.schema),
        },
      });
      return results;
    }

    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      const key = normalizeCollectionKey(normalizedName, keyFn(item, index));
      const childKey = makeListChildKey(normalizedName, key);
      if (seenKeys.has(childKey)) {
        throw new SchemaDeclarationError(
          `Domain list "${normalizedName}" produced duplicate key "${key}"`,
        );
      }
      seenKeys.add(childKey);
      const childPath = makeChildPath(hierarchy.path, childKey);
      const sourceChildTree = hierarchy.sourceTree?.children.get(childKey) ?? null;
      const childArgs = argsFn(item, index);
      const childSeed = await resolveDomainSeed(
        ownerState,
        childState,
        sourceChildTree,
        hierarchy.path,
        childArgs,
        hierarchy.seedBankOptions,
        options,
      );
      const cacheKey = buildChildCacheKey(
        hierarchy.cache,
        childState,
        sourceChildTree,
        childSeed,
        childArgs,
      );
      if (cacheKey) {
        const cached = hierarchy.cache?.get(cacheKey, childPath, childKey);
        if (cached) {
          const processedCached = processChildDomainRun(
            childPath,
            cached,
            options,
            warnings,
          );
          session.registerDomainSlot({
            name: normalizedName,
            path: slotPath,
            mode: "list",
            child: {
              id: processedCached.schema.meta.stableId,
              version: processedCached.schema.meta.version,
              name: processedCached.schema.meta.name,
              domainUuid: processedCached.schema.meta.domainUuid,
              schemaFingerprint: schemaFingerprint(processedCached.schema),
            },
          });
          attachChildInvocation(hierarchy, childKey, processedCached);
          results.push(processedCached.output as SubOutput);
          continue;
        }
      }
      const childRun = await invokeSeededFunctionScoped(
        childState,
        childArgs,
        {
          seed: childSeed,
          tree: sourceChildTree,
          path: childPath,
          key: childKey,
          cache: hierarchy.cache,
          seedBank: hierarchy.seedBankOptions,
          timeouts: hierarchy.timeouts,
        },
      );
      cacheKey && hierarchy.cache?.set(cacheKey, childRun);
      const processedChildRun = processChildDomainRun(
        childPath,
        childRun,
        options,
        warnings,
      );
      session.registerDomainSlot({
        name: normalizedName,
        path: slotPath,
        mode: "list",
        child: {
          id: processedChildRun.schema.meta.stableId,
          version: processedChildRun.schema.meta.version,
          name: processedChildRun.schema.meta.name,
          domainUuid: processedChildRun.schema.meta.domainUuid,
          schemaFingerprint: schemaFingerprint(processedChildRun.schema),
        },
      });
      attachChildInvocation(hierarchy, childKey, processedChildRun);
      results.push(processedChildRun.output);
    }

    return results;
  };

  callable.behavior = (name, value) => {
    if (!Number.isFinite(value)) {
      throw new SchemaDeclarationError(
        `Behavior "${name}" must be a finite numeric value`,
      );
    }
    const behavior = session.registerBehavior(name);
    const previous = hierarchy.behaviorValues.get(behavior.name);
    if (previous !== undefined && !Object.is(previous, value)) {
      throw new SchemaDeclarationError(
        `Behavior "${behavior.name}" was reported more than once with incompatible values`,
      );
    }
    hierarchy.behaviorValues.set(behavior.name, value);
  };

  callable.domainRel = (source, target, spec) => {
    const relation = session.registerDomainRelation(source, target, spec);
    if (hierarchy.domainEdges.has(relation.name)) {
      return;
    }
    const sourceEdge = hierarchy.sourceTree?.edges.find((edge) => edge.name === relation.name);
    hierarchy.domainEdges.set(relation.name, {
      name: relation.name,
      ownerPath: hierarchy.path,
      source: sourceEdge?.source ?? absolutizeRelationEndpoint(hierarchy.path, relation.source),
      target: sourceEdge?.target ?? absolutizeRelationEndpoint(hierarchy.path, relation.target),
      kind: sourceEdge?.kind ?? relation.spec.kind,
      weight: sourceEdge?.weight ?? relation.spec.weight,
      params:
        sourceEdge?.params
          ? structuredClone(sourceEdge.params)
          : relation.spec.params
            ? structuredClone(relation.spec.params)
            : undefined,
    });
  };

  return callable;
}

function attachChildInvocation(
  hierarchy: {
    childNodes: Map<string, RuntimeTreeNode>;
    childTraces: DomainTraceNode[];
  },
  childKey: string,
  childRun: InvocationResult<unknown>,
): void {
  if (hierarchy.childNodes.has(childKey)) {
    throw new SchemaDeclarationError(
      `Domain path "${childRun.tree.path}" was invoked more than once in the same run`,
    );
  }
  hierarchy.childNodes.set(childKey, childRun.tree);
  hierarchy.childTraces.push(childRun.trace);
}

function getRequiredWrapperState<Args extends unknown[], Output>(
  wrapped: SeededFunction<Args, Output>,
): WrapperState<Args, Output> {
  const childState = getWrapperState<Args, Output>(wrapped as object);
  if (!childState) {
    throw new SchemaDeclarationError(
      "Expected $.domain()/$.domainList() to receive a seeded function created by seed(...)",
    );
  }
  return childState;
}

async function resolveDomainSeed<OwnerArgs extends unknown[], OwnerOutput, ChildArgs extends unknown[], ChildOutput>(
  ownerState: WrapperState<OwnerArgs, OwnerOutput>,
  childState: WrapperState<ChildArgs, ChildOutput>,
  sourceTree: RuntimeTreeNode | null,
  ownerPath: string,
  args: ChildArgs,
  seedBankOptions: false | SeedBankOptions | undefined,
  options?: DomainInvokeOptions,
): Promise<Seed | null> {
  if (sourceTree?.seed) {
    return sourceTree.seed;
  }
  const reuse = options?.reuse ?? "default";
  const shouldWarmFromBank = reuse === "bank-best" ||
    reuse === "bank-nearest" ||
    options?.behaviorTarget !== undefined;
  if (!shouldWarmFromBank) {
    return null;
  }
  const childSchemaFingerprint = sourceTree?.meta.schemaFingerprint ??
    (childState.schema ? schemaFingerprint(childState.schema) : null);
  return chooseSeedFromSeedBank(
    childState,
    {
      seedBank:
        childState.seedBank
          ? { path: childState.seedBank.basePath }
          : seedBankOptions ?? {},
      schemaFingerprint: childSchemaFingerprint ?? null,
      reuse: reuse === "default" ? "bank-nearest" : reuse,
      behaviorTarget: options?.behaviorTarget,
      args,
      ownerId: ownerState.meta.stableId ?? ownerState.meta.runtimeId,
      ownerPath: ownerPath || "root",
      parentSeedHash: sourceTree?.seed.contentHash,
    },
  );
}

function processChildDomainRun<Output>(
  childPath: string,
  childRun: InvocationResult<Output>,
  options: DomainInvokeOptions | undefined,
  ownerWarnings: string[],
): InvocationResult<Output> {
  const nextRun: InvocationResult<Output> = {
    ...childRun,
    warnings: [...childRun.warnings],
    tree: childRun.tree,
    trace: childRun.trace,
  };
  const behaviorWarnings = buildBehaviorTargetWarnings(
    childPath,
    childRun.tree.behaviors,
    options?.behaviorTarget,
  );
  if (behaviorWarnings.length > 0) {
    nextRun.warnings.push(...behaviorWarnings);
    nextRun.trace.warnings.push(...behaviorWarnings);
    ownerWarnings.push(...behaviorWarnings);
  }
  validateBehaviorConstraints(
    childPath,
    childRun.tree.behaviors,
    options?.behaviorConstraints,
  );
  return nextRun;
}

function buildChildCacheKey<Args extends unknown[], Output>(
  cache: TreeInvocationCache | null,
  childState: WrapperState<Args, Output>,
  sourceTree: RuntimeTreeNode | null,
  sourceSeed: Seed | null,
  args: unknown,
): string | null {
  if (!cache) {
    return null;
  }
  const schema = childState.schema;
  const schemaFp = sourceTree?.meta.schemaFingerprint ??
    (schema ? schemaFingerprint(schema) : null);
  if (!schemaFp) {
    return null;
  }
  return createTreeCacheKey({
    domainId: childState.meta.stableId ?? childState.meta.runtimeId,
    version: childState.meta.version,
    schemaFingerprint: schemaFp,
    seedSignature: resolveRuntimeTreeSeedSignature(sourceTree, sourceSeed),
    args,
  });
}

function resolveOptionalOption<T>(
  options: { [key: string]: unknown } | undefined,
  key: string,
  fallback: T,
): T {
  if (options && Object.prototype.hasOwnProperty.call(options, key)) {
    return (options[key] as T | null | undefined) ?? (null as T);
  }
  return fallback;
}

function hasOption(
  options: { [key: string]: unknown } | undefined,
  key: string,
): boolean {
  return Boolean(options && Object.prototype.hasOwnProperty.call(options, key));
}

function normalizeSlotName(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new SchemaDeclarationError("Domain slot names must not be empty");
  }
  return normalized;
}

function normalizeCollectionKey(
  slotName: string,
  key: string | number,
): string | number {
  if (typeof key === "number") {
    if (!Number.isFinite(key)) {
      throw new SchemaDeclarationError(
        `Domain list "${slotName}" returned a non-finite numeric key`,
      );
    }
    return key;
  }
  const normalized = key.trim();
  if (!normalized) {
    throw new SchemaDeclarationError(
      `Domain list "${slotName}" returned an empty key`,
    );
  }
  return normalized;
}

function absolutizeRelationEndpoint(ownerPath: string, endpoint: string): string {
  if (endpoint.startsWith("behavior:")) {
    return absoluteBehaviorPath(ownerPath, endpoint.slice("behavior:".length));
  }
  if (endpoint.startsWith("param:")) {
    return `param:${absoluteDomainPath(ownerPath, endpoint.slice("param:".length))}`;
  }
  return absoluteDomainPath(ownerPath, endpoint);
}
