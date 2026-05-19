import { join } from "node:path";

import type { SeedScalar } from "../../public/dollar.ts";
import type {
  ExperienceOptions,
  HierarchicalExperienceMetadata,
  HierarchicalExperienceBehaviorSnapshot,
  HierarchicalExperienceParamSnapshot,
  HierarchicalExperienceRelationSnapshot,
  ExperienceRecord,
  ExperienceStore,
  Habit,
  HabitStore,
  MutationTrace,
  DomainTraceNode,
  DomainTuneSummary,
} from "../../public/tune.ts";
import type { Seed } from "../compat/seed-format.ts";
import { buildDomainTuneSummaries } from "../hierarchical/credit.ts";
import { appendText, readText, writeText } from "../platform/files.ts";
import type { SchemaSnapshot } from "../schema/discovery.ts";
import { schemaFingerprint } from "../schema/validation.ts";
import {
  findRuntimeTreeNode,
  listRuntimeTreeNodes,
  splitRuntimePath,
  type RuntimeTreeNode,
} from "../runtime/tree.ts";
import {
  legacySeedToValues,
  snapshotToLegacySeed,
  type SeedValueMap,
} from "../seed/snapshot.ts";
import { fingerprintCanonicalValue } from "../utils/canonical.ts";
import { createRuntimeUuid } from "../utils/crypto.ts";

const MIN_HABIT_EVIDENCE = 3;

interface ExperienceQuery {
  domainUuid?: string;
  schemaFingerprint?: string;
  taskSignature?: string;
}

interface RecordCandidate<Output> {
  generation: number;
  batchAttempt: number;
  position?: number;
  sessionSeed: string;
  candidateSeed?: string;
  output: Output;
  score?: number;
  objectives?: Record<string, number>;
  seedHash: string;
  parentSeedHash?: string;
  values: Record<string, SeedScalar>;
  appliedHabitIds?: string[];
  tree?: RuntimeTreeNode | null;
  trace?: DomainTraceNode | null;
  mutations?: MutationTrace[];
  domainSummaries?: DomainTuneSummary[];
  domainCredits?: Record<string, number>;
  domainLock?: string[];
  domainFocus?: string[];
  depthLimit?: number;
}

interface SaveCandidate<Output> extends RecordCandidate<Output> {
  metadata?: Record<string, unknown>;
}

interface ExperienceService {
  getActiveHabits(): Habit[];
  applyHabitGuidance(seed: Seed, tree: RuntimeTreeNode | null, prng: () => number): {
    seed: Seed;
    tree: RuntimeTreeNode | null;
    appliedHabitIds: string[];
  };
  recordSelection<Output>(options: {
    candidates: Array<RecordCandidate<Output>>;
    winnerPosition: number;
    selector: "human" | "auto" | "custom";
    tags: string[];
  }): Promise<void>;
  recordSavedCandidate<Output>(options: {
    candidate: SaveCandidate<Output>;
    tags?: string[];
  }): Promise<void>;
}

