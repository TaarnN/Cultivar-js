import type {
  DomainTuneSummary,
  MutationTrace,
} from "../../public/tune.ts";
import {
  countRuntimePathDepth,
  listRuntimeTreeNodes,
  type RuntimeTreeNode,
} from "../runtime/tree.ts";

export interface DomainCreditEntryState {
  score: number;
  confidence: number;
  samples: number;
  volatility: number;
  lastGeneration: number;
}

export type DomainCreditState = Record<string, DomainCreditEntryState>;

export interface CreditObservation {
  score?: number;
  mutations?: MutationTrace[];
}

export interface CreditProbeTarget {
  key: string;
  path: string;
  kind: "param" | "edge";
  name: string;
  confidence: number;
  score: number;
  samples: number;
}

const DEFAULT_CREDIT_ENTRY: DomainCreditEntryState = {
  score: 0,
  confidence: 0,
  samples: 0,
  volatility: 0,
  lastGeneration: 0,
};

export function flattenDomainCredits(
  state: DomainCreditState,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(state).map(([key, entry]) => [
      key,
      roundCreditNumber(entry.score * entry.confidence),
    ]),
  );
}

export function applyBatchMutationCredits(
  current: DomainCreditState,
  observations: CreditObservation[],
  generation: number,
  baselineScore?: number,
): DomainCreditState {
  const scored = observations
    .map((observation) => observation.score)
    .filter((score): score is number => Number.isFinite(score));
  if (scored.length === 0) {
    return cloneCreditState(current);
  }
  const baseline = Number.isFinite(baselineScore)
    ? (baselineScore as number)
    : scored.reduce((sum, score) => sum + score, 0) / scored.length;
  let next = cloneCreditState(current);
  for (const observation of observations) {
    if (!Number.isFinite(observation.score)) {
      continue;
    }
    const scoreDelta = (observation.score as number) - baseline;
    next = applyMutationCreditSample(
      next,
      observation.mutations,
      scoreDelta,
      generation,
    );
  }
  return next;
}

export function applyMutationCreditSample(
  current: DomainCreditState,
  mutations: MutationTrace[] | undefined,
  scoreDelta: number,
  generation: number,
  sampleWeight: number = 1,
): DomainCreditState {
  if (!mutations || mutations.length === 0 || !Number.isFinite(scoreDelta)) {
    return cloneCreditState(current);
  }

  const next = cloneCreditState(current);
  const traceWeight = sampleWeight / Math.max(1, mutations.length);
  for (const mutation of mutations) {
    const pathKey = creditKeyForPath(mutation.path);
    applyCreditObservation(next, pathKey, scoreDelta * traceWeight, generation);

    const fieldWeight = traceWeight / Math.max(1, mutation.changedFieldNames.length || 1);
    for (const fieldName of mutation.changedFieldNames) {
      applyCreditObservation(
        next,
        creditKeyForField(mutation.path, fieldName),
        scoreDelta * fieldWeight,
        generation,
      );
    }

    const relationNames = mutation.changedRelationNames ?? [];
    const relationWeight = traceWeight / Math.max(1, relationNames.length || 1);
    for (const relationName of relationNames) {
      applyCreditObservation(
        next,
        creditKeyForEdge(mutation.path, relationName),
        scoreDelta * relationWeight,
        generation,
      );
    }
  }
  return next;
}

