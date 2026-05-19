import type {
  CliTuneOptions,
  Habit,
  HierarchicalMutationMix,
  MutationTrace,
  TuneOptions,
} from "../../public/tune.ts";
import type { RadiusSetting } from "../compat/mutation.ts";
import type { RelationKind, SeedScalar } from "../../public/dollar.ts";
import {
  legacySeedToValues,
  snapshotToLegacySeed,
  type SeedValueMap,
} from "../seed/snapshot.ts";
import {
  creditKeyForEdge,
  creditKeyForField,
  creditKeyForPath,
} from "./credit.ts";
import type { SeedBankDonorIndex } from "./seed-bank.ts";
import {
  cloneRuntimeTreeNode,
  countRuntimePathDepth,
  findRuntimeTreeNode,
  listRuntimeTreeNodes,
  splitRuntimePath,
  type RuntimeTreeNode,
} from "../runtime/tree.ts";
import type { SchemaSnapshot, DiscoveredParam } from "../schema/discovery.ts";
import { canonicalSerialize } from "../utils/canonical.ts";

type HierarchicalMutationOptions =
  Pick<
    TuneOptions<unknown[], unknown> | CliTuneOptions<unknown[], unknown>,
    "domainLock" | "domainFocus" | "depthLimit" | "hierarchical"
  > & {
    exploratory?: boolean;
    domainCredits?: Record<string, number>;
    seedBankDonors?: SeedBankDonorIndex;
    activeHabits?: Habit[];
  };

export interface HierarchicalMutationResult {
  tree: RuntimeTreeNode;
  mutations: MutationTrace[];
}

interface EdgeTarget {
  owner: RuntimeTreeNode;
  edgeIndex: number;
}

interface RelationEndpointRef {
  kind: "domain" | "behavior" | "param";
  path: string;
  name?: string;
}

interface HabitBiasIndex {
  path: Map<string, number>;
  param: Map<string, number>;
  behavior: Map<string, number>;
  relation: Map<string, number>;
}

export interface SpecificMutationTarget {
  path: string;
  kind: "param" | "relation";
  name: string;
}

const DEFAULT_MUTATION_MIX: HierarchicalMutationMix = {
  singleTargetRatio: 0.35,
  highImpactRatio: 0.30,
  exploratorySwapRatio: 0.20,
  parentRootRatio: 0.10,
  domainRelationRatio: 0.05,
};

export function shouldUseHierarchicalMutation(
  tree: RuntimeTreeNode | null,
  schema: SchemaSnapshot,
): tree is RuntimeTreeNode {
  return Boolean(tree && schema.domainSlots.length > 0 && tree.children.size > 0);
}

export function mutateHierarchicalTree(
  rootTree: RuntimeTreeNode,
  radius: RadiusSetting,
  prng: () => number,
  options: HierarchicalMutationOptions = {},
): HierarchicalMutationResult {
  const nextTree = cloneRuntimeTreeNode(rootTree);
  const habitBias = buildHabitBiasIndex(options.activeHabits);
  const mix = resolveMutationMix(options.hierarchical?.mutationMix);
  const domainLock = normalizePaths(options.domainLock);
  const domainFocus = normalizePaths(options.domainFocus);
  const depthLimit = Math.max(1, options.depthLimit ?? 2);
  const childNodes = collectMutatableNodes(nextTree, depthLimit, domainLock, domainFocus);
  const edgeTargets = collectEdgeTargets(nextTree, depthLimit, domainLock, domainFocus);
  const canMutateRoot = hasMutableParams(nextTree);

  if (options.exploratory && childNodes.length > 0) {
    const mutations = mutateViaSwap(
      nextTree,
      childNodes,
      radius,
      prng,
      true,
      options.seedBankDonors,
    );
    return { tree: nextTree, mutations };
  }

  const plan = chooseMutationPlan(prng, mix, {
    canMutateRoot,
    hasChildren: childNodes.length > 0,
    hasEdges: edgeTargets.length > 0,
  });

  switch (plan) {
    case "single-target":
      return {
        tree: nextTree,
        mutations: mutateSingleTarget(
          nextTree,
          childNodes,
          radius,
          prng,
          options.domainCredits,
          habitBias,
        ),
      };
    case "high-impact":
      return {
        tree: nextTree,
        mutations: mutateHighImpact(
          nextTree,
          childNodes,
          radius,
          prng,
          options.domainCredits,
          habitBias,
        ),
      };
    case "swap":
      return {
        tree: nextTree,
        mutations: mutateViaSwap(
          nextTree,
          childNodes,
          radius,
          prng,
          false,
          options.seedBankDonors,
        ),
      };
    case "parent":
      return {
        tree: nextTree,
        mutations: canMutateRoot
          ? [mutateNodeParam(nextTree, nextTree, radius, prng, "parent-param", false, undefined, options.domainCredits, undefined, habitBias)]
          : mutateSingleTarget(
            nextTree,
            childNodes,
            radius,
            prng,
            options.domainCredits,
            habitBias,
          ),
      };
    case "relation":
      return {
        tree: nextTree,
        mutations: mutateDomainRelation(
          nextTree,
          edgeTargets,
          radius,
          prng,
          options.domainCredits,
          habitBias,
        ),
      };
  }
}

