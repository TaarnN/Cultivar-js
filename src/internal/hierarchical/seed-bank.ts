import { Buffer } from "node:buffer";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  BehaviorConstraintSpec,
  BehaviorTarget,
  SeedScalar,
} from "../../public/dollar.ts";
import type {
  DomainTraceNode,
  SeedBankOptions,
} from "../../public/tune.ts";
import type { Seed } from "../compat/seed-format.ts";
import { appendText, readText } from "../platform/files.ts";
import type { RuntimeTreeNode, RuntimeTreeMeta } from "../runtime/tree.ts";
import { findRuntimeTreeNode, listRuntimeTreeNodes } from "../runtime/tree.ts";
import type { WrapperState } from "../runtime/state.ts";
import { parseSeedBytes, serializeSeed } from "../seed/binary.ts";
import { legacySeedToValues, type SeedValueMap } from "../seed/snapshot.ts";
import { fingerprintCanonicalValue } from "../utils/canonical.ts";
import { ValidationRejectedError } from "../utils/errors.ts";

export interface SeedBankParentContext {
  ownerId: string;
  ownerPath: string;
  argsHash: string;
  parentSeedHash?: string;
}

export interface SeedBankEntry {
  seedHash: string;
  seedBytesBase64: string;
  path: string;
  stableId: string | null;
  name: string;
  version: string;
  domainUuid: string;
  schemaFingerprint: string;
  valuesSummary: Record<string, unknown>;
  behaviors: Record<string, number>;
  score?: number;
  parentContext?: SeedBankParentContext;
  tags: string[];
  selectedCount: number;
  rejectedCount: number;
  savedCount: number;
  recordedAt: string;
}

export interface SeedBankSwapDonor {
  seed: Seed;
  values: SeedValueMap | null;
  label: string;
}

export type SeedBankDonorIndex = Record<string, SeedBankSwapDonor[]>;

export interface SeedBankService {
  readonly basePath: string;
  appendNode(
    node: RuntimeTreeNode,
    options?: {
      score?: number;
      tags?: string[];
      parentContext?: SeedBankParentContext;
      selectedCount?: number;
      rejectedCount?: number;
      savedCount?: number;
    },
  ): Promise<void>;
  listEntries(query: {
    domainUuid: string;
    version: string;
    schemaFingerprint?: string | null;
  }): Promise<SeedBankEntry[]>;
}

interface SeedBankEventRecord extends SeedBankEntry {
  format: "SDBANK/1";
}

interface AggregatedSeedBankEntry extends SeedBankEntry {
  _tagSet: Set<string>;
}

const DEFAULT_SEED_BANK_DIR = join(
  process.cwd(),
  ".cultivar-js",
  "seed-bank",
);

export function ensureSeedBankService<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  options: false | SeedBankOptions | undefined,
): SeedBankService | null {
  if (options === false) {
    state.seedBank = null;
    return null;
  }
  if (options === undefined && state.seedBank) {
    return state.seedBank;
  }
  const basePath = resolveSeedBankBasePath(options);
  if (state.seedBank && state.seedBank.basePath === basePath) {
    return state.seedBank;
  }
  state.seedBank = createSeedBankService(basePath);
  return state.seedBank;
}

export function createSeedBankService(basePath: string): SeedBankService {
  return {
    basePath,
    async appendNode(node, options = {}) {
      const record: SeedBankEventRecord = {
        format: "SDBANK/1",
        recordedAt: new Date().toISOString(),
        seedHash: node.seed.contentHash,
        seedBytesBase64: Buffer.from(serializeSeed(node.seed)).toString("base64"),
        path: node.path || "root",
        stableId: node.meta.stableId,
        name: node.meta.name,
        version: node.meta.version,
        domainUuid: node.meta.domainUuid,
        schemaFingerprint: node.meta.schemaFingerprint,
        valuesSummary: summarizeSeedValues(node.values ?? {}),
        behaviors: structuredClone(node.behaviors),
        score: options.score,
        parentContext: options.parentContext
          ? structuredClone(options.parentContext)
          : undefined,
        tags: [...new Set(options.tags ?? [])],
        selectedCount: options.selectedCount ?? 0,
        rejectedCount: options.rejectedCount ?? 0,
        savedCount: options.savedCount ?? 0,
      };
      await appendText(
        bankFilePath(basePath, record.domainUuid, record.schemaFingerprint),
        `${JSON.stringify(record)}\n`,
      );
    },
    async listEntries(query) {
      return loadSeedBankEntries(basePath, query);
    },
  };
}