export async function createExperienceService<Args extends unknown[]>(
  options: false | ExperienceOptions | undefined,
  schema: SchemaSnapshot,
  args: Args,
  mode: "tune" | "cli",
): Promise<ExperienceService | null> {
  if (!options) {
    return null;
  }

  const scopedSchemaFingerprint = schemaFingerprint(schema);
  const store = createExperienceStore(options, schema.meta.domainUuid, scopedSchemaFingerprint);
  const habitStore = store.habitStore ?? new InMemoryHabitStore();
  const captureMode = options.capture ?? "all-survivors";
  const taskSignature = fingerprintCanonicalValue(describeTaskFamily(args));
  const inputHash = fingerprintCanonicalValue(args);
  let habits = await refreshHabits(store, habitStore, schema.meta.domainUuid, scopedSchemaFingerprint);

  return {
    getActiveHabits() {
      return habits.filter((habit) => habit.trigger.taskSignature === taskSignature);
    },

    applyHabitGuidance(seed, tree, prng) {
      const activeHabits = habits.filter((habit) => habit.trigger.taskSignature === taskSignature);
      if (activeHabits.length === 0) {
        return { seed, tree, appliedHabitIds: [] };
      }

      const values = legacySeedToValues(schema, seed);
      const appliedHabitIds: string[] = [];
      let changed = false;
      let nextTree = tree;

      for (const habit of activeHabits) {
        const targetType = habit.action.targetType ?? "root-param";
        if (targetType === "root-param") {
          const paramName = habit.action.name ?? habit.action.parameter;
          const param = schema.paramsByName[paramName];
          if (!param) {
            continue;
          }
          const currentValue = values[param.name];
          const nextValue = applyHabitToValue(currentValue, param.spec, habit, prng);
          if (!seedScalarEquals(currentValue, nextValue)) {
            values[param.name] = nextValue;
            appliedHabitIds.push(habit.id);
            changed = true;
          }
          continue;
        }

        if (!nextTree) {
          continue;
        }

        const applied = applyHabitToTree(nextTree, habit, prng);
        if (applied) {
          appliedHabitIds.push(habit.id);
          changed = true;
        }
      }

      if (!changed) {
        return { seed, tree: nextTree, appliedHabitIds };
      }

      const guidedSeed = snapshotToLegacySeed(schema, values, seed.header.generation);
      if (nextTree) {
        nextTree.seed = guidedSeed;
        nextTree.values = structuredClone(values);
      }
      return {
        seed: guidedSeed,
        tree: nextTree,
        appliedHabitIds,
      };
    },

    async recordSelection({ candidates, winnerPosition, selector, tags }) {
      const winner = candidates.find((candidate) => candidate.position === winnerPosition);
      if (!winner) {
        return;
      }

      const records = candidates
        .filter((candidate) => captureMode === "all-survivors" || candidate.position === winnerPosition)
        .map((candidate) =>
          buildExperienceRecord(
            schema,
            {
              mode,
              selector,
              taskSignature,
              inputHash,
            },
            candidate,
            candidate.position === winnerPosition
              ? selector === "auto"
                ? ["selected", "auto-selected"]
                : selector === "human"
                  ? ["selected", "human-selected"]
                  : ["selected"]
              : ["rejected"],
            tags,
          ),
        );

      await appendRecords(store, records);
      habits = await refreshHabits(store, habitStore, schema.meta.domainUuid, scopedSchemaFingerprint);
    },

    async recordSavedCandidate({ candidate, tags }) {
      const record = buildExperienceRecord(
        schema,
        {
          mode,
          selector: "none",
          taskSignature,
          inputHash,
        },
        candidate,
        ["saved", "neutral"],
        ["manual-save", ...(tags ?? [])],
        candidate.metadata,
      );
      await appendRecords(store, [record]);
    },
  };
}

function createExperienceStore(
  options: ExperienceOptions,
  domainUuid: string,
  currentSchemaFingerprint: string,
): ExperienceStore {
  if (options.store) {
    return options.store;
  }
  const basePath =
    options.path ??
    join(
      process.cwd(),
      ".cultivar-js",
      "experience",
      domainUuid,
      `${currentSchemaFingerprint}.jsonl`,
    );
  return new JsonlExperienceStore(basePath, deriveHabitPath(basePath));
}

function deriveHabitPath(experiencePath: string): string {
  return experiencePath.endsWith(".jsonl")
    ? experiencePath.replace(/\.jsonl$/u, ".habits.jsonl")
    : `${experiencePath}.habits.jsonl`;
}

async function appendRecords(
  store: ExperienceStore,
  records: ExperienceRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  if (store.appendMany) {
    await store.appendMany(records);
    return;
  }
  for (const record of records) {
    await store.append(record);
  }
}

async function refreshHabits(
  store: ExperienceStore,
  habitStore: HabitStore,
  domainUuid: string,
  currentSchemaFingerprint: string,
): Promise<Habit[]> {
  if (!store.list) {
    return habitStore.list
      ? await Promise.resolve(
          habitStore.list({
            domainUuid,
            schemaFingerprint: currentSchemaFingerprint,
          }),
        )
      : [];
  }

  const records = await Promise.resolve(
    store.list({
      domainUuid,
      schemaFingerprint: currentSchemaFingerprint,
    }),
  );
  const habits = deriveHabits(records, domainUuid, currentSchemaFingerprint);
  if (habitStore.replaceAll) {
    await habitStore.replaceAll(habits);
    return habits;
  }
  return habits;
}

interface DerivedHabitTarget {
  parameter: string;
  targetType: NonNullable<Habit["action"]["targetType"]>;
  path?: string;
  name: string;
  relationField?: "weight" | "kind";
}