export function buildDomainTuneSummaries(
  tree: RuntimeTreeNode | null,
  credits: DomainCreditState,
  options: {
    domainLock?: string[];
    domainFocus?: string[];
  } = {},
): DomainTuneSummary[] {
  if (!tree) {
    return [];
  }

  const locks = normalizePaths(options.domainLock);
  const focus = normalizePaths(options.domainFocus);
  return listRuntimeTreeNodes(tree).map((node) => {
    const pathKey = creditKeyForPath(node.path);
    return {
      path: displayPath(node.path),
      id: node.meta.stableId ?? node.meta.runtimeId,
      name: node.meta.name,
      version: node.meta.version,
      domainUuid: node.meta.domainUuid,
      schemaFingerprint: node.meta.schemaFingerprint,
      seedHash: node.seed.contentHash,
      depth: countRuntimePathDepth(node.path),
      locked: node.path ? isPathLocked(node.path, locks) : false,
      focused: isSummaryFocused(node.path, focus),
      behaviors: structuredClone(node.behaviors),
      credit: lookupCreditSummary(credits, pathKey),
      paramCredits: (node.schema?.params ?? [])
        .map((param) => ({
          name: param.name,
          ...lookupCreditSummary(
            credits,
            creditKeyForField(node.path, param.name),
          ),
        }))
        .sort(compareCreditSummary),
      edgeCredits: node.edges
        .map((edge) => ({
          name: edge.name,
          ...lookupCreditSummary(
            credits,
            creditKeyForEdge(node.path, edge.name),
          ),
        }))
        .sort(compareCreditSummary),
    } satisfies DomainTuneSummary;
  });
}

export function hasLowConfidenceCreditTargets(
  tree: RuntimeTreeNode | null,
  credits: DomainCreditState,
  options: {
    domainLock?: string[];
    domainFocus?: string[];
    depthLimit?: number;
    minimumConfidence?: number;
  } = {},
): boolean {
  return selectCreditProbeTargets(
    tree,
    credits,
    {
      domainLock: options.domainLock,
      domainFocus: options.domainFocus,
      depthLimit: options.depthLimit,
      minimumConfidence: options.minimumConfidence,
    },
    1,
  ).length > 0;
}

export function selectCreditProbeTargets(
  tree: RuntimeTreeNode | null,
  credits: DomainCreditState,
  options: {
    domainLock?: string[];
    domainFocus?: string[];
    depthLimit?: number;
    minimumConfidence?: number;
  } = {},
  limit: number = 3,
): CreditProbeTarget[] {
  if (!tree || limit <= 0) {
    return [];
  }

  const locks = normalizePaths(options.domainLock);
  const focus = normalizePaths(options.domainFocus);
  const depthLimit = Math.max(1, options.depthLimit ?? 2);
  const minimumConfidence = options.minimumConfidence ?? 0.6;
  const targets: CreditProbeTarget[] = [];

  for (const node of listRuntimeTreeNodes(tree)) {
    if (countRuntimePathDepth(node.path) > depthLimit) {
      continue;
    }
    if (node.path && isPathLocked(node.path, locks)) {
      continue;
    }
    if (!isProbeFocused(node.path, focus)) {
      continue;
    }

    for (const param of node.schema?.params ?? []) {
      const summary = lookupCreditSummary(
        credits,
        creditKeyForField(node.path, param.name),
      );
      targets.push({
        key: creditKeyForField(node.path, param.name),
        path: node.path,
        kind: "param",
        name: param.name,
        confidence: summary.confidence,
        score: summary.score,
        samples: summary.samples,
      });
    }

    for (const edge of node.edges) {
      const summary = lookupCreditSummary(
        credits,
        creditKeyForEdge(node.path, edge.name),
      );
      targets.push({
        key: creditKeyForEdge(node.path, edge.name),
        path: node.path,
        kind: "edge",
        name: edge.name,
        confidence: summary.confidence,
        score: summary.score,
        samples: summary.samples,
      });
    }
  }

  const lowConfidence = targets
    .filter((target) => target.confidence < minimumConfidence)
    .sort(compareProbeTarget);
  if (lowConfidence.length >= limit) {
    return lowConfidence.slice(0, limit);
  }

  const remainder = targets
    .filter((target) => !lowConfidence.includes(target))
    .sort(compareProbeTarget);
  return [...lowConfidence, ...remainder].slice(0, limit);
}

export function lookupCreditSummary(
  credits: DomainCreditState,
  key: string,
): DomainCreditEntryState {
  const entry = credits[key];
  if (!entry) {
    return { ...DEFAULT_CREDIT_ENTRY };
  }
  return { ...entry };
}