export function mutateSpecificHierarchicalTarget(
  rootTree: RuntimeTreeNode,
  target: SpecificMutationTarget,
  radius: RadiusSetting,
  prng: () => number,
): HierarchicalMutationResult {
  const nextTree = cloneRuntimeTreeNode(rootTree);
  const node = target.path
    ? listRuntimeTreeNodes(nextTree).find((candidate) => candidate.path === target.path) ?? null
    : nextTree;
  if (!node) {
    return { tree: nextTree, mutations: [] };
  }
  if (target.kind === "param") {
    if (!hasMutableParams(node)) {
      return { tree: nextTree, mutations: [] };
    }
    return {
      tree: nextTree,
      mutations: [
        mutateNodeParam(
          nextTree,
          node,
          radius,
          prng,
          target.path ? "sub-seed-internal" : "parent-param",
          true,
          "credit probe",
          undefined,
          target.name,
          undefined,
        ),
      ],
    };
  }

  const edgeIndex = node.edges.findIndex((edge) => edge.name === target.name);
  if (edgeIndex < 0) {
    return { tree: nextTree, mutations: [] };
  }
  return {
    tree: nextTree,
    mutations: mutateDomainRelation(
      nextTree,
      [{ owner: node, edgeIndex }],
      radius,
      prng,
      undefined,
      undefined,
      target.name,
    ),
  };
}

export function accumulateMutationCredits(
  current: Record<string, number>,
  mutations: MutationTrace[] | undefined,
): Record<string, number> {
  if (!mutations || mutations.length === 0) {
    return { ...current };
  }
  const next = { ...current };
  for (const mutation of mutations) {
    const pathKey = mutation.path || "root";
    next[pathKey] = (next[pathKey] ?? 0) + 1;
    for (const fieldName of mutation.changedFieldNames) {
      const fieldKey = pathKey === "root" ? `root.${fieldName}` : `${pathKey}.${fieldName}`;
      next[fieldKey] = (next[fieldKey] ?? 0) + 1;
    }
    for (const relationName of mutation.changedRelationNames ?? []) {
      const relationKey = pathKey === "root"
        ? `root::${relationName}`
        : `${pathKey}::${relationName}`;
      next[relationKey] = (next[relationKey] ?? 0) + 1;
    }
  }
  return next;
}

export function summarizeMutationTrace(mutations: MutationTrace[] | undefined): string {
  if (!mutations || mutations.length === 0) {
    return "none";
  }
  return mutations
    .slice(0, 2)
    .map((mutation) => {
      const path = mutation.path || "root";
      const target = mutation.changedFieldNames[0] ??
        mutation.changedRelationNames?.[0] ??
        "seed";
      return `${path}:${mutation.strategy}:${target}`;
    })
    .join(", ");
}

function mutateSingleTarget(
  root: RuntimeTreeNode,
  childNodes: RuntimeTreeNode[],
  radius: RadiusSetting,
  prng: () => number,
  domainCredits?: Record<string, number>,
  habitBias?: HabitBiasIndex,
): MutationTrace[] {
  const candidates = hasMutableParams(root) ? [root, ...childNodes] : [...childNodes];
  const target = pickWeighted(
    candidates,
    prng,
    (node) =>
      1 +
      lookupCredit(domainCredits, creditKeyForPath(node.path)) +
      computeRelationPathBias(root, node.path, domainCredits) +
      lookupHabitPathBias(habitBias, node.path),
  );
  if (!target) {
    return [];
  }
  const strategy = target.path ? "sub-seed-internal" : "parent-param";
  return [
    mutateNodeParam(
      root,
      target,
      radius,
      prng,
      strategy,
      false,
      undefined,
      domainCredits,
      undefined,
      habitBias,
    ),
  ];
}

function mutateHighImpact(
  root: RuntimeTreeNode,
  childNodes: RuntimeTreeNode[],
  radius: RadiusSetting,
  prng: () => number,
  domainCredits?: Record<string, number>,
  habitBias?: HabitBiasIndex,
): MutationTrace[] {
  const candidates = hasMutableParams(root) ? [root, ...childNodes] : [...childNodes];
  const target = pickWeighted(
    candidates,
    prng,
    (node) =>
      computeImpactWeight(node) +
      lookupCredit(domainCredits, creditKeyForPath(node.path)) * 2 +
      computeRelationPathBias(root, node.path, domainCredits) +
      lookupHabitPathBias(habitBias, node.path),
  );
  if (!target) {
    return [];
  }
  const strategy = target.path ? "sub-seed-internal" : "parent-param";
  return [
    mutateNodeParam(
      root,
      target,
      radius,
      prng,
      strategy,
      true,
      undefined,
      domainCredits,
      undefined,
      habitBias,
    ),
  ];
}