function deriveHabits(
  records: ExperienceRecord[],
  domainUuid: string,
  currentSchemaFingerprint: string,
): Habit[] {
  const grouped = new Map<string, ExperienceRecord[]>();
  for (const record of records) {
    if (
      record.domainUuid !== domainUuid ||
      record.schemaFingerprint !== currentSchemaFingerprint
    ) {
      continue;
    }
    const bucket = grouped.get(record.taskSignature) ?? [];
    bucket.push(record);
    grouped.set(record.taskSignature, bucket);
  }

  const habits: Habit[] = [];
  for (const [taskSignature, taskRecords] of grouped) {
    const selected = taskRecords.filter((record) => record.marks.includes("selected"));
    if (selected.length < MIN_HABIT_EVIDENCE) {
      continue;
    }
    const others = taskRecords.filter((record) => !record.marks.includes("selected"));
    const extractedRecords = taskRecords.map((record) => ({
      record,
      entries: extractHabitEntries(record),
    }));
    const parameters = new Map<string, DerivedHabitTarget>();
    for (const { entries } of extractedRecords) {
      for (const entry of entries) {
        if (!parameters.has(entry.parameter)) {
          parameters.set(entry.parameter, {
            parameter: entry.parameter,
            targetType: entry.targetType,
            path: entry.path,
            name: entry.name,
            relationField: entry.relationField,
          });
        }
      }
    }

    for (const descriptor of parameters.values()) {
      const selectedValues = selected
        .map((record) => extractHabitEntryValue(record, descriptor.parameter))
        .filter((value): value is SeedScalar => value !== undefined);
      const baselineValues = (others.length > 0 ? others : taskRecords)
        .map((record) => extractHabitEntryValue(record, descriptor.parameter))
        .filter((value): value is SeedScalar => value !== undefined);

      const numericHabit = deriveNumericHabit(
        selected,
        selectedValues,
        baselineValues,
        descriptor,
        domainUuid,
        currentSchemaFingerprint,
        taskSignature,
      );
      if (numericHabit) {
        habits.push(numericHabit);
        continue;
      }

      const categoricalHabit = deriveCategoricalHabit(
        selected,
        selectedValues,
        baselineValues,
        descriptor,
        domainUuid,
        currentSchemaFingerprint,
        taskSignature,
      );
      if (categoricalHabit) {
        habits.push(categoricalHabit);
      }
    }
  }

  return habits.sort((left, right) => right.strength - left.strength);
}

function deriveNumericHabit(
  selected: ExperienceRecord[],
  selectedValues: SeedScalar[],
  baselineValues: SeedScalar[],
  target: DerivedHabitTarget,
  domainUuid: string,
  currentSchemaFingerprint: string,
  taskSignature: string,
): Habit | null {
  const selectedNumbers = selectedValues.map(toComparableNumber).filter(isFiniteNumber);
  const baselineNumbers = baselineValues.map(toComparableNumber).filter(isFiniteNumber);
  if (
    selectedNumbers.length < MIN_HABIT_EVIDENCE ||
    baselineNumbers.length < MIN_HABIT_EVIDENCE
  ) {
    return null;
  }

  const selectedMean = mean(selectedNumbers);
  const baselineMean = mean(baselineNumbers);
  const min = Math.min(...baselineNumbers, ...selectedNumbers);
  const max = Math.max(...baselineNumbers, ...selectedNumbers);
  const spread = max - min;
  if (spread <= 0) {
    return null;
  }

  const diff = selectedMean - baselineMean;
  const normalized = Math.abs(diff) / spread;
  if (normalized < 0.2) {
    return null;
  }

  const direction = diff > 0 ? "up" : "down";
  const originExperienceIds = selected.map((record) => record.id);
  return {
    id: fingerprintCanonicalValue({
      domainUuid,
      schemaFingerprint: currentSchemaFingerprint,
      taskSignature,
      parameter: target.parameter,
      direction,
      target: selectedMean,
    }).slice(0, 32),
    updatedAt: new Date().toISOString(),
    scope: "domain",
    capabilityTags: [],
    domainUuid,
    schemaFingerprint: currentSchemaFingerprint,
    trigger: { taskSignature },
    action: {
      type: "bias",
      parameter: target.parameter,
      targetType: target.targetType,
      path: target.path,
      name: target.name,
      relationField: target.relationField,
      direction,
      target: selectedMean,
    },
    strength: Math.max(0.1, Math.min(1, normalized * Math.min(1, selectedNumbers.length / 5))),
    evidenceCount: selectedNumbers.length,
    originExperienceIds,
  };
}