export function creditKeyForPath(path: string): string {
  return displayPath(path);
}

export function creditKeyForField(path: string, fieldName: string): string {
  return `${displayPath(path)}.${fieldName}`;
}

export function creditKeyForEdge(path: string, relationName: string): string {
  return `${displayPath(path)}::${relationName}`;
}

function applyCreditObservation(
  credits: DomainCreditState,
  key: string,
  sample: number,
  generation: number,
): void {
  const existing = credits[key] ?? DEFAULT_CREDIT_ENTRY;
  const alpha = resolveEmaAlpha(existing.samples);
  const score = existing.samples === 0
    ? sample
    : existing.score + alpha * (sample - existing.score);
  const deviation = Math.abs(sample - existing.score);
  const volatility = existing.samples === 0
    ? Math.abs(sample)
    : existing.volatility + alpha * (deviation - existing.volatility);
  const samples = existing.samples + 1;
  credits[key] = {
    score: roundCreditNumber(score),
    confidence: roundCreditNumber(resolveConfidence(samples)),
    samples,
    volatility: roundCreditNumber(volatility),
    lastGeneration: generation,
  };
}

function resolveEmaAlpha(samples: number): number {
  if (samples <= 0) {
    return 1;
  }
  return Math.max(0.15, Math.min(0.45, 0.45 / Math.sqrt(samples + 1)));
}

function resolveConfidence(samples: number): number {
  return 1 - Math.exp(-samples / 4);
}

function cloneCreditState(
  state: DomainCreditState,
): DomainCreditState {
  return Object.fromEntries(
    Object.entries(state).map(([key, entry]) => [key, { ...entry }]),
  );
}

function displayPath(path: string): string {
  return path || "root";
}

function isPathLocked(path: string, locks: string[]): boolean {
  return locks.some((lock) =>
    path === lock ||
    path.startsWith(`${lock}.`) ||
    path.startsWith(`${lock}[`)
  );
}

function isProbeFocused(path: string, focus: string[]): boolean {
  if (focus.length === 0) {
    return true;
  }
  if (!path) {
    return true;
  }
  return focus.some((candidate) =>
    path === candidate ||
    path.startsWith(`${candidate}.`) ||
    path.startsWith(`${candidate}[`)
  );
}

function isSummaryFocused(path: string, focus: string[]): boolean {
  if (focus.length === 0) {
    return true;
  }
  if (!path) {
    return true;
  }
  return focus.some((candidate) =>
    path === candidate ||
    candidate.startsWith(`${path}.`) ||
    candidate.startsWith(`${path}[`) ||
    path.startsWith(`${candidate}.`) ||
    path.startsWith(`${candidate}[`)
  );
}

function normalizePaths(paths: string[] | undefined): string[] {
  return (paths ?? [])
    .map((path) => path.trim())
    .filter(Boolean);
}

function compareCreditSummary(
  left: { score: number; confidence: number; samples: number; name: string },
  right: { score: number; confidence: number; samples: number; name: string },
): number {
  const magnitude = Math.abs(right.score) - Math.abs(left.score);
  if (magnitude !== 0) {
    return magnitude;
  }
  const confidence = right.confidence - left.confidence;
  if (confidence !== 0) {
    return confidence;
  }
  const samples = right.samples - left.samples;
  if (samples !== 0) {
    return samples;
  }
  return left.name.localeCompare(right.name);
}

function compareProbeTarget(
  left: CreditProbeTarget,
  right: CreditProbeTarget,
): number {
  const confidence = left.confidence - right.confidence;
  if (confidence !== 0) {
    return confidence;
  }
  const samples = left.samples - right.samples;
  if (samples !== 0) {
    return samples;
  }
  const magnitude = Math.abs(right.score) - Math.abs(left.score);
  if (magnitude !== 0) {
    return magnitude;
  }
  return left.key.localeCompare(right.key);
}

function roundCreditNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 1_000_000) / 1_000_000;
}