function mutateViaSwap(
  root: RuntimeTreeNode,
  childNodes: RuntimeTreeNode[],
  radius: RadiusSetting,
  prng: () => number,
  exploratory: boolean,
  seedBankDonors?: SeedBankDonorIndex,
): MutationTrace[] {
  const target = pickWeighted(childNodes, prng, (node) => computeImpactWeight(node));
  if (!target) {
    return hasMutableParams(root)
      ? [mutateNodeParam(root, root, radius, prng, "parent-param", exploratory)]
      : [];
  }
  const donors = listRuntimeTreeNodes(root)
    .filter((candidate) =>
      candidate.path !== target.path &&
      candidate.meta.schemaFingerprint === target.meta.schemaFingerprint &&
      candidate.seed.contentHash !== target.seed.contentHash &&
      isSeedCompatibleWithNode(target, candidate.seed)
    );
  const bankDonors = (seedBankDonors?.[target.path] ?? [])
    .filter((donor) => isSeedCompatibleWithNode(target, donor.seed));
  const previousSeedHash = target.seed.contentHash;
  if (donors.length === 0 && bankDonors.length === 0) {
    return [
      mutateNodeParam(
        root,
        target,
        radius,
        prng,
        "sub-seed-swap-random",
        exploratory,
        "fallback internal mutation; no compatible donor seed was available",
        undefined,
        undefined,
        undefined,
      ),
    ];
  }

  const treeDonorWeight = donors.length;
  const bankDonorWeight = bankDonors.length > 0 ? bankDonors.length * 1.5 : 0;
  const useBankDonor = bankDonors.length > 0 &&
    (donors.length === 0 || prng() * (treeDonorWeight + bankDonorWeight) >= treeDonorWeight);
  const bankDonor = useBankDonor
    ? bankDonors[Math.floor(prng() * bankDonors.length)]!
    : null;
  const treeDonor = !useBankDonor
    ? donors[Math.floor(prng() * donors.length)]!
    : null;
  const donorLabel = bankDonor?.label ?? treeDonor?.path ?? "root";
  if (useBankDonor) {
    target.seed = structuredClone(bankDonor!.seed);
    target.values = bankDonor!.values ? structuredClone(bankDonor!.values) : null;
  } else {
    target.seed = cloneRuntimeTreeNode(treeDonor!).seed;
    target.values = treeDonor!.values ? structuredClone(treeDonor!.values) : null;
  }
  const changed = describeChangedParams(
    target.schema,
    previousSeedHash,
    target.seed.contentHash,
    legacySeedToValues(target.schema!, target.seed),
    target.values ?? legacySeedToValues(target.schema!, target.seed),
  );
  return [{
    path: target.path,
    strategy: "sub-seed-swap-random",
    changedFieldIds: changed.changedFieldIds,
    changedFieldNames: changed.changedFieldNames,
    radius: { ...radius },
    previousSeedHash,
    nextSeedHash: target.seed.contentHash,
    note: `donor=${donorLabel}`,
  }];
}

function mutateDomainRelation(
  root: RuntimeTreeNode,
  edgeTargets: EdgeTarget[],
  radius: RadiusSetting,
  prng: () => number,
  domainCredits?: Record<string, number>,
  habitBias?: HabitBiasIndex,
  specificRelationName?: string,
): MutationTrace[] {
  if (edgeTargets.length === 0) {
    return hasMutableParams(root)
      ? [mutateNodeParam(root, root, radius, prng, "parent-param", false, undefined, domainCredits, undefined, habitBias)]
      : [];
  }

  const target = pickWeighted(
    edgeTargets.filter((edgeTarget) =>
      !specificRelationName ||
      edgeTarget.owner.edges[edgeTarget.edgeIndex]?.name === specificRelationName
    ),
    prng,
    (edgeTarget) => {
      const edge = edgeTarget.owner.edges[edgeTarget.edgeIndex];
      if (!edge) return 0;
      return 1 +
        lookupCredit(domainCredits, creditKeyForEdge(edgeTarget.owner.path, edge.name)) +
        lookupHabitRelationBias(habitBias, edgeTarget.owner.path, edge.name) +
        computeRelationPathBias(root, edgeTarget.owner.path, domainCredits);
    },
  );
  if (!target) {
    return hasMutableParams(root)
      ? [mutateNodeParam(root, root, radius, prng, "parent-param", false, undefined, domainCredits, undefined, habitBias)]
      : [];
  }
  const edge = target.owner.edges[target.edgeIndex]!;
  const relationTrace = mutateRelationEdge(edge, target.owner.path, radius, prng);
  const traces: MutationTrace[] = [relationTrace];
  const connectedParam = resolveRelationDrivenParamTarget(root, target.owner, edge, prng);
  if (connectedParam) {
    traces.push(
      mutateNodeParam(
        root,
        connectedParam.node,
        radius,
        prng,
        "cross-domain-bond",
        true,
        `linked=${edge.name}`,
        domainCredits,
        connectedParam.paramName,
        habitBias,
      ),
    );
  }
  return traces;
}