function deriveCategoricalHabit(
  selected: ExperienceRecord[],
  selectedValues: SeedScalar[],
  baselineValues: SeedScalar[],
  target: DerivedHabitTarget,
  domainUuid: string,
  currentSchemaFingerprint: string,
  taskSignature: string,
): Habit | null {
  const selectedMode = mode(selectedValues);
  const baselineMode = mode(baselineValues);
  if (!selectedMode || selectedMode.count < MIN_HABIT_EVIDENCE) {
    return null;
  }
  const dominance = selectedMode.count / selectedValues.length;
  const baselineDominance = baselineMode ? baselineMode.count / baselineValues.length : 0;
  if (dominance < 0.8 || seedScalarEquals(selectedMode.value, baselineMode?.value) && dominance <= baselineDominance + 0.2) {
    return null;
  }

  const originExperienceIds = selected
    .filter((record) =>
      seedScalarEquals(
        extractHabitEntryValue(record, target.parameter),
        selectedMode.value,
      )
    )
    .map((record) => record.id);

  return {
    id: fingerprintCanonicalValue({
      domainUuid,
      schemaFingerprint: currentSchemaFingerprint,
      taskSignature,
      parameter: target.parameter,
      direction: "toward",
      target: selectedMode.value,
    }).slice(0, 32),
    updatedAt: new Date().toISOString(),
    scope: "domain",
    capabilityTags: [],
    domainUuid,
    schemaFingerprint: currentSchemaFingerprint,
    trigger: { taskSignature },
    action: {
      type: "bias",
      parameter: target.parameter,
      targetType: target.targetType,
      path: target.path,
      name: target.name,
      relationField: target.relationField,
      direction: "toward",
      target: cloneSeedScalar(selectedMode.value),
    },
    strength: Math.max(0.1, Math.min(1, dominance * Math.min(1, selectedMode.count / 5))),
    evidenceCount: selectedMode.count,
    originExperienceIds,
  };
}

function extractHabitEntries(record: ExperienceRecord): DerivedHabitTarget[] {
  const entries = new Map<string, DerivedHabitTarget>();
  for (const name of Object.keys(record.values)) {
    entries.set(name, {
      parameter: name,
      targetType: "root-param",
      name,
    });
  }

  const hierarchical = getHierarchicalMetadata(record);
  for (const snapshot of hierarchical?.paramValues ?? []) {
    if (!snapshot.path) {
      continue;
    }
    for (const name of Object.keys(snapshot.values)) {
      const parameter = `${snapshot.path}.${name}`;
      entries.set(parameter, {
        parameter,
        targetType: "sub-domain-param",
        path: snapshot.path,
        name,
      });
    }
  }

  for (const snapshot of hierarchical?.behaviors ?? []) {
    for (const name of Object.keys(snapshot.values)) {
      const parameter = `${displayTreePath(snapshot.path)}#${name}`;
      entries.set(parameter, {
        parameter,
        targetType: "behavior",
        path: snapshot.path,
        name,
      });
    }
  }

  for (const relation of hierarchical?.relations ?? []) {
    if (typeof relation.weight === "number") {
      const parameter = `${displayTreePath(relation.ownerPath)}::${relation.name}#weight`;
      entries.set(parameter, {
        parameter,
        targetType: "domain-relation",
        path: relation.ownerPath,
        name: relation.name,
        relationField: "weight",
      });
    }
    const kindParameter = `${displayTreePath(relation.ownerPath)}::${relation.name}#kind`;
    entries.set(kindParameter, {
      parameter: kindParameter,
      targetType: "domain-relation",
      path: relation.ownerPath,
      name: relation.name,
      relationField: "kind",
    });
  }

  return [...entries.values()];
}

function extractHabitEntryValue(
  record: ExperienceRecord,
  parameter: string,
): SeedScalar | undefined {
  if (Object.prototype.hasOwnProperty.call(record.values, parameter)) {
    return record.values[parameter];
  }
  const hierarchical = getHierarchicalMetadata(record);
  if (!hierarchical) {
    return undefined;
  }
  const relationMarker = parameter.indexOf("::");
  if (relationMarker >= 0) {
    const hashIndex = parameter.lastIndexOf("#");
    if (hashIndex <= relationMarker) {
      return undefined;
    }
    const ownerPath = parseDisplayTreePath(parameter.slice(0, relationMarker));
    const relationName = parameter.slice(relationMarker + 2, hashIndex);
    const relationField = parameter.slice(hashIndex + 1);
    const relation = hierarchical.relations?.find((entry) =>
      entry.ownerPath === ownerPath && entry.name === relationName
    );
    if (!relation) {
      return undefined;
    }
    return relationField === "kind"
      ? relation.kind
      : relation.weight;
  }

  const behaviorIndex = parameter.lastIndexOf("#");
  if (behaviorIndex >= 0) {
    const path = parseDisplayTreePath(parameter.slice(0, behaviorIndex));
    const name = parameter.slice(behaviorIndex + 1);
    const snapshot = hierarchical.behaviors?.find((entry) => entry.path === path);
    return snapshot?.values[name];
  }

  const pathSplit = splitDisplayParamPath(parameter);
  if (pathSplit) {
    const snapshot = hierarchical.paramValues?.find((entry) => entry.path === pathSplit.path);
    return snapshot?.values[pathSplit.name];
  }

  return undefined;
}

