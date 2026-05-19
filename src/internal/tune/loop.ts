import type {
  Candidate,
  CandidateContext,
  GenerationEvent,
  GenerationSummary,
  TuneOptions,
  TuneResult,
} from "../../public/tune.ts";
import { LineageService } from "../compat/lineage.ts";
import type { Seed } from "../compat/seed-format.ts";
import type { StagnationAssessment } from "../compat/stagnation.ts";
import { createExperienceService } from "../experience/service.ts";
import { buildDomainTuneSummaries } from "../hierarchical/credit.ts";
import {
  mutateHierarchicalTree,
  shouldUseHierarchicalMutation,
} from "../hierarchical/mutation.ts";
import { createTreeInvocationCache } from "../hierarchical/cache.ts";
import {
  appendTreeToSeedBank,
  buildSeedBankDonorIndex,
  ensureSeedBankService,
  summarizeTraceWarnings,
} from "../hierarchical/seed-bank.ts";
import type { WrapperState } from "../runtime/state.ts";
import { invokeSeededFunction } from "../runtime/invocation.ts";
import type { RuntimeTreeNode } from "../runtime/tree.ts";
import {
  coercePublicRadiusPreset,
  createExploratorySeed,
  mutateSeed as mutateLegacySeed,
  resolveRadius,
} from "../seed/mutation.ts";
import { snapshotToManifest } from "../seed/snapshot.ts";
import { selectCandidate } from "./selection.ts";
import { StagnationDetector } from "./stagnation.ts";
import {
  buildLineageRecord,
  createCandidateSeed,
  createLineageStore,
  createTuneSessionSeed,
  freezeSeedHandle,
  rankWinner,
} from "./common.ts";
import {
  evaluateCandidateQuality,
  resolveSelectorMode,
  validateAutoSelectionConfig,
} from "./evaluation.ts";
import {
  buildHierarchicalDomainSummaries,
  updateHierarchicalCreditsAfterSelection,
} from "./hierarchical.ts";
import {
  GenerationExhaustedError,
  SchemaDeclarationError,
  SelectionError,
  TimeoutExceededError,
  ValidationRejectedError,
} from "../utils/errors.ts";
import { createPrng } from "../utils/prng.ts";

type TuningCandidate<Output, Args extends unknown[]> =
  Candidate<Output, Args> & {
    legacySeed: Seed;
    tree: RuntimeTreeNode;
    mutations: NonNullable<Candidate<Output, Args>["mutations"]>;
    candidateSeed: string;
    candidateSeed32: number;
    appliedHabitIds: string[];
  };