function mutateRelationEdge(
  edge: RuntimeTreeNode["edges"][number],
  ownerPath: string,
  radius: RadiusSetting,
  prng: () => number,
): MutationTrace {
  const previousWeight = edge.weight ?? 1;
  const direction = prng() < 0.5 ? -1 : 1;
  const magnitude = Math.max(0.05, radius.bondEditRate * (0.5 + prng()));
  const nextWeight = clampNumber(previousWeight + direction * magnitude, -2, 2);
  edge.weight = nextWeight;
  const noteParts = [
    `weight ${formatCompactNumber(previousWeight)} -> ${formatCompactNumber(nextWeight)}`,
  ];
  if (isBroadRelationMutation(radius) && prng() < 0.35) {
    const nextKind = mutateRelationKind(edge.kind, prng);
    if (nextKind !== edge.kind) {
      const previousKind = edge.kind;
      edge.kind = nextKind;
      noteParts.push(`kind ${previousKind} -> ${nextKind}`);
    }
  }
  return {
    path: ownerPath,
    strategy: "cross-domain-bond",
    changedFieldIds: [],
    changedFieldNames: [],
    changedRelationNames: [edge.name],
    radius: { ...radius },
    note: noteParts.join("; "),
  };
}

function resolveRelationDrivenParamTarget(
  root: RuntimeTreeNode,
  owner: RuntimeTreeNode,
  edge: RuntimeTreeNode["edges"][number],
  prng: () => number,
): { node: RuntimeTreeNode; paramName?: string } | null {
  const endpoints = [parseRelationEndpoint(edge.source), parseRelationEndpoint(edge.target)];
  const candidates = endpoints
    .map((endpoint) => resolveEndpointMutationTarget(root, owner, endpoint))
    .filter((candidate): candidate is { node: RuntimeTreeNode; paramName?: string } => candidate !== null)
    .filter((candidate) => hasMutableParams(candidate.node));
  if (candidates.length === 0) {
    return hasMutableParams(owner) ? { node: owner } : null;
  }
  return candidates[Math.floor(prng() * candidates.length)] ?? candidates[0] ?? null;
}

function resolveEndpointMutationTarget(
  root: RuntimeTreeNode,
  owner: RuntimeTreeNode,
  endpoint: RelationEndpointRef,
): { node: RuntimeTreeNode; paramName?: string } | null {
  if (endpoint.kind === "domain") {
    const node = endpoint.path
      ? findRuntimeTreeNode(root, endpoint.path)
      : root;
    return node ? { node } : null;
  }
  if (endpoint.kind === "behavior") {
    const node = endpoint.path
      ? findRuntimeTreeNode(root, endpoint.path)
      : root;
    return node ? { node } : null;
  }
  const node = endpoint.path
    ? findRuntimeTreeNode(root, endpoint.path)
    : root;
  if (!node) {
    return null;
  }
  return {
    node,
    paramName: endpoint.name,
  };
}

function buildHabitBiasIndex(habits: Habit[] | undefined): HabitBiasIndex | undefined {
  if (!habits || habits.length === 0) {
    return undefined;
  }
  const index: HabitBiasIndex = {
    path: new Map(),
    param: new Map(),
    behavior: new Map(),
    relation: new Map(),
  };
  for (const habit of habits) {
    const strength = Math.max(0, habit.strength);
    const targetType = habit.action.targetType ?? "root-param";
    if (targetType === "root-param") {
      const name = habit.action.name ?? habit.action.parameter;
      bumpBias(index.path, creditKeyForPath(""), strength * 0.35);
      bumpBias(index.param, creditKeyForField("", name), strength);
      continue;
    }
    if (targetType === "sub-domain-param") {
      const path = habit.action.path ?? "";
      const name = habit.action.name ?? habit.action.parameter;
      bumpBias(index.path, creditKeyForPath(path), strength * 0.45);
      bumpBias(index.param, creditKeyForField(path, name), strength * 1.1);
      continue;
    }
    if (targetType === "behavior") {
      const path = habit.action.path ?? "";
      const name = habit.action.name ?? habit.action.parameter;
      bumpBias(index.path, creditKeyForPath(path), strength * 0.5);
      bumpBias(index.behavior, behaviorBiasKey(path, name), strength);
      continue;
    }
    if (targetType === "domain-relation") {
      const path = habit.action.path ?? "";
      const name = habit.action.name ?? habit.action.parameter;
      bumpBias(index.path, creditKeyForPath(path), strength * 0.25);
      bumpBias(index.relation, creditKeyForEdge(path, name), strength * 1.15);
    }
  }
  return index;
}