function buildExperienceRecord<Output>(
  schema: SchemaSnapshot,
  sessionInfo: {
    mode: "tune" | "cli";
    selector: "human" | "auto" | "custom" | "none";
    taskSignature: string;
    inputHash: string;
  },
  candidate: SaveCandidate<Output>,
  marks: ExperienceRecord["marks"],
  tags: string[],
  metadata?: Record<string, unknown>,
): ExperienceRecord {
  const nextMetadata = mergeHierarchicalMetadata(metadata, candidate);
  return {
    id: createRuntimeUuid(),
    recordedAt: new Date().toISOString(),
    scope: "domain",
    capabilityTags: [],
    domainUuid: schema.meta.domainUuid,
    schemaFingerprint: schemaFingerprint(schema),
    taskSignature: sessionInfo.taskSignature,
    inputHash: sessionInfo.inputHash,
    outputHash: fingerprintCanonicalValue(candidate.output),
    seedHash: candidate.seedHash,
    parentSeedHash: candidate.parentSeedHash,
    values: cloneSeedScalarRecord(candidate.values),
    score: candidate.score,
    objectives: candidate.objectives ? { ...candidate.objectives } : undefined,
    marks: [...marks],
    tags: [...tags],
    appliedHabitIds: candidate.appliedHabitIds ? [...candidate.appliedHabitIds] : undefined,
    wrapper: {
      id: schema.meta.stableId ?? schema.meta.runtimeId,
      version: schema.meta.version,
      name: schema.meta.name,
    },
    session: {
      mode: sessionInfo.mode,
      selector: sessionInfo.selector,
      generation: candidate.generation,
      batchAttempt: candidate.batchAttempt,
      position: candidate.position,
      sessionSeed: candidate.sessionSeed,
      candidateSeed: candidate.candidateSeed,
    },
    metadata: nextMetadata,
  };
}