export async function chooseSeedFromSeedBank<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  options: {
    seedBank?: false | SeedBankOptions;
    schemaFingerprint?: string | null;
    reuse: "bank-best" | "bank-nearest";
    behaviorTarget?: BehaviorTarget;
    args: unknown;
    ownerId: string;
    ownerPath: string;
    parentSeedHash?: string;
    excludeSeedHash?: string;
  },
): Promise<Seed | null> {
  const service = ensureSeedBankService(state, options.seedBank);
  if (!service) {
    return null;
  }
  const entries = await service.listEntries({
    domainUuid: state.meta.domainUuid,
    version: state.meta.version,
    schemaFingerprint: options.schemaFingerprint,
  });
  const candidates = entries.filter((entry) => entry.seedHash !== options.excludeSeedHash);
  if (candidates.length === 0) {
    return null;
  }
  const parentContext: SeedBankParentContext = {
    ownerId: options.ownerId,
    ownerPath: options.ownerPath || "root",
    argsHash: fingerprintCanonicalValue(options.args),
    parentSeedHash: options.parentSeedHash,
  };
  const ranked = [...candidates].sort((left, right) =>
    scoreSeedBankEntry(right, options.reuse, options.behaviorTarget, parentContext) -
    scoreSeedBankEntry(left, options.reuse, options.behaviorTarget, parentContext)
  );
  return parseSeedBytes(Buffer.from(ranked[0]!.seedBytesBase64, "base64"));
}

export async function buildSeedBankDonorIndex(
  root: RuntimeTreeNode | null,
  options: false | SeedBankOptions | undefined,
): Promise<SeedBankDonorIndex> {
  if (!root || options === false) {
    return {};
  }
  const service = createSeedBankService(resolveSeedBankBasePath(options));
  const donors: SeedBankDonorIndex = {};
  for (const node of listRuntimeTreeNodes(root)) {
    if (!node.path || !node.schema) {
      continue;
    }
    const entries = await service.listEntries({
      domainUuid: node.meta.domainUuid,
      version: node.meta.version,
      schemaFingerprint: node.meta.schemaFingerprint,
    });
    const filtered = entries
      .filter((entry) => entry.seedHash !== node.seed.contentHash)
      .sort((left, right) => scoreSwapDonor(right) - scoreSwapDonor(left))
      .slice(0, 8)
      .map((entry) => {
        const seed = parseSeedBytes(Buffer.from(entry.seedBytesBase64, "base64"));
        return {
          seed,
          values: legacySeedToValues(node.schema!, seed),
          label: `bank:${entry.path}:${shortHash(entry.seedHash)}`,
        } satisfies SeedBankSwapDonor;
      });
    if (filtered.length > 0) {
      donors[node.path] = filtered;
    }
  }
  return donors;
}

export async function appendTreeToSeedBank<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  args: Args,
  options: {
    seedBank?: false | SeedBankOptions;
    score?: number;
    tags?: string[];
    includeRoot?: boolean;
    rootParentSeedHash?: string;
    savedCount?: number;
  } = {},
): Promise<void> {
  const service = ensureSeedBankService(state, options.seedBank);
  if (!service || !state.currentTreeSeed) {
    return;
  }
  const nodes = listRuntimeTreeNodes(state.currentTreeSeed)
    .filter((node) => options.includeRoot ? true : Boolean(node.path));
  for (const node of nodes) {
    const parent = findParentNode(state.currentTreeSeed, node.path);
    await service.appendNode(node, {
      score: options.score,
      tags: options.tags,
      parentContext: {
        ownerId: state.meta.stableId ?? state.meta.runtimeId,
        ownerPath: parent?.path || "root",
        argsHash: fingerprintCanonicalValue(args),
        parentSeedHash: parent?.seed.contentHash ?? options.rootParentSeedHash,
      },
      selectedCount: options.savedCount ? 0 : 1,
      rejectedCount: 0,
      savedCount: options.savedCount ?? 0,
    });
  }
}