function bumpBias(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function lookupHabitPathBias(
  habitBias: HabitBiasIndex | undefined,
  path: string,
): number {
  if (!habitBias) {
    return 0;
  }
  return habitBias.path.get(creditKeyForPath(path)) ?? 0;
}

function lookupHabitParamBias(
  habitBias: HabitBiasIndex | undefined,
  path: string,
  name: string,
): number {
  if (!habitBias) {
    return 0;
  }
  return habitBias.param.get(creditKeyForField(path, name)) ?? 0;
}

function lookupHabitBehaviorBias(
  habitBias: HabitBiasIndex | undefined,
  path: string,
): number {
  if (!habitBias) {
    return 0;
  }
  let total = 0;
  for (const [key, value] of habitBias.behavior) {
    if (key.startsWith(`${creditKeyForPath(path)}#`)) {
      total += value * 0.35;
    }
  }
  return total;
}

function lookupHabitRelationBias(
  habitBias: HabitBiasIndex | undefined,
  path: string,
  relationName: string,
): number {
  if (!habitBias) {
    return 0;
  }
  return habitBias.relation.get(creditKeyForEdge(path, relationName)) ?? 0;
}

function behaviorBiasKey(path: string, name: string): string {
  return `${creditKeyForPath(path)}#${name}`;
}

function computeRelationPathBias(
  root: RuntimeTreeNode,
  path: string,
  domainCredits?: Record<string, number>,
): number {
  let total = 0;
  for (const node of listRuntimeTreeNodes(root)) {
    for (const edge of node.edges) {
      const influence = relationInfluence(edge, node.path, domainCredits);
      if (influence <= 0) {
        continue;
      }
      const source = parseRelationEndpoint(edge.source);
      const target = parseRelationEndpoint(edge.target);
      total += endpointPathAffinity(source, path) * influence;
      total += endpointPathAffinity(target, path) * influence;
    }
  }
  return total;
}

function computeRelationParamBias(
  root: RuntimeTreeNode,
  path: string,
  name: string,
  domainCredits?: Record<string, number>,
): number {
  let total = 0;
  for (const node of listRuntimeTreeNodes(root)) {
    for (const edge of node.edges) {
      const influence = relationInfluence(edge, node.path, domainCredits);
      if (influence <= 0) {
        continue;
      }
      total += endpointParamAffinity(parseRelationEndpoint(edge.source), path, name) * influence;
      total += endpointParamAffinity(parseRelationEndpoint(edge.target), path, name) * influence;
    }
  }
  return total;
}

function relationInfluence(
  edge: RuntimeTreeNode["edges"][number],
  ownerPath: string,
  domainCredits?: Record<string, number>,
): number {
  const credit = lookupCredit(domainCredits, creditKeyForEdge(ownerPath, edge.name));
  return relationKindBias(edge.kind) * (0.2 + Math.abs(edge.weight ?? 1) * 0.5) * (1 + credit);
}

function relationKindBias(kind: RelationKind): number {
  switch (kind) {
    case "amplify":
      return 0.95;
    case "weighted_sum":
      return 0.9;
    case "conditional_blend":
      return 0.85;
    case "threshold_gate":
      return 0.8;
    case "correlate":
      return 0.75;
    case "constrain":
      return 0.7;
    case "inhibit":
      return 0.65;
    case "sequence":
      return 0.6;
  }
}

function endpointPathAffinity(
  endpoint: RelationEndpointRef,
  path: string,
): number {
  if (endpoint.kind === "domain" || endpoint.kind === "behavior" || endpoint.kind === "param") {
    if (endpoint.path === path) {
      return endpoint.kind === "domain" ? 0.45 : endpoint.kind === "behavior" ? 0.55 : 0.7;
    }
  }
  return 0;
}

function endpointParamAffinity(
  endpoint: RelationEndpointRef,
  path: string,
  name: string,
): number {
  if (endpoint.kind === "param") {
    if (endpoint.path === path && endpoint.name === name) {
      return 0.95;
    }
    if (endpoint.path === path) {
      return 0.35;
    }
    return 0;
  }
  if (endpoint.path === path) {
    return endpoint.kind === "behavior" ? 0.55 : 0.2;
  }
  return 0;
}

function parseRelationEndpoint(endpoint: string): RelationEndpointRef {
  if (endpoint.startsWith("param:")) {
    const reference = endpoint.slice("param:".length);
    const split = splitParamReference(reference);
    return {
      kind: "param",
      path: split?.path ?? "",
      name: split?.name ?? reference,
    };
  }
  const hashIndex = endpoint.lastIndexOf("#");
  if (hashIndex >= 0) {
    return {
      kind: "behavior",
      path: endpoint.slice(0, hashIndex),
      name: endpoint.slice(hashIndex + 1),
    };
  }
  return {
    kind: "domain",
    path: endpoint,
  };
}

function splitParamReference(
  reference: string,
): { path: string; name: string } | null {
  const segments = splitRuntimePath(reference);
  if (segments.length === 0) {
    return null;
  }
  if (segments.length === 1) {
    return {
      path: "",
      name: segments[0]!,
    };
  }
  return {
    path: segments.slice(0, -1).join("."),
    name: segments[segments.length - 1]!,
  };
}

function isBroadRelationMutation(radius: RadiusSetting): boolean {
  return radius.bondEditRate >= 0.15 || radius.coreMutationMagnitude >= 0.15;
}

function mutateRelationKind(
  current: RelationKind,
  prng: () => number,
): RelationKind {
  const kinds: RelationKind[] = [
    "correlate",
    "constrain",
    "sequence",
    "inhibit",
    "amplify",
    "weighted_sum",
    "threshold_gate",
    "conditional_blend",
  ];
  const candidates = kinds.filter((kind) => kind !== current);
  return candidates[Math.floor(prng() * candidates.length)] ?? current;
}

function collectMutatableNodes(
  root: RuntimeTreeNode,
  depthLimit: number,
  locks: string[],
  focus: string[],
): RuntimeTreeNode[] {
  return listRuntimeTreeNodes(root)
    .filter((node) => node.path !== "")
    .filter((node) => countRuntimePathDepth(node.path) <= depthLimit)
    .filter((node) => hasMutableParams(node))
    .filter((node) => !isPathLocked(node.path, locks))
    .filter((node) => isPathFocused(node.path, focus));
}

function collectEdgeTargets(
  root: RuntimeTreeNode,
  depthLimit: number,
  locks: string[],
  focus: string[],
): EdgeTarget[] {
  const targets: EdgeTarget[] = [];
  for (const node of listRuntimeTreeNodes(root)) {
    if (countRuntimePathDepth(node.path) > depthLimit) continue;
    if (node.path && isPathLocked(node.path, locks)) continue;
    if (node.path && !isPathFocused(node.path, focus)) continue;
    for (let edgeIndex = 0; edgeIndex < node.edges.length; edgeIndex++) {
      targets.push({ owner: node, edgeIndex });
    }
  }
  return targets;
}

function chooseMutationPlan(
  prng: () => number,
  mix: HierarchicalMutationMix,
  availability: {
    canMutateRoot: boolean;
    hasChildren: boolean;
    hasEdges: boolean;
  },
): "single-target" | "high-impact" | "swap" | "parent" | "relation" {
  const plans: Array<{
    name: "single-target" | "high-impact" | "swap" | "parent" | "relation";
    weight: number;
  }> = [
    { name: "single-target", weight: mix.singleTargetRatio },
    { name: "high-impact", weight: mix.highImpactRatio },
    { name: "swap", weight: availability.hasChildren ? mix.exploratorySwapRatio : 0 },
    { name: "parent", weight: availability.canMutateRoot ? mix.parentRootRatio : 0 },
    { name: "relation", weight: availability.hasEdges ? mix.domainRelationRatio : 0 },
  ];
  const total = plans.reduce((sum, plan) => sum + Math.max(0, plan.weight), 0);
  if (total <= 0) {
    return availability.hasChildren ? "single-target" : "parent";
  }
  let cursor = prng() * total;
  for (const plan of plans) {
    cursor -= Math.max(0, plan.weight);
    if (cursor <= 0) {
      return plan.name;
    }
  }
  return plans[0]!.name;
}

function mutateNodeParam(
  root: RuntimeTreeNode,
  node: RuntimeTreeNode,
  radius: RadiusSetting,
  prng: () => number,
  strategy: MutationTrace["strategy"],
  preferImpact: boolean = false,
  note?: string,
  domainCredits?: Record<string, number>,
  specificParamName?: string,
  habitBias?: HabitBiasIndex,
): MutationTrace {
  if (!node.schema) {
    throw new Error(`Cannot mutate node ${node.path || "root"} without a discovered schema`);
  }
  const values = node.values ? structuredClone(node.values) : legacySeedToValues(node.schema, node.seed);
  const params = specificParamName
    ? node.schema.params.filter((candidate) => candidate.name === specificParamName)
    : node.schema.params;
  const param = pickWeighted(
    params,
    prng,
    (candidate) =>
      computeParamWeight(candidate, preferImpact) +
      lookupCredit(domainCredits, creditKeyForField(node.path, candidate.name)) +
      computeRelationParamBias(root, node.path, candidate.name, domainCredits) +
      lookupHabitParamBias(habitBias, node.path, candidate.name) +
      lookupHabitBehaviorBias(habitBias, node.path),
  );
  if (!param) {
    throw new Error(`Cannot mutate node ${node.path || "root"} because it has no params`);
  }

  const previousSeedHash = node.seed.contentHash;
  const previousValue = values[param.name];
  values[param.name] = mutateScalarValue(
    previousValue,
    param,
    radius,
    prng,
    preferImpact,
  );
  const nextSeed = snapshotToLegacySeed(
    node.schema,
    values,
    node.seed.header.generation + 1,
  );
  node.seed = nextSeed;
  node.values = structuredClone(values);
  return {
    path: node.path,
    strategy,
    changedFieldIds: [param.fieldId],
    changedFieldNames: [param.name],
    radius: { ...radius },
    previousSeedHash,
    nextSeedHash: nextSeed.contentHash,
    note,
  };
}

function hasMutableParams(node: RuntimeTreeNode): boolean {
  return Boolean(node.schema && node.schema.params.length > 0);
}

function isSeedCompatibleWithNode(node: RuntimeTreeNode, seed: RuntimeTreeNode["seed"]): boolean {
  return node.meta.acceptedDomainUuids.includes(seed.header.domainId);
}

function resolveMutationMix(
  partial?: Partial<HierarchicalMutationMix>,
): HierarchicalMutationMix {
  return {
    ...DEFAULT_MUTATION_MIX,
    ...(partial ?? {}),
  };
}

function normalizePaths(paths: string[] | undefined): string[] {
  return (paths ?? [])
    .map((path) => path.trim())
    .filter(Boolean);
}

function isPathLocked(path: string, locks: string[]): boolean {
  return locks.some((lock) => path === lock || path.startsWith(`${lock}.`) || path.startsWith(`${lock}[`));
}

function isPathFocused(path: string, focus: string[]): boolean {
  if (focus.length === 0) {
    return true;
  }
  return focus.some((candidate) =>
    path === candidate || path.startsWith(`${candidate}.`) || path.startsWith(`${candidate}[`)
  );
}

function lookupCredit(
  credits: Record<string, number> | undefined,
  key: string,
): number {
  if (!credits) return 0;
  return Math.max(0, credits[key] ?? 0);
}

function computeImpactWeight(node: RuntimeTreeNode): number {
  const paramCount = node.schema?.params.length ?? 0;
  return 1 + paramCount * 2 + node.children.size + node.edges.length;
}

function computeParamWeight(
  param: DiscoveredParam,
  preferImpact: boolean,
): number {
  if (!preferImpact) {
    return param.tier === "texture" ? 0.9 : 1;
  }
  const span = param.spec.range ? Math.abs(param.spec.range[1] - param.spec.range[0]) : 1;
  return 1 + span + (param.tier === "core" ? 2 : 0.5);
}

function mutateScalarValue(
  currentValue: SeedScalar,
  param: DiscoveredParam,
  radius: RadiusSetting,
  prng: () => number,
  exploratory: boolean,
): SeedScalar {
  const magnitude = resolveMagnitude(param, radius, exploratory);
  switch (param.spec.type) {
    case "bool":
      return !Boolean(currentValue);
    case "string":
      return mutateStringValue(typeof currentValue === "string" ? currentValue : "", prng, exploratory);
    case "bytes":
      return mutateBytesValue(
        currentValue instanceof Uint8Array ? currentValue : new Uint8Array(),
        prng,
        exploratory,
      );
    case "u64":
      return mutateUint64Value(currentValue, param, magnitude, prng);
    case "u8":
    case "u16":
    case "u32":
      return mutateIntegerValue(
        typeof currentValue === "number" ? currentValue : Number(currentValue),
        param,
        magnitude,
        prng,
      );
    case "f32":
    case "f64":
      return mutateFloatValue(
        typeof currentValue === "number" ? currentValue : Number(currentValue),
        param,
        magnitude,
        prng,
      );
  }
}

function resolveMagnitude(
  param: DiscoveredParam,
  radius: RadiusSetting,
  exploratory: boolean,
): number {
  const base = param.tier === "texture"
    ? Math.max(radius.textureEditMagnitude, radius.coreMutationMagnitude)
    : radius.coreMutationMagnitude;
  return exploratory ? Math.max(base * 1.8, 0.2) : Math.max(base, 0.05);
}

function mutateFloatValue(
  currentValue: number,
  param: DiscoveredParam,
  magnitude: number,
  prng: () => number,
): number {
  const min = param.spec.range?.[0] ?? Math.min(0, currentValue - 10);
  const max = param.spec.range?.[1] ?? Math.max(1, currentValue + 10);
  const span = Math.max(1e-6, max - min);
  const direction = prng() < 0.5 ? -1 : 1;
  let next = currentValue + direction * span * magnitude * (0.35 + prng() * 0.65);
  next = clampNumber(next, min, max);
  if (Object.is(next, currentValue)) {
    next = clampNumber(currentValue === min ? max : min, min, max);
  }
  return next;
}

function mutateIntegerValue(
  currentValue: number,
  param: DiscoveredParam,
  magnitude: number,
  prng: () => number,
): number {
  const min = Math.round(param.spec.range?.[0] ?? 0);
  const max = Math.round(param.spec.range?.[1] ?? Math.max(min + 1, currentValue + 5));
  const span = Math.max(1, max - min);
  const direction = prng() < 0.5 ? -1 : 1;
  let next = Math.round(currentValue + direction * Math.max(1, span * magnitude * (0.35 + prng() * 0.65)));
  next = clampNumber(next, min, max);
  if (next === currentValue) {
    next = currentValue === min ? max : min;
  }
  return next;
}

function mutateUint64Value(
  currentValue: SeedScalar,
  param: DiscoveredParam,
  magnitude: number,
  prng: () => number,
): bigint {
  const current = typeof currentValue === "bigint"
    ? currentValue
    : BigInt(Math.max(0, Number(currentValue)));
  const min = BigInt(Math.max(0, Math.round(param.spec.range?.[0] ?? 0)));
  const max = BigInt(Math.max(Number(min) + 1, Math.round(param.spec.range?.[1] ?? Number(current) + 5)));
  const span = max - min;
  const rawDelta = Number(span > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : span);
  const delta = BigInt(Math.max(1, Math.round(rawDelta * magnitude * (0.35 + prng() * 0.65))));
  let next = prng() < 0.5 ? current - delta : current + delta;
  if (next < min) next = min;
  if (next > max) next = max;
  if (next === current) {
    next = current === min ? max : min;
  }
  return next;
}

function mutateStringValue(
  current: string,
  prng: () => number,
  exploratory: boolean,
): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  if (!current) {
    return alphabet[Math.floor(prng() * alphabet.length)]!;
  }
  if (exploratory || current.length < 4) {
    return `${current}${alphabet[Math.floor(prng() * alphabet.length)]!}`;
  }
  const chars = current.split("");
  const index = Math.floor(prng() * chars.length);
  chars[index] = alphabet[Math.floor(prng() * alphabet.length)]!;
  const next = chars.join("");
  return next === current ? `${current}x` : next;
}