function mergeHierarchicalMetadata(
  metadata: Record<string, unknown> | undefined,
  candidate: SaveCandidate<unknown>,
): Record<string, unknown> | undefined {
  const nextMetadata = metadata ? structuredClone(metadata) : {};
  const hierarchical = buildHierarchicalMetadata(candidate);
  if (hierarchical) {
    const existing = isRecord(nextMetadata.hierarchical)
      ? structuredClone(nextMetadata.hierarchical)
      : {};
    nextMetadata.hierarchical = {
      ...hierarchical,
      ...existing,
    };
  }
  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function buildHierarchicalMetadata(
  candidate: SaveCandidate<unknown>,
): HierarchicalExperienceMetadata | null {
  const tree = candidate.tree ?? null;
  const trace = candidate.trace ?? null;
  const mutations = candidate.mutations?.length
    ? candidate.mutations.map((mutation) => ({
      ...mutation,
      radius: { ...mutation.radius },
      changedFieldIds: [...mutation.changedFieldIds],
      changedFieldNames: [...mutation.changedFieldNames],
      changedRelationNames: mutation.changedRelationNames
        ? [...mutation.changedRelationNames]
        : undefined,
    }))
    : undefined;
  const domainSummaries = candidate.domainSummaries?.length
    ? candidate.domainSummaries.map((summary) => structuredClone(summary))
    : undefined;
  const domainCredits = candidate.domainCredits
    ? { ...candidate.domainCredits }
    : undefined;
  const domainLock = candidate.domainLock?.length
    ? [...candidate.domainLock]
    : undefined;
  const domainFocus = candidate.domainFocus?.length
    ? [...candidate.domainFocus]
    : undefined;
  const paramValues = tree ? collectHierarchicalParamSnapshots(tree) : undefined;
  const behaviors = tree ? collectHierarchicalBehaviorSnapshots(tree) : undefined;
  const relations = tree ? collectHierarchicalRelationSnapshots(tree) : undefined;

  if (
    !trace &&
    !mutations &&
    !domainSummaries &&
    !domainCredits &&
    !domainLock &&
    !domainFocus &&
    candidate.depthLimit === undefined &&
    !paramValues &&
    !behaviors &&
    !relations
  ) {
    return null;
  }

  return {
    trace: trace ? structuredClone(trace) : undefined,
    mutations,
    domainSummaries,
    domainCredits,
    domainLock,
    domainFocus,
    depthLimit: candidate.depthLimit,
    paramValues,
    behaviors,
    relations,
  };
}

function collectHierarchicalParamSnapshots(
  tree: RuntimeTreeNode,
): HierarchicalExperienceParamSnapshot[] | undefined {
  const snapshots = listRuntimeTreeNodes(tree)
    .filter((node) => node.path !== "" && node.values)
    .map((node) => ({
      path: node.path,
      values: cloneSeedScalarRecord(node.values ?? {}),
    }));
  return snapshots.length > 0 ? snapshots : undefined;
}

function collectHierarchicalBehaviorSnapshots(
  tree: RuntimeTreeNode,
): HierarchicalExperienceBehaviorSnapshot[] | undefined {
  const snapshots = listRuntimeTreeNodes(tree)
    .filter((node) => Object.keys(node.behaviors).length > 0)
    .map((node) => ({
      path: node.path,
      values: structuredClone(node.behaviors),
    }));
  return snapshots.length > 0 ? snapshots : undefined;
}

function collectHierarchicalRelationSnapshots(
  tree: RuntimeTreeNode,
): HierarchicalExperienceRelationSnapshot[] | undefined {
  const snapshots = listRuntimeTreeNodes(tree)
    .flatMap((node) =>
      node.edges.map((edge) => ({
        ownerPath: node.path,
        name: edge.name,
        source: edge.source,
        target: edge.target,
        kind: edge.kind,
        weight: edge.weight,
        params: edge.params ? structuredClone(edge.params) : undefined,
      }))
    );
  return snapshots.length > 0 ? snapshots : undefined;
}

function getHierarchicalMetadata(
  record: ExperienceRecord,
): HierarchicalExperienceMetadata | null {
  if (!isRecord(record.metadata) || !isRecord(record.metadata.hierarchical)) {
    return null;
  }
  return record.metadata.hierarchical as HierarchicalExperienceMetadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayTreePath(path: string): string {
  return path || "root";
}

function parseDisplayTreePath(path: string): string {
  return path === "root" ? "" : path;
}

function splitDisplayParamPath(
  parameter: string,
): { path: string; name: string } | null {
  const segments = splitRuntimePath(parameter);
  if (segments.length <= 1) {
    return null;
  }
  const name = segments[segments.length - 1]!;
  const path = segments.slice(0, -1).join(".");
  return { path, name };
}

function applyHabitToTree(
  tree: RuntimeTreeNode,
  habit: Habit,
  prng: () => number,
): boolean {
  const targetType = habit.action.targetType;
  if (targetType === "sub-domain-param") {
    const path = habit.action.path;
    const paramName = habit.action.name;
    if (!path || !paramName) {
      return false;
    }
    const node = findRuntimeTreeNode(tree, path);
    return node ? applyHabitToNodeParam(node, paramName, habit, prng) : false;
  }
  if (targetType === "domain-relation") {
    const path = habit.action.path ?? "";
    const relationName = habit.action.name;
    if (!relationName) {
      return false;
    }
    const node = findRuntimeTreeNode(tree, path);
    return node ? applyHabitToRelation(node, relationName, habit, prng) : false;
  }
  return false;
}

function applyHabitToNodeParam(
  node: RuntimeTreeNode,
  paramName: string,
  habit: Habit,
  prng: () => number,
): boolean {
  if (!node.schema) {
    return false;
  }
  const param = node.schema.params.find((candidate) => candidate.name === paramName);
  if (!param) {
    return false;
  }
  const values = node.values
    ? structuredClone(node.values)
    : legacySeedToValues(node.schema, node.seed);
  const currentValue = values[param.name];
  const nextValue = applyHabitToValue(currentValue, param.spec, habit, prng);
  if (seedScalarEquals(currentValue, nextValue)) {
    return false;
  }
  values[param.name] = nextValue;
  node.seed = snapshotToLegacySeed(node.schema, values, node.seed.header.generation);
  node.values = structuredClone(values);
  return true;
}

function applyHabitToRelation(
  node: RuntimeTreeNode,
  relationName: string,
  habit: Habit,
  prng: () => number,
): boolean {
  const edge = node.edges.find((candidate) => candidate.name === relationName);
  if (!edge) {
    return false;
  }
  if (habit.action.relationField === "kind" && typeof habit.action.target === "string") {
    if (edge.kind === habit.action.target) {
      return false;
    }
    if (prng() >= Math.min(0.8, 0.2 + habit.strength * 0.5)) {
      return false;
    }
    edge.kind = habit.action.target as typeof edge.kind;
    return true;
  }
  if (
    habit.action.relationField === "weight" &&
    typeof habit.action.target === "number"
  ) {
    const currentWeight = typeof edge.weight === "number" ? edge.weight : 1;
    const influence = 0.12 + habit.strength * 0.28;
    const nextWeight = Math.min(
      2,
      Math.max(-2, currentWeight + (habit.action.target - currentWeight) * influence),
    );
    if (Object.is(currentWeight, nextWeight)) {
      return false;
    }
    edge.weight = nextWeight;
    return true;
  }
  return false;
}

function applyHabitToValue(
  currentValue: SeedScalar,
  spec: SchemaSnapshot["params"][number]["spec"],
  habit: Habit,
  prng: () => number,
): SeedScalar {
  if (typeof currentValue === "number" && typeof habit.action.target === "number") {
    const influence = 0.12 + habit.strength * 0.28;
    const nudged = currentValue + (habit.action.target - currentValue) * influence;
    return coerceNumericSeedScalar(spec.type, clampToRange(nudged, spec.range));
  }
  if (typeof currentValue === "bigint") {
    const target = toComparableNumber(habit.action.target);
    if (!Number.isFinite(target)) {
      return currentValue;
    }
    const current = Number(currentValue);
    if (!Number.isFinite(current)) {
      return currentValue;
    }
    const influence = 0.12 + habit.strength * 0.28;
    const nudged = current + (target - current) * influence;
    return BigInt(Math.round(clampToRange(nudged, spec.range)));
  }
  if (typeof currentValue === "boolean" && typeof habit.action.target === "boolean") {
    return prng() < habit.strength * 0.5 ? habit.action.target : currentValue;
  }
  if (typeof currentValue === "string" && typeof habit.action.target === "string") {
    return prng() < habit.strength * 0.4 ? habit.action.target : currentValue;
  }
  if (currentValue instanceof Uint8Array && habit.action.target instanceof Uint8Array) {
    return prng() < habit.strength * 0.25
      ? new Uint8Array(habit.action.target)
      : currentValue;
  }
  return currentValue;
}

function coerceNumericSeedScalar(
  type: SchemaSnapshot["params"][number]["spec"]["type"],
  value: number,
): SeedScalar {
  switch (type) {
    case "u8":
    case "u16":
    case "u32":
      return Math.max(0, Math.round(value));
    case "u64":
      return BigInt(Math.max(0, Math.round(value)));
    case "f32":
    case "f64":
      return value;
    default:
      return value;
  }
}

function clampToRange(value: number, range?: [number, number]): number {
  if (!range) {
    return value;
  }
  return Math.min(range[1], Math.max(range[0], value));
}

function describeTaskFamily(args: unknown[]): unknown {
  return args.map((value) => describeTaskValue(value));
}

function describeTaskValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (value === undefined) {
    return { $type: "undefined" };
  }
  if (typeof value === "number") {
    return { $type: Number.isInteger(value) ? "integer" : "number" };
  }
  if (typeof value === "bigint" || typeof value === "boolean" || typeof value === "string") {
    return { $type: typeof value };
  }
  if (value instanceof Uint8Array) {
    return { $type: "bytes" };
  }
  if (Array.isArray(value)) {
    return {
      $type: "array",
      items: value.map((entry) => describeTaskValue(entry)),
    };
  }
  if (value instanceof Date) {
    return { $type: "date" };
  }
  if (value && typeof value === "object") {
    return {
      $type: "object",
      entries: Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, describeTaskValue(entry)]),
    };
  }
  return { $type: typeof value };
}