export async function appendNodeToSeedBank<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  node: RuntimeTreeNode,
  args: Args | null,
  options: {
    tags?: string[];
    score?: number;
    selectedCount?: number;
    rejectedCount?: number;
    savedCount?: number;
    ownerPath?: string;
    parentSeedHash?: string;
  } = {},
): Promise<void> {
  if (!state.seedBank) {
    return;
  }
  await state.seedBank.appendNode(node, {
    score: options.score,
    tags: options.tags,
    parentContext: {
      ownerId: state.meta.stableId ?? state.meta.runtimeId,
      ownerPath: options.ownerPath ?? parentPathOf(node.path),
      argsHash: fingerprintCanonicalValue(args ?? []),
      parentSeedHash: options.parentSeedHash,
    },
    selectedCount: options.selectedCount,
    rejectedCount: options.rejectedCount,
    savedCount: options.savedCount,
  });
}

export function validateBehaviorConstraints(
  path: string,
  behaviors: Record<string, number>,
  constraints: Record<string, BehaviorConstraintSpec> | undefined,
): void {
  if (!constraints) {
    return;
  }
  for (const [name, spec] of Object.entries(constraints)) {
    const value = behaviors[name];
    if (value === undefined) {
      throw new ValidationRejectedError(
        `Behavior constraint failed for ${path || "root"}: missing behavior "${name}"`,
      );
    }
    if (spec.eq !== undefined && !Object.is(value, spec.eq)) {
      throw new ValidationRejectedError(
        `Behavior constraint failed for ${path || "root"}: ${name} expected ${formatNumber(spec.eq)} but received ${formatNumber(value)}`,
      );
    }
    if (spec.min !== undefined && value < spec.min) {
      throw new ValidationRejectedError(
        `Behavior constraint failed for ${path || "root"}: ${name} must be >= ${formatNumber(spec.min)} but received ${formatNumber(value)}`,
      );
    }
    if (spec.max !== undefined && value > spec.max) {
      throw new ValidationRejectedError(
        `Behavior constraint failed for ${path || "root"}: ${name} must be <= ${formatNumber(spec.max)} but received ${formatNumber(value)}`,
      );
    }
  }
}

export function buildBehaviorTargetWarnings(
  path: string,
  behaviors: Record<string, number>,
  target: BehaviorTarget | undefined,
): string[] {
  if (!target) {
    return [];
  }
  const warnings: string[] = [];
  for (const [name, expected] of Object.entries(target)) {
    const actual = behaviors[name];
    if (actual === undefined) {
      warnings.push(
        `behavior target mismatch at ${path || "root"}: missing ${name}, expected ${formatNumber(expected)}`,
      );
      continue;
    }
    if (!Object.is(actual, expected)) {
      warnings.push(
        `behavior target mismatch at ${path || "root"}: ${name}=${formatNumber(actual)} target=${formatNumber(expected)}`,
      );
    }
  }
  return warnings;
}

export function summarizeTraceWarnings(
  trace: DomainTraceNode | undefined,
): string | null {
  if (!trace) {
    return null;
  }
  const warnings = collectTraceWarnings(trace);
  if (warnings.length === 0) {
    return null;
  }
  return warnings[0]!;
}

function scoreSeedBankEntry(
  entry: SeedBankEntry,
  reuse: "bank-best" | "bank-nearest",
  target: BehaviorTarget | undefined,
  parentContext: SeedBankParentContext,
): number {
  const behavior = scoreBehaviorMatch(entry.behaviors, target);
  const context = scoreParentContext(entry.parentContext, parentContext);
  const success = scoreHistoricalSuccess(entry);
  const novelty = 1 / (1 + entry.selectedCount + entry.savedCount + entry.rejectedCount);
  if (reuse === "bank-nearest") {
    return behavior * 4 + context * 1.5 + success * 0.5 + novelty * 0.25;
  }
  return success * 2 + context * 1.5 + behavior * 1.25 + novelty * 0.4;
}

