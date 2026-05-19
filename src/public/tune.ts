import type { RelationKind, SeedScalar, SeedTypeName } from "./dollar.ts";

export type ObjectiveScores = Record<string, number>;
export type PreferenceProfile = Record<string, number>;
export type ExperienceCaptureMode = "selected" | "all-survivors";
export type ExperienceMark =
  | "selected"
  | "rejected"
  | "auto-selected"
  | "human-selected"
  | "saved"
  | "neutral";
export type ExperienceScope = "domain" | "universal";
export type HabitTargetKind =
  | "root-param"
  | "sub-domain-param"
  | "behavior"
  | "domain-relation";

export interface Habit {
  id: string;
  updatedAt: string;
  scope: ExperienceScope;
  capabilityTags?: string[];
  domainUuid: string;
  schemaFingerprint: string;
  trigger: {
    taskSignature: string;
  };
  action: {
    type: "bias";
    parameter: string;
    targetType?: HabitTargetKind;
    path?: string;
    name?: string;
    relationField?: "weight" | "kind";
    direction: "up" | "down" | "toward";
    target: SeedScalar;
  };
  strength: number;
  evidenceCount: number;
  originExperienceIds: string[];
}

export interface HierarchicalExperienceParamSnapshot {
  path: string;
  values: Record<string, SeedScalar>;
}

export interface HierarchicalExperienceBehaviorSnapshot {
  path: string;
  values: Record<string, number>;
}

export interface HierarchicalExperienceRelationSnapshot {
  ownerPath: string;
  name: string;
  source: string;
  target: string;
  kind: RelationKind;
  weight?: number;
  params?: Record<string, unknown>;
}

export interface HierarchicalExperienceMetadata {
  trace?: DomainTraceNode;
  mutations?: MutationTrace[];
  domainSummaries?: DomainTuneSummary[];
  domainCredits?: Record<string, number>;
  domainLock?: string[];
  domainFocus?: string[];
  depthLimit?: number;
  paramValues?: HierarchicalExperienceParamSnapshot[];
  behaviors?: HierarchicalExperienceBehaviorSnapshot[];
  relations?: HierarchicalExperienceRelationSnapshot[];
}

export interface HabitStore {
  append(habit: Habit): void | Promise<void>;
  replaceAll?(habits: Habit[]): void | Promise<void>;
  list?(query?: {
    domainUuid?: string;
    schemaFingerprint?: string;
    taskSignature?: string;
  }): Habit[] | Promise<Habit[]>;
}

