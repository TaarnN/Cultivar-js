import type {
  CandidateContext,
  CliTuneOptions,
  FrozenSeedHandle,
  HierarchicalCreditMode,
  MutationTrace,
  TuneOptions,
} from "../../public/tune.ts";
import type { StagnationAssessment } from "../compat/stagnation.ts";
import {
  buildDomainTuneSummaries,
  applyBatchMutationCredits,
  applyMutationCreditSample,
  flattenDomainCredits,
  hasLowConfidenceCreditTargets,
  selectCreditProbeTargets,
} from "../hierarchical/credit.ts";
import type { TreeInvocationCache } from "../hierarchical/cache.ts";
import { mutateSpecificHierarchicalTarget } from "../hierarchical/mutation.ts";
import { invokeSeededFunction } from "../runtime/invocation.ts";
import type { WrapperState } from "../runtime/state.ts";
import type { RuntimeTreeNode } from "../runtime/tree.ts";
import type { Seed } from "../compat/seed-format.ts";
import { resolveRadius } from "../seed/mutation.ts";
import { evaluateCandidateQuality } from "./evaluation.ts";
import { freezeSeedHandle } from "./common.ts";
import { createPrng, deriveSeed32 } from "../utils/prng.ts";
import {
  TimeoutExceededError,
  ValidationRejectedError,
} from "../utils/errors.ts";

type HierarchicalOptions<Args extends unknown[], Output> =
  TuneOptions<Args, Output> | CliTuneOptions<Args, Output>;

export interface HierarchicalCreditCandidate<Args extends unknown[], Output> {
  generation: number;
  position: number;
  batchAttempt: number;
  sessionSeed: string;
  candidateSeed: string;
  score?: number;
  output: Output;
  values: Record<string, unknown>;
  args: Args;
  seed: FrozenSeedHandle;
  legacySeed: Seed;
  tree: RuntimeTreeNode;
  mutations: MutationTrace[];
}

export async function updateHierarchicalCreditsAfterSelection<
  Args extends unknown[],
  Output,
>(
  state: WrapperState<Args, Output>,
  candidates: HierarchicalCreditCandidate<Args, Output>[],
  winner: HierarchicalCreditCandidate<Args, Output>,
  options: HierarchicalOptions<Args, Output>,
  radius: ReturnType<typeof resolveRadius>,
  assessment: StagnationAssessment | null,
  cache: TreeInvocationCache | null,
): Promise<void> {
  const creditMode = resolveHierarchicalCreditMode(options.hierarchical?.credit);
  if (creditMode === "off") {
    state.domainCredits = flattenDomainCredits(state.domainCreditState);
    return;
  }

  state.domainCreditState = applyBatchMutationCredits(
    state.domainCreditState,
    candidates.map((candidate) => ({
      score: candidate.score,
      mutations: candidate.mutations,
    })),
    winner.generation,
  );

  const shouldProbe = shouldRunCreditProbes(
    creditMode,
    winner.tree,
    state,
    options,
    assessment,
  );
  if (shouldProbe && winner.score !== undefined) {
    const maxProbeEvaluations = Math.max(
      0,
      options.hierarchical?.maxCreditProbeEvaluations ?? 3,
    );
    const targets = selectCreditProbeTargets(
      winner.tree,
      state.domainCreditState,
      {
        domainLock: options.domainLock,
        domainFocus: options.domainFocus,
        depthLimit: options.depthLimit,
      },
      maxProbeEvaluations,
    );

    for (const target of targets) {
      const prng = createPrng(
        deriveSeed32(
          `${winner.candidateSeed}:probe:${target.key}:${winner.generation}`,
        ),
      );
      const mutation = mutateSpecificHierarchicalTarget(
        winner.tree,
        {
          path: target.path,
          kind: target.kind === "edge" ? "relation" : "param",
          name: target.name,
        },
        radius,
        prng,
      );
      if (mutation.mutations.length === 0) {
        continue;
      }
      try {
        const run = await invokeSeededFunction(state, winner.args, {
          seed: mutation.tree.seed,
          tree: mutation.tree,
          commit: false,
          cache,
          seedBank: options.hierarchical?.seedBank,
          timeouts: { runMs: options.timeouts?.runMs },
        });
        const probeSeed = freezeSeedHandle(
          state,
          run.legacySeed,
          run.values,
          run.tree,
          state.domainCredits,
        );
        const context: CandidateContext<Args> = {
          generation: winner.generation,
          position: winner.position,
          batchAttempt: winner.batchAttempt,
          sessionSeed: winner.sessionSeed,
          args: winner.args,
          seed: probeSeed,
        };
        const quality = await evaluateCandidateQuality(
          run.output,
          context,
          options,
        );
        if (quality.score === undefined) {
          continue;
        }
        state.domainCreditState = applyMutationCreditSample(
          state.domainCreditState,
          mutation.mutations,
          quality.score - winner.score,
          winner.generation,
          1.25,
        );
      } catch (error) {
        if (
          error instanceof ValidationRejectedError ||
          error instanceof TimeoutExceededError
        ) {
          continue;
        }
        throw error;
      }
    }
  }

  state.domainCredits = flattenDomainCredits(state.domainCreditState);
}

export function buildHierarchicalDomainSummaries<Args extends unknown[], Output>(
  state: WrapperState<Args, Output>,
  options: {
    domainLock?: string[];
    domainFocus?: string[];
  } = {},
) {
  return buildDomainTuneSummaries(
    state.currentTreeSeed,
    state.domainCreditState,
    options,
  );
}

export function resolveHierarchicalCreditMode(
  mode: HierarchicalCreditMode | undefined,
): HierarchicalCreditMode {
  return mode ?? "hybrid";
}

function shouldRunCreditProbes<Args extends unknown[], Output>(
  creditMode: HierarchicalCreditMode,
  tree: RuntimeTreeNode | null,
  state: WrapperState<Args, Output>,
  options: HierarchicalOptions<Args, Output>,
  assessment: StagnationAssessment | null,
): boolean {
  if (!tree) {
    return false;
  }
  if (creditMode === "targeted") {
    return true;
  }
  if (creditMode !== "hybrid") {
    return false;
  }
  if (assessment?.stagnant) {
    return true;
  }
  return hasLowConfidenceCreditTargets(
    tree,
    state.domainCreditState,
    {
      domainLock: options.domainLock,
      domainFocus: options.domainFocus,
      depthLimit: options.depthLimit,
    },
  );
}