function scoreSwapDonor(entry: SeedBankEntry): number {
  return scoreHistoricalSuccess(entry) + 1 / (1 + entry.selectedCount + entry.savedCount);
}

function scoreBehaviorMatch(
  behaviors: Record<string, number>,
  target: BehaviorTarget | undefined,
): number {
  const names = Object.keys(target ?? {});
  if (names.length === 0) {
    return 0.25;
  }
  let overlap = 0;
  let totalDistance = 0;
  for (const name of names) {
    const actual = behaviors[name];
    const expected = target?.[name];
    if (actual === undefined || expected === undefined) {
      continue;
    }
    overlap += 1;
    totalDistance += Math.abs(actual - expected);
  }
  if (overlap === 0) {
    return -0.5;
  }
  return 1 / (1 + totalDistance / overlap);
}

function scoreParentContext(
  left: SeedBankParentContext | undefined,
  right: SeedBankParentContext,
): number {
  if (!left) {
    return 0;
  }
  let score = 0;
  if (left.ownerId === right.ownerId) {
    score += 0.8;
  }
  if (left.ownerPath === right.ownerPath) {
    score += 0.7;
  }
  if (left.argsHash === right.argsHash) {
    score += 0.8;
  }
  if (
    left.parentSeedHash !== undefined &&
    right.parentSeedHash !== undefined &&
    left.parentSeedHash === right.parentSeedHash
  ) {
    score += 0.4;
  }
  return score;
}

function scoreHistoricalSuccess(entry: SeedBankEntry): number {
  const balance = entry.selectedCount - entry.rejectedCount * 0.75 + entry.savedCount * 0.25;
  const score = entry.score ?? 0;
  return balance + score / 10;
}