function mutateBytesValue(
  current: Uint8Array,
  prng: () => number,
  exploratory: boolean,
): Uint8Array {
  const next = new Uint8Array(current.length === 0 ? 1 : current.length);
  next.set(current.slice(0, next.length));
  const index = exploratory && next.length < 4
    ? next.length - 1
    : Math.floor(prng() * next.length);
  next[index] = Math.floor(prng() * 256);
  return next;
}

function pickWeighted<T>(
  items: readonly T[],
  prng: () => number,
  weightOf: (item: T) => number,
): T | null {
  if (items.length === 0) return null;
  const weighted = items.map((item) => ({
    item,
    weight: Math.max(0, weightOf(item)),
  }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    return items[Math.floor(prng() * items.length)] ?? null;
  }
  let cursor = prng() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.item;
    }
  }
  return weighted[weighted.length - 1]?.item ?? null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function describeChangedParams(
  schema: SchemaSnapshot | null,
  previousSeedHash: string,
  nextSeedHash: string,
  beforeValues: SeedValueMap,
  afterValues: SeedValueMap,
): {
  changedFieldIds: number[];
  changedFieldNames: string[];
} {
  if (!schema || previousSeedHash === nextSeedHash) {
    return { changedFieldIds: [], changedFieldNames: [] };
  }
  const changedFieldIds: number[] = [];
  const changedFieldNames: string[] = [];
  for (const param of schema.params) {
    if (!seedScalarEquals(beforeValues[param.name], afterValues[param.name])) {
      changedFieldIds.push(param.fieldId);
      changedFieldNames.push(param.name);
    }
  }
  return { changedFieldIds, changedFieldNames };
}

function seedScalarEquals(left: SeedScalar | undefined, right: SeedScalar | undefined): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return canonicalSerialize(Array.from(left)) === canonicalSerialize(Array.from(right));
  }
  if (typeof left === "bigint" || typeof right === "bigint") {
    return left === right;
  }
  return Object.is(left, right);
}