export interface ExperienceRecord {
  id: string;
  recordedAt: string;
  scope: ExperienceScope;
  capabilityTags?: string[];
  domainUuid: string;
  schemaFingerprint: string;
  taskSignature: string;
  inputHash: string;
  outputHash: string;
  seedHash: string;
  parentSeedHash?: string;
  values: Record<string, SeedScalar>;
  score?: number;
  objectives?: ObjectiveScores;
  marks: ExperienceMark[];
  tags: string[];
  appliedHabitIds?: string[];
  wrapper: {
    id: string;
    version: string;
    name: string;
  };
  session: {
    mode: "tune" | "cli";
    selector: "human" | "auto" | "custom" | "none";
    generation: number;
    batchAttempt: number;
    position?: number;
    sessionSeed: string;
    candidateSeed?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ExperienceStore {
  append(record: ExperienceRecord): void | Promise<void>;
  appendMany?(records: ExperienceRecord[]): void | Promise<void>;
  list?(query?: {
    domainUuid?: string;
    schemaFingerprint?: string;
    taskSignature?: string;
  }): ExperienceRecord[] | Promise<ExperienceRecord[]>;
  habitStore?: HabitStore;
}

export interface ExperienceOptions {
  path?: string;
  store?: ExperienceStore;
  capture?: ExperienceCaptureMode;
}

export interface TreeSeedNode {
  path: string;
  key: string;
  wrapperId: string;
  stableId: string | null;
  name: string;
  version: string;
  domainUuid: string;
  schemaFingerprint: string;
  seedHash: string;
  behaviors: Record<string, number>;
  children: TreeSeedNode[];
}

export interface DomainEdge {
  name: string;
  ownerPath: string;
  source: string;
  target: string;
  kind: RelationKind;
  weight?: number;
  params?: Record<string, unknown>;
}

export interface TreeSeedEnvelope {
  format: "SDTREE/1";
  root: TreeSeedNode;
  seedStore: Record<string, string>;
  domainEdges: DomainEdge[];
  schemaFingerprint: string;
  integrityHash: string;
}

export interface DomainTraceNode {
  path: string;
  id: string;
  name: string;
  version: string;
  domainUuid: string;
  schemaFingerprint: string;
  seedHash: string;
  outputHash: string;
  warnings: string[];
  behaviors: Record<string, number>;
  domainEdges: DomainEdge[];
  children: DomainTraceNode[];
}

export type HierarchicalCreditMode =
  | "off"
  | "variance"
  | "hybrid"
  | "targeted";

export interface SeedBankOptions {
  path?: string;
  behaviorGradient?: false | {
    sampleCount?: number;
  };
}

export interface TreeCacheOptions {
  maxEntries?: number;
}

export interface DomainCreditSummary {
  score: number;
  confidence: number;
  samples: number;
  volatility: number;
}

export interface DomainParamCreditSummary extends DomainCreditSummary {
  name: string;
}

export interface DomainEdgeCreditSummary extends DomainCreditSummary {
  name: string;
}

export interface DomainTuneSummary {
  path: string;
  id: string;
  name: string;
  version: string;
  domainUuid: string;
  schemaFingerprint: string;
  seedHash: string;
  depth: number;
  locked: boolean;
  focused: boolean;
  behaviors: Record<string, number>;
  credit: DomainCreditSummary;
  paramCredits: DomainParamCreditSummary[];
  edgeCredits: DomainEdgeCreditSummary[];
}

export interface HierarchicalMutationMix {
  singleTargetRatio: number;
  highImpactRatio: number;
  exploratorySwapRatio: number;
  parentRootRatio: number;
  domainRelationRatio: number;
}

export interface HierarchicalTuneOptions {
  credit?: HierarchicalCreditMode;
  seedBank?: false | SeedBankOptions;
  mutationMix?: Partial<HierarchicalMutationMix>;
  cache?: false | TreeCacheOptions;
  maxCreditProbeEvaluations?: number;
}

export type MutationStrategy =
  | "parent-param"
  | "sub-seed-internal"
  | "sub-seed-swap-random"
  | "cross-domain-bond";

export interface MutationTrace {
  path: string;
  strategy: MutationStrategy;
  changedFieldIds: number[];
  changedFieldNames: string[];
  changedRelationNames?: string[];
  radius: RadiusSetting;
  previousSeedHash?: string;
  nextSeedHash?: string;
  note?: string;
}

export interface CurrentSeedMeta {
  id: string;
  version: string;
  generation: number;
  hash: string;
}

export interface SubSeedHandle {
  readonly path: string;
  readonly values: Record<string, unknown> | null;
  readonly meta: CurrentSeedMeta | null;
  exportBytes(): Uint8Array;
  save(path: string): Promise<void>;
  clear(): void;
}

export interface CurrentSeedHandle {
  readonly values: Record<string, unknown> | null;
  readonly meta: CurrentSeedMeta | null;
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

export interface FrozenSeedHandle extends CurrentSeedHandle {}

export interface RadiusSetting {
  coreMutationRate: number;
  coreMutationMagnitude: number;
  textureGrowthCount: number;
  textureEditRate: number;
  textureEditMagnitude: number;
  bondGrowthCount: number;
  bondEditRate: number;
}

export interface InteractiveIO {
  prompt?: (message: string) => string | Promise<string | null> | null;
  print?: (line: string) => void;
  color?: boolean;
}

export interface CandidateContext<Args extends unknown[]> {
  generation: number;
  position: number;
  batchAttempt: number;
  sessionSeed: string;
  args: Args;
  seed: FrozenSeedHandle;
}

export interface ScoreContext<Args extends unknown[]> extends CandidateContext<Args> {}

export interface Candidate<Output, Args extends unknown[]> {
  position: number;
  generation: number;
  batchAttempt: number;
  sessionSeed: string;
  output: Output;
  preview: string;
  score?: number;
  objectives?: ObjectiveScores;
  seed: FrozenSeedHandle;
  values: Record<string, SeedScalar>;
  args: Args;
  mutations?: MutationTrace[];
  domainTrace?: DomainTraceNode;
}

export interface GenerationSummary {
  generation: number;
  attemptedBatchSize: number;
  survivorCount: number;
  rejectedCount: number;
  timedOutCount: number;
  batchAttempt: number;
  sessionSeed: string;
  selectedPosition: number;
  winnerScore?: number;
  winnerHash: string;
}

export interface GenerationEvent<Output, Args extends unknown[]> {
  generation: number;
  candidates: Candidate<Output, Args>[];
  winner: Candidate<Output, Args>;
}

export interface TuneShorthandOptions<Args extends unknown[], Output> {
  args?: Args;
  generations?: number;
  batchSize?: number;
  radius?: "narrow" | "medium" | "broad" | Partial<RadiusSetting>;
  selector?:
    | "auto"
    | ((candidates: Candidate<Output, Args>[]) => number | Promise<number>);
  preview?: (output: Output, ctx: CandidateContext<Args>) => string | Promise<string>;
  objectives?: (
    output: Output,
    ctx: ScoreContext<Args>,
  ) => ObjectiveScores | Promise<ObjectiveScores>;
  preference?:
    | PreferenceProfile
    | ((objectives: ObjectiveScores, ctx: ScoreContext<Args>) => number | Promise<number>);
  onGeneration?: (event: GenerationEvent<Output, Args>) => void | Promise<void>;
  domainLock?: string[];
  domainFocus?: string[];
  depthLimit?: number;
  hierarchical?: HierarchicalTuneOptions;
  lineage?: false | { path?: string };
  experience?: false | ExperienceOptions;
  timeouts?: { runMs?: number; scoreMs?: number; selectMs?: number };
  io?: InteractiveIO;
}

export interface CliTuneOptions<Args extends unknown[], Output> {
  args?: Args;
  generations?: number;
  batchSize?: number;
  radius?: "narrow" | "medium" | "broad" | Partial<RadiusSetting>;
  score?: (output: Output, ctx: ScoreContext<Args>) => number | Promise<number>;
  objectives?: (
    output: Output,
    ctx: ScoreContext<Args>,
  ) => ObjectiveScores | Promise<ObjectiveScores>;
  preference?:
    | PreferenceProfile
    | ((objectives: ObjectiveScores, ctx: ScoreContext<Args>) => number | Promise<number>);
  preview?: (output: Output, ctx: CandidateContext<Args>) => string | Promise<string>;
  inspect?: (output: Output, ctx: CandidateContext<Args>) => string | Promise<string>;
  onGeneration?: (event: GenerationEvent<Output, Args>) => void | Promise<void>;
  domainLock?: string[];
  domainFocus?: string[];
  depthLimit?: number;
  hierarchical?: HierarchicalTuneOptions;
  lineage?: false | { path?: string };
  experience?: false | ExperienceOptions;
  timeouts?: { runMs?: number; scoreMs?: number; selectMs?: number };
  title?: string;
  showValues?: boolean;
  io?: InteractiveIO;
}

export interface TuneOptions<Args extends unknown[], Output> {
  args?: Args;
  generations?: number;
  batchSize?: number;
  radius?: "narrow" | "medium" | "broad" | Partial<RadiusSetting>;
  score?: (output: Output, ctx: ScoreContext<Args>) => number | Promise<number>;
  objectives?: (
    output: Output,
    ctx: ScoreContext<Args>,
  ) => ObjectiveScores | Promise<ObjectiveScores>;
  preference?:
    | PreferenceProfile
    | ((objectives: ObjectiveScores, ctx: ScoreContext<Args>) => number | Promise<number>);
  selector?:
    | "human"
    | "auto"
    | ((candidates: Candidate<Output, Args>[]) => number | Promise<number>);
  preview?: (output: Output, ctx: CandidateContext<Args>) => string | Promise<string>;
  onGeneration?: (event: GenerationEvent<Output, Args>) => void | Promise<void>;
  domainLock?: string[];
  domainFocus?: string[];
  depthLimit?: number;
  hierarchical?: HierarchicalTuneOptions;
  lineage?: false | { path?: string };
  experience?: false | ExperienceOptions;
  timeouts?: { runMs?: number; scoreMs?: number; selectMs?: number };
  io?: InteractiveIO;
}

export interface TuneResult<Output> {
  output: Output;
  score?: number;
  objectives?: ObjectiveScores;
  seed: FrozenSeedHandle;
  history: GenerationSummary[];
  trace?: DomainTraceNode;
  domainSummaries?: DomainTuneSummary[];
  domainCredits?: Record<string, number>;
}

export interface SeedSchemaDescriptor {
  meta: {
    id: string | null;
    version: string;
    name: string;
    stable: boolean;
  };
  params: Array<{
    name: string;
    type: SeedTypeName;
    range?: [number, number];
    default?: unknown;
    tier: "core" | "texture";
  }>;
  relations: Array<{
    name: string;
    sources: string[];
    target: string;
    kind: RelationKind;
    weight?: number;
    params?: Record<string, unknown>;
  }>;
  checks: Array<{
    name: string;
    enforcement: "reject" | "warn";
    message?: string;
  }>;
  domainSlots: Array<{
    name: string;
    path: string;
    mode: "single" | "list";
    child: {
      id: string | null;
      version: string;
      name: string;
      domainUuid: string;
      schemaFingerprint: string;
    };
  }>;
  behaviors: Array<{
    name: string;
    valueType: "number";
  }>;
  domainRelations: Array<{
    name: string;
    source: string;
    target: string;
    kind: RelationKind;
    weight?: number;
    params?: Record<string, unknown>;
  }>;
  internal?: {
    domainUuid: string;
    schemaFingerprint: string;
    params: Array<{ name: string; fieldId: number }>;
    relations: Array<{ name: string; relationId: number }>;
    domainSlots: Array<{
      name: string;
      path: string;
      childDomainUuid: string;
      childSchemaFingerprint: string;
    }>;
  };
}