async function loadSeedBankEntries(
  basePath: string,
  query: {
    domainUuid: string;
    version: string;
    schemaFingerprint?: string | null;
  },
): Promise<SeedBankEntry[]> {
  const texts = query.schemaFingerprint
    ? [await readText(bankFilePath(basePath, query.domainUuid, query.schemaFingerprint))]
    : await readAllDomainBankFiles(basePath, query.domainUuid);
  const aggregated = new Map<string, AggregatedSeedBankEntry>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const rawLine of text.split(/\n/u)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parsed = JSON.parse(line) as Partial<SeedBankEventRecord>;
      if (
        parsed.format !== "SDBANK/1" ||
        parsed.domainUuid !== query.domainUuid ||
        parsed.version !== query.version
      ) {
        continue;
      }
      if (
        query.schemaFingerprint &&
        parsed.schemaFingerprint !== query.schemaFingerprint
      ) {
        continue;
      }
      const seedHash = parsed.seedHash;
      if (!seedHash || !parsed.seedBytesBase64 || !parsed.schemaFingerprint) {
        continue;
      }
      const existing = aggregated.get(seedHash);
      if (!existing) {
        aggregated.set(seedHash, {
          seedHash,
          seedBytesBase64: parsed.seedBytesBase64,
          path: parsed.path ?? "root",
          stableId: parsed.stableId ?? null,
          name: parsed.name ?? query.domainUuid,
          version: parsed.version ?? query.version,
          domainUuid: parsed.domainUuid,
          schemaFingerprint: parsed.schemaFingerprint,
          valuesSummary: parsed.valuesSummary && typeof parsed.valuesSummary === "object"
            ? structuredClone(parsed.valuesSummary as Record<string, unknown>)
            : {},
          behaviors: parsed.behaviors && typeof parsed.behaviors === "object"
            ? structuredClone(parsed.behaviors as Record<string, number>)
            : {},
          score: typeof parsed.score === "number" ? parsed.score : undefined,
          parentContext: parsed.parentContext
            ? structuredClone(parsed.parentContext as SeedBankParentContext)
            : undefined,
          tags: Array.isArray(parsed.tags) ? [...parsed.tags] : [],
          selectedCount: parsed.selectedCount ?? 0,
          rejectedCount: parsed.rejectedCount ?? 0,
          savedCount: parsed.savedCount ?? 0,
          recordedAt: parsed.recordedAt ?? new Date(0).toISOString(),
          _tagSet: new Set(Array.isArray(parsed.tags) ? parsed.tags : []),
        });
        continue;
      }
      existing.selectedCount += parsed.selectedCount ?? 0;
      existing.rejectedCount += parsed.rejectedCount ?? 0;
      existing.savedCount += parsed.savedCount ?? 0;
      if (typeof parsed.score === "number") {
        existing.score = existing.score === undefined
          ? parsed.score
          : Math.max(existing.score, parsed.score);
      }
      for (const tag of Array.isArray(parsed.tags) ? parsed.tags : []) {
        existing._tagSet.add(tag);
      }
      if ((parsed.recordedAt ?? "") >= existing.recordedAt) {
        existing.recordedAt = parsed.recordedAt ?? existing.recordedAt;
        existing.seedBytesBase64 = parsed.seedBytesBase64;
        existing.path = parsed.path ?? existing.path;
        existing.stableId = parsed.stableId ?? existing.stableId;
        existing.name = parsed.name ?? existing.name;
        existing.version = parsed.version ?? existing.version;
        existing.schemaFingerprint = parsed.schemaFingerprint ?? existing.schemaFingerprint;
        existing.valuesSummary = parsed.valuesSummary && typeof parsed.valuesSummary === "object"
          ? structuredClone(parsed.valuesSummary as Record<string, unknown>)
          : existing.valuesSummary;
        existing.behaviors = parsed.behaviors && typeof parsed.behaviors === "object"
          ? structuredClone(parsed.behaviors as Record<string, number>)
          : existing.behaviors;
        existing.parentContext = parsed.parentContext
          ? structuredClone(parsed.parentContext as SeedBankParentContext)
          : existing.parentContext;
      }
    }
  }
  return Array.from(aggregated.values())
    .map((entry) => ({
      ...entry,
      tags: [...entry._tagSet].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => scoreHistoricalSuccess(right) - scoreHistoricalSuccess(left));
}

async function readAllDomainBankFiles(
  basePath: string,
  domainUuid: string,
): Promise<Array<string | null>> {
  const directory = join(basePath, domainUuid);
  try {
    const files = await readdir(directory);
    return Promise.all(
      files
        .filter((file) => file.endsWith(".jsonl"))
        .map((file) => readText(join(directory, file))),
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

function bankFilePath(
  basePath: string,
  domainUuid: string,
  schemaFingerprint: string,
): string {
  return join(basePath, domainUuid, `${schemaFingerprint}.jsonl`);
}

function resolveSeedBankBasePath(
  options: false | SeedBankOptions | undefined,
): string {
  return options && typeof options === "object" && options.path
    ? options.path
    : DEFAULT_SEED_BANK_DIR;
}

function summarizeSeedValues(
  values: Record<string, SeedScalar>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, summarizeSeedScalar(value)]),
  );
}

function summarizeSeedScalar(value: SeedScalar): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return {
      $bytesLength: value.byteLength,
      $bytesBase64: Buffer.from(value).toString("base64"),
    };
  }
  return value;
}

function collectTraceWarnings(trace: DomainTraceNode): string[] {
  const warnings = [...trace.warnings];
  for (const child of trace.children) {
    warnings.push(...collectTraceWarnings(child));
  }
  return warnings;
}

function findParentNode(
  root: RuntimeTreeNode,
  path: string,
): RuntimeTreeNode | null {
  const parentPath = parentPathOf(path);
  if (!parentPath || parentPath === "root") {
    return root;
  }
  return findRuntimeTreeNode(root, parentPath);
}

function parentPathOf(path: string): string {
  if (!path || path === "root") {
    return "root";
  }
  let bracketDepth = 0;
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const char = path[index]!;
    if (char === "]") {
      bracketDepth += 1;
      continue;
    }
    if (char === "[") {
      bracketDepth -= 1;
      continue;
    }
    if (char === "." && bracketDepth === 0) {
      return path.slice(0, index);
    }
  }
  return "root";
}

function shortHash(hash: string): string {
  return hash.slice(0, 10);
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