export async function tuneSeededFunction<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  options: TuneOptions<Args, Output> = {},
): Promise<TuneResult<Output>> {
  const args = options.args ?? ([] as unknown as Args);
  const initialRun =
    state.schema === null || state.currentSeed === null
      ? await invokeSeededFunction(state, args, {
          seed: state.currentSeed,
          seedBank: options.hierarchical?.seedBank,
          timeouts: { runMs: options.timeouts?.runMs },
        })
      : null;
  const schema = state.schema ?? initialRun?.schema;
  if (!schema) {
    throw new SchemaDeclarationError("Failed to establish a schema before tuning");
  }
  ensureSeedBankService(state, options.hierarchical?.seedBank);

  const manifest = snapshotToManifest(schema);
  const generations = Math.max(1, options.generations ?? 1);
  const batchSize = Math.max(1, options.batchSize ?? 4);
  const selector = options.selector ?? "human";
  validateAutoSelectionConfig(selector, options);

  const lineageStore = createLineageStore(options.lineage);
  const lineageService = new LineageService(lineageStore);
  const experienceService = await createExperienceService(
    options.experience,
    schema,
    args,
    "tune",
  );
  const history: GenerationSummary[] = [];
  const selectedSnapshots: Array<{ seed: Seed; tags: string[] }> = [];
  let currentSeed = state.currentSeed ?? initialRun?.legacySeed;
  let currentTree = state.currentTreeSeed ?? initialRun?.tree ?? null;
  let radius = resolveRadius(options.radius ?? state.meta.radius);
  let pendingAssessment: StagnationAssessment | null = null;
  let latestObjectives: Candidate<Output, Args>["objectives"] | undefined;
  const selectorMode = resolveSelectorMode(selector);
  const useHierarchical = shouldUseHierarchicalMutation(currentTree, schema);
  let activeHabits = experienceService?.getActiveHabits() ?? [];
  const treeCache = useHierarchical
    ? createTreeInvocationCache(options.hierarchical?.cache)
    : null;

  const session = createTuneSessionSeed(
    state.meta,
    currentSeed!.contentHash,
    args,
    {
      selector: selectorMode,
      generations,
      batchSize,
      radius: options.radius ?? state.meta.radius,
      lineage:
        options.lineage === false ? false : options.lineage?.path ? "file" : "memory",
      hasScore: Boolean(options.score),
    },
    "tune",
  );

  for (let generation = 1; generation <= generations; generation++) {
    const parentSeed = currentSeed!;
    const batchAttempt = 0;
    const exploratoryCount = getExploratoryCount(pendingAssessment, batchSize);
    const recommendedRadius = coercePublicRadiusPreset(
      pendingAssessment?.recommendation?.recommendedRadius ?? "",
    );
    if (recommendedRadius) {
      radius = resolveRadius(recommendedRadius);
    }

    const attemptedBatchSize = batchSize;
    let rejectedCount = 0;
    let timedOutCount = 0;
    let firstFailureMessage: string | undefined;
    const candidates: TuningCandidate<Output, Args>[] = [];
    const seedBankDonors = await buildSeedBankDonorIndex(
      currentTree,
      options.hierarchical?.seedBank,
    );

    for (let candidatePosition = 0; candidatePosition < batchSize; candidatePosition++) {
      const isExploratory = candidatePosition >= batchSize - exploratoryCount;
      const candidateSeedInfo = createCandidateSeed(
        session.sessionSeed,
        generation,
        batchAttempt,
        candidatePosition,
      );
      const candidatePrng = createPrng(candidateSeedInfo.candidateSeed32);
      const hierarchicalMutation = useHierarchical && currentTree
        ? mutateHierarchicalTree(
            currentTree,
            radius,
            candidatePrng,
            {
              domainLock: options.domainLock,
              domainFocus: options.domainFocus,
              depthLimit: options.depthLimit,
              hierarchical: options.hierarchical,
              exploratory: isExploratory,
              domainCredits: state.domainCredits,
              seedBankDonors,
              activeHabits,
            },
          )
        : null;
      const mutatedSeed = hierarchicalMutation
        ? hierarchicalMutation.tree.seed
        : isExploratory
          ? createExploratorySeed(parentSeed, manifest, candidatePrng)
          : mutateLegacySeed(parentSeed, manifest, radius, candidatePrng);
      const candidateTree = hierarchicalMutation?.tree ?? currentTree;
      const habitGuidance = experienceService?.applyHabitGuidance(
        mutatedSeed,
        candidateTree,
        candidatePrng,
      ) ?? {
        seed: mutatedSeed,
        tree: candidateTree,
        appliedHabitIds: [],
      };
      const legacySeed = habitGuidance.seed;
      const guidedTree = habitGuidance.tree ?? candidateTree;
      if (guidedTree) {
        guidedTree.seed = legacySeed;
      }

      try {
        const run = await invokeSeededFunction(state, args, {
          seed: legacySeed,
          tree: guidedTree,
          commit: false,
          cache: treeCache,
          seedBank: options.hierarchical?.seedBank,
          timeouts: { runMs: options.timeouts?.runMs },
        });
        const frozenSeed = freezeSeedHandle(
          state,
          run.legacySeed,
          run.values,
          run.tree,
          state.domainCredits,
        );
        const previewContext: CandidateContext<Args> = {
          generation,
          position: candidates.length,
          batchAttempt,
          sessionSeed: session.sessionSeed,
          args,
          seed: frozenSeed,
        };
        const quality = await evaluateCandidateQuality(run.output, previewContext, options);
        const preview = summarizeTraceWarnings(run.trace)
          ? `${quality.preview} | warn=${summarizeTraceWarnings(run.trace)}`
          : quality.preview;

        candidates.push({
          position: candidates.length,
          generation,
          batchAttempt,
          sessionSeed: session.sessionSeed,
          output: run.output,
          preview,
          score: quality.score,
          objectives: quality.objectives,
          seed: frozenSeed,
          values: run.values,
          legacySeed: run.legacySeed,
          tree: run.tree,
          args,
          mutations: hierarchicalMutation?.mutations ?? [],
          domainTrace: run.trace,
          candidateSeed: candidateSeedInfo.candidateSeed,
          candidateSeed32: candidateSeedInfo.candidateSeed32,
          appliedHabitIds: habitGuidance.appliedHabitIds,
        });
      } catch (error) {
        if (
          error instanceof ValidationRejectedError ||
          error instanceof TimeoutExceededError
        ) {
          firstFailureMessage ??= error instanceof Error ? error.message : String(error);
          if (error instanceof ValidationRejectedError) {
            rejectedCount++;
          } else {
            timedOutCount++;
          }
          continue;
        }
        throw error;
      }
    }

    if (candidates.length === 0) {
      throw new GenerationExhaustedError(
        generation,
        attemptedBatchSize,
        rejectedCount,
        timedOutCount,
        firstFailureMessage,
      );
    }

    const selectedPosition = await selectCandidate(
      candidates,
      selector,
      {
        timeoutMs: options.timeouts?.selectMs,
        io: options.io,
      },
    );
    const winner = candidates[selectedPosition];
    if (!winner) {
      throw new SelectionError(
        `Selected position ${selectedPosition} was not found in the surviving candidate list`,
      );
    }

    const tags = selector === "human" ? ["human-curated"] : ["machine-curated"];
    selectedSnapshots.push({ seed: winner.legacySeed, tags });
    currentSeed = winner.legacySeed;
    currentTree = winner.tree;
    state.currentSeed = winner.legacySeed;
    state.currentValues = { ...winner.values };
    state.currentOutput = winner.output;
    state.currentTreeSeed = winner.tree;
    state.currentTrace = winner.domainTrace ?? null;
    latestObjectives = winner.objectives;
    await updateHierarchicalCreditsAfterSelection(
      state,
      candidates,
      winner,
      options,
      radius,
      pendingAssessment,
      treeCache,
    );
    await appendTreeToSeedBank(
      state,
      args,
      {
        seedBank: options.hierarchical?.seedBank,
        score: winner.score,
        tags: [...tags, "generation-winner"],
        includeRoot: winner.tree.children.size === 0,
        rootParentSeedHash: parentSeed.contentHash,
      },
    );

    const batchRank = rankWinner(candidates, winner.position, (candidate) => candidate.score);
    lineageService.append(
      buildLineageRecord(
        state.meta,
        parentSeed,
        winner,
        radius,
        generation,
        candidates.length,
        batchRank,
        tags,
        {
          executionSeed: winner.candidateSeed32,
          sessionSeed: session.sessionSeed,
          candidateSeed: winner.candidateSeed,
          batchAttempt,
          candidatePosition: winner.position,
          curatorId: tags.includes("human-curated") ? "human" : "auto-selector",
          mutationOperator:
            winner.mutations.length > 0
              ? "seed_wrapper_tree_tune"
              : "seed_wrapper_tune",
        },
      ),
    );
    await experienceService?.recordSelection({
      candidates: candidates.map((candidate) => ({
        generation: candidate.generation,
        batchAttempt: candidate.batchAttempt,
        position: candidate.position,
        sessionSeed: candidate.sessionSeed,
        candidateSeed: candidate.candidateSeed,
        output: candidate.output,
        score: candidate.score,
        objectives: candidate.objectives,
        seedHash: candidate.seed.meta?.hash ?? candidate.legacySeed.contentHash,
        parentSeedHash: parentSeed.contentHash,
        values: candidate.values,
        appliedHabitIds: candidate.appliedHabitIds,
        tree: candidate.tree,
        trace: candidate.domainTrace,
        mutations: candidate.mutations,
        domainSummaries: buildDomainTuneSummaries(candidate.tree, state.domainCreditState, {
          domainLock: options.domainLock,
          domainFocus: options.domainFocus,
        }),
        domainCredits: state.domainCredits,
        domainLock: options.domainLock,
        domainFocus: options.domainFocus,
        depthLimit: options.depthLimit,
      })),
      winnerPosition: winner.position,
      selector: selectorMode,
      tags,
    });
    activeHabits = experienceService?.getActiveHabits() ?? [];

    const event: GenerationEvent<Output, Args> = {
      generation,
      candidates,
      winner,
    };
    if (options.onGeneration) {
      await options.onGeneration(event);
    }

    history.push({
      generation,
      attemptedBatchSize,
      survivorCount: candidates.length,
      rejectedCount,
      timedOutCount,
      batchAttempt,
      sessionSeed: session.sessionSeed,
      selectedPosition,
      winnerScore: winner.score,
      winnerHash: winner.seed.meta?.hash ?? "unknown",
    });

    pendingAssessment = StagnationDetector.analyzeSelections(
      selectedSnapshots,
      manifest,
    );
    const nextRecommendedRadius = coercePublicRadiusPreset(
      pendingAssessment.recommendation?.recommendedRadius ?? "",
    );
    if (nextRecommendedRadius) {
      radius = resolveRadius(nextRecommendedRadius);
    }
  }

  return {
    output: state.currentOutput!,
    score: history[history.length - 1]?.winnerScore,
    objectives: latestObjectives,
    seed: freezeSeedHandle(
      state,
      state.currentSeed!,
      state.currentValues ?? {},
      state.currentTreeSeed,
      state.domainCredits,
    ),
    history,
    trace: state.currentTrace ?? undefined,
    domainSummaries: buildHierarchicalDomainSummaries(state, {
      domainLock: options.domainLock,
      domainFocus: options.domainFocus,
    }),
    domainCredits: { ...state.domainCredits },
  };
}

function getExploratoryCount(
  assessment: StagnationAssessment | null,
  batchSize: number,
): number {
  const ratio = assessment?.recommendation?.exploratoryRestartRatio ?? 0;
  if (ratio <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(batchSize * ratio));
}