function toComparableNumber(value: SeedScalar): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  return Number.NaN;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mode(values: SeedScalar[]): { value: SeedScalar; count: number } | null {
  const counts = new Map<string, { value: SeedScalar; count: number }>();
  for (const value of values) {
    const key = fingerprintCanonicalValue(value);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    counts.set(key, {
      value: cloneSeedScalar(value),
      count: 1,
    });
  }
  let selected: { value: SeedScalar; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!selected || entry.count > selected.count) {
      selected = entry;
    }
  }
  return selected;
}

function cloneSeedScalar(value: SeedScalar): SeedScalar {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  return value;
}

function cloneSeedScalarRecord(values: SeedValueMap): Record<string, SeedScalar> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, cloneSeedScalar(value)]),
  );
}

function seedScalarEquals(left: SeedScalar | undefined, right: SeedScalar | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    if (left.byteLength !== right.byteLength) {
      return false;
    }
    for (let index = 0; index < left.byteLength; index++) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }
  return left === right;
}

class InMemoryHabitStore implements HabitStore {
  private habits: Habit[] = [];

  append(habit: Habit): void {
    this.habits.push(cloneHabit(habit));
  }

  replaceAll(habits: Habit[]): void {
    this.habits = habits.map((habit) => cloneHabit(habit));
  }

  list(query?: ExperienceQuery): Habit[] {
    return this.habits
      .filter((habit) => matchesQuery(habit, query))
      .map((habit) => cloneHabit(habit));
  }
}

class JsonlHabitStore implements HabitStore {
  constructor(private readonly path: string) {}

  async append(habit: Habit): Promise<void> {
    await appendText(this.path, `${JSON.stringify(toPortableValue(habit))}\n`);
  }

  async replaceAll(habits: Habit[]): Promise<void> {
    const payload = habits
      .map((habit) => JSON.stringify(toPortableValue(habit)))
      .join("\n");
    await writeText(this.path, payload ? `${payload}\n` : "");
  }

  async list(query?: ExperienceQuery): Promise<Habit[]> {
    const text = await readText(this.path);
    if (!text) {
      return [];
    }
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => fromPortableValue(JSON.parse(line)) as Habit)
      .filter((habit) => matchesQuery(habit, query));
  }
}

class JsonlExperienceStore implements ExperienceStore {
  readonly habitStore: HabitStore;

  constructor(
    private readonly path: string,
    habitPath: string,
  ) {
    this.habitStore = new JsonlHabitStore(habitPath);
  }

  async append(record: ExperienceRecord): Promise<void> {
    await appendText(this.path, `${JSON.stringify(toPortableValue(record))}\n`);
  }

  async appendMany(records: ExperienceRecord[]): Promise<void> {
    const payload = records
      .map((record) => JSON.stringify(toPortableValue(record)))
      .join("\n");
    await appendText(this.path, `${payload}\n`);
  }

  async list(query?: ExperienceQuery): Promise<ExperienceRecord[]> {
    const text = await readText(this.path);
    if (!text) {
      return [];
    }
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => fromPortableValue(JSON.parse(line)) as ExperienceRecord)
      .filter((record) => matchesQuery(record, query));
  }
}

function matchesQuery(
  entry: ExperienceRecord | Habit,
  query?: ExperienceQuery,
): boolean {
  if (!query) {
    return true;
  }
  if (query.domainUuid && entry.domainUuid !== query.domainUuid) {
    return false;
  }
  if (query.schemaFingerprint && entry.schemaFingerprint !== query.schemaFingerprint) {
    return false;
  }
  if ("taskSignature" in entry) {
    return !query.taskSignature || entry.taskSignature === query.taskSignature;
  }
  return !query.taskSignature || entry.trigger.taskSignature === query.taskSignature;
}

function cloneHabit(habit: Habit): Habit {
  return {
    ...habit,
    capabilityTags: habit.capabilityTags ? [...habit.capabilityTags] : undefined,
    trigger: { ...habit.trigger },
    action: {
      ...habit.action,
      target: cloneSeedScalar(habit.action.target),
    },
    originExperienceIds: [...habit.originExperienceIds],
  };
}

function toPortableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { $bytes: Array.from(value) };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toPortableValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        toPortableValue(entry),
      ]),
    );
  }
  return value;
}

function fromPortableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => fromPortableValue(entry));
  }
  if (value && typeof value === "object") {
    const tagged = value as Record<string, unknown>;
    if (typeof tagged.$bigint === "string") {
      return BigInt(tagged.$bigint);
    }
    if (Array.isArray(tagged.$bytes)) {
      return new Uint8Array(tagged.$bytes as number[]);
    }
    return Object.fromEntries(
      Object.entries(tagged).map(([key, entry]) => [key, fromPortableValue(entry)]),
    );
  }
  return value;
}
